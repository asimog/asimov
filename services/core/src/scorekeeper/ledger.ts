// Caller ledger, methodology cl1 (docs/PIPELINE.md): every callout counted once, exclusions by reason, never by result.
// Coverage report (docs/PIPELINE.md coverage). Both read only the Tape, so any replay gives the same numbers.
import type { Sql } from "../lib/db.ts";
import { median as med } from "../lib/stats.ts";

export const LEDGER_METHOD = "cl1";
const FEW = 5;

type Reason = "history" | "repeat" | "quote" | "gap" | "no_entry" | "no_trades" | "unresolved";
export type LedgerRow = {
  wallet: string;
  handle: string | null;
  calls: number;
  ok: number;
  excluded: Partial<Record<Reason, number>>;
  net_med: number | null;
  net_win: number | null;
  net_win_ci95: [number, number] | null;
  peak_med: number | null;
  trough_med: number | null;
  phase: { curve: number; amm: number };
  few: boolean;
};


/** Wilson score interval, 95%. */
function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

type Call = { id: string; wallet: string; handle: string | null; reason: Reason | null; net: number | null; peak: number | null; trough: number | null; phase: string | null };

function row(wallet: string, handle: string | null, calls: Call[]): LedgerRow {
  const ok = calls.filter((c) => !c.reason);
  const excluded: LedgerRow["excluded"] = {};
  for (const c of calls) if (c.reason) excluded[c.reason] = (excluded[c.reason] ?? 0) + 1;
  const nets = ok.map((c) => c.net!);
  const wins = nets.filter((x) => x > 1).length;
  return {
    wallet,
    handle,
    calls: calls.length,
    ok: ok.length,
    excluded,
    net_med: med(nets),
    net_win: nets.length ? wins / nets.length : null,
    net_win_ci95: wilson(wins, nets.length),
    peak_med: med(ok.map((c) => c.peak!)),
    trough_med: med(ok.map((c) => c.trough!)),
    phase: { curve: ok.filter((c) => c.phase === "curve").length, amm: ok.filter((c) => c.phase === "amm").length },
    few: ok.length < FEW,
  };
}

/** `at`: the ledger as it stood then (calls and outcomes seen by `at`). */
export async function ledger(sql: Sql, o: { horizon?: number; at?: string } = {}) {
  const horizon = o.horizon ?? 5;
  const upto = o.at ?? "9999-12-31T00:00:00Z";
  const rows = await sql`
    with calls as (
      select e.body->>'callout_id' id, e.body->>'author_wallet' wallet, e.body->>'author_handle' handle, e.body->>'mint' mint,
        e.body->>'quoted_callout_id' quoted, e.body->>'via' via, e.seen_time, e.id ev,
        row_number() over (partition by e.body->>'author_wallet', e.body->>'mint', coalesce(e.body->>'via', '') = 'history' order by e.seen_time, e.id) nth -- a history row never makes a live call a repeat
      from tape.events e where e.topic = 'callout.created' and e.seen_time <= ${upto}
      union all -- our own paper callouts (docs/EXECUTION.md): the house is one more caller
      select e.body->>'house_id', 'house', 'house', e.body->>'mint', null, 'house', e.seen_time, e.id, 1
      from tape.events e where e.topic = 'post.queued' and e.body->>'kind' = 'callout' and e.seen_time <= ${upto}
    ), outs as (
      select distinct on (body->>'callout_id') body->>'callout_id' id, body from tape.events
      where topic = 'outcome.measured' and (body->>'horizon_min')::int = ${horizon} and seen_time <= ${upto}
      order by body->>'callout_id', seen_time desc, id desc
    )
    select c.id, c.wallet, c.handle, c.nth, c.quoted, c.via, c.seen_time, o.body
    from calls c left join outs o on o.id = c.id order by c.seen_time, c.ev`;
  const calls: Call[] = rows.map((r) => {
    const b = r.body as Record<string, unknown> | null;
    const reason: Reason | null = r.via === "history" ? "history" : (r.nth as number) > 1 ? "repeat" : r.quoted ? "quote" : !b ? "unresolved" : b.coverage !== "ok" ? (b.coverage as Reason) : null;
    return { id: r.id as string, wallet: r.wallet as string, handle: r.handle as string | null, reason, net: (b?.net_multiple as number) ?? null, peak: (b?.peak_multiple as number) ?? null, trough: (b?.trough_multiple as number) ?? null, phase: (b?.phase as string) ?? null };
  });
  const by = new Map<string, Call[]>();
  for (const c of calls) (by.get(c.wallet) ?? by.set(c.wallet, []).get(c.wallet)!).push(c);
  const first = rows[0]?.seen_time as Date | undefined;
  const last = rows.at(-1)?.seen_time as Date | undefined;
  return {
    method: LEDGER_METHOD,
    horizon_min: horizon,
    window: { from: first?.toISOString() ?? null, to: last?.toISOString() ?? null },
    all: row("all callers", null, calls.filter((c) => !c.wallet.startsWith("house"))), // the crowd baseline; the house has its own row
    rows: [...by.entries()].map(([w, cs]) => row(w, cs.findLast((c) => c.handle)?.handle ?? null, cs)).sort((a, b) => b.calls - a.calls || (a.wallet < b.wallet ? -1 : 1)),
  };
}

