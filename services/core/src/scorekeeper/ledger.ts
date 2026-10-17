// Caller ledger, methodology cl1 (docs/07): every callout counted once, exclusions by reason, never by result.
// Coverage report (docs/07 coverage). Both read only the Tape, so any replay gives the same numbers.
import type { Sql } from "../lib/db.ts";

export const LEDGER_METHOD = "cl1";
const FEW = 5;

type Reason = "repeat" | "quote" | "gap" | "no_entry" | "no_trades" | "unresolved";
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

const med = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
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

export async function ledger(sql: Sql, o: { horizon?: number } = {}) {
  const horizon = o.horizon ?? 5;
  const rows = await sql`
    with calls as (
      select e.body->>'callout_id' id, e.body->>'author_wallet' wallet, e.body->>'author_handle' handle, e.body->>'mint' mint,
        e.body->>'quoted_callout_id' quoted, e.seen_time, e.id ev,
        row_number() over (partition by e.body->>'author_wallet', e.body->>'mint' order by e.seen_time, e.id) nth
      from tape.events e where e.topic = 'callout.created'
    ), outs as (
      select distinct on (body->>'callout_id') body->>'callout_id' id, body from tape.events
      where topic = 'outcome.measured' and (body->>'horizon_min')::int = ${horizon}
      order by body->>'callout_id', seen_time desc, id desc
    )
    select c.id, c.wallet, c.handle, c.nth, c.quoted, c.seen_time, o.body
    from calls c left join outs o on o.id = c.id order by c.seen_time, c.ev`;
  const calls: Call[] = rows.map((r) => {
    const b = r.body as Record<string, unknown> | null;
    const reason: Reason | null = (r.nth as number) > 1 ? "repeat" : r.quoted ? "quote" : !b ? "unresolved" : b.coverage !== "ok" ? (b.coverage as Reason) : null;
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
    all: row("all callers", null, calls),
    rows: [...by.entries()].map(([w, cs]) => row(w, cs.at(-1)!.handle, cs)).sort((a, b) => b.calls - a.calls || (a.wallet < b.wallet ? -1 : 1)),
  };
}

export async function coverage(sql: Sql) {
  const gaps = await sql`select id, seen_time, body from tape.events where topic = 'system.gap' order by seen_time, id`;
  const [coins] = await sql`
    with called as (select body->>'mint' mint, min(seen_time) first_call from tape.events where topic = 'callout.created' group by 1),
    traded as (select subject mint, min(seen_time) first_trade from tape.events where topic in ('trade.curve', 'trade.amm') group by 1)
    select count(*)::int called, count(t.mint)::int with_trades, count(*) filter (where t.first_trade > c.first_call)::int first_trade_after_call
    from called c left join traded t using (mint)`;
  const outcomes = await sql`
    select (body->>'horizon_min')::int h, body->>'coverage' coverage, count(*)::int n from (
      select distinct on (body->>'callout_id', body->>'horizon_min') body from tape.events where topic = 'outcome.measured'
      order by body->>'callout_id', body->>'horizon_min', seen_time desc, id desc) x group by 1, 2 order by 1, 2`;
  return {
    gaps: gaps.map((g) => ({ id: g.id, seen: (g.seen_time as Date).toISOString(), ...(g.body as object) })),
    coins_called: coins!.called,
    coins_with_trades: coins!.with_trades,
    coins_first_trade_after_first_call: coins!.first_trade_after_call,
    outcomes,
  };
}