export async function coverage(sql: Sql) {
  const gaps = await sql`select id, seen_time, body from tape.events where topic = 'system.gap' order by seen_time, id`;
  const [coins] = await sql`
    with called as (select body->>'mint' mint, min(seen_time) first_call from tape.events where topic = 'callout.created' group by 1),
    traded as (select subject mint, min(seen_time) first_trade from tape.events where topic in ('trade.curve', 'trade.amm') group by 1)
    select count(*)::int called, count(t.mint)::int with_trades, count(*) filter (where t.first_trade > c.first_call)::int first_trade_after_call
    from called c left join traded t using (mint)`;
  // collectors (docs/PIPELINE.md): trades per source, and signatures both NATS and the RPC backfill saw
  const sources = await sql`select source, count(*)::int trades, count(distinct body->>'tx')::int txs from tape.events
    where topic in ('trade.curve', 'trade.amm') group by 1 order by 1`;
  const [both] = await sql`select count(*)::int n from (select body->>'tx' from tape.events where topic in ('trade.curve', 'trade.amm')
    group by 1 having count(distinct source) > 1) x`;
  // callouts announced by their author's own buy on the Tape before the callout (docs/research/pre-call-evidence.md)
  const [announced] = await sql`select count(*)::int calls, count(*) filter (where exists (select 1 from tape.events t
      where t.subject = c.body->>'mint' and t.topic in ('trade.curve', 'trade.amm') and t.body->>'wallet' = c.body->>'author_wallet'
        and t.body->>'side' = 'buy' and (case when t.source = 'rpc' then t.event_time else t.seen_time end) < c.seen_time))::int author_buy_first
    from tape.events c where c.topic = 'callout.created'`;
  const outcomes = await sql`
    select (body->>'horizon_min')::int h, body->>'coverage' coverage, count(*)::int n from (
      select distinct on (body->>'callout_id', body->>'horizon_min') body from tape.events where topic = 'outcome.measured'
      order by body->>'callout_id', body->>'horizon_min', seen_time desc, id desc) x group by 1, 2 order by 1, 2`;
  return {
    gaps: gaps.map((g) => ({ id: g.id, seen: (g.seen_time as Date).toISOString(), ...(g.body as object) })),
    coins_called: coins!.called,
    coins_with_trades: coins!.with_trades,
    coins_first_trade_after_first_call: coins!.first_trade_after_call,
    trades_by_source: sources,
    txs_seen_by_both: both!.n,
    callouts_author_buy_first: announced,
    outcomes,
  };
}
