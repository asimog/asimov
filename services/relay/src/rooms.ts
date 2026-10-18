// Rooms added in S5 (docs/19): Treasury, Rewind (Board at T), Connectome, share cards, case files. Read-only queries.
import crypto from "node:crypto";
import type postgres from "postgres";
import { boardAt } from "../../core/src/board/board.ts";
import { buildCase } from "../../core/src/hunt/case.ts";

type Row = { id: string; topic: string; seen_time: Date; subject: string | null; body: Record<string, any>; causes: string[] };
export type Deps<L> = {
  sql: postgres.Sql;
  cached: (key: string, ms: number, fn: () => Promise<unknown>) => Promise<unknown>;
  sym: (mint?: string | null) => string;
  line: (r: Row) => L | null;
  mandate: number;
};

const HOUR = 3_600_000;
const sha = (x: string) => crypto.createHash("sha256").update(x).digest("hex");

export function rooms<L>({ sql, cached, sym, line, mandate }: Deps<L>) {
  /** Treasury (docs/10, 11): the hourly proof segments from books.proofs (S6.6, recomputed in the browser), sweeps, balances, costs.
   * Also, for paper mode: the PAPER balance, the reconciliation of two independent sums, and the Tape proof chain.
   * Chain link = sha256(prev | hour | count | ids_hash); ids_hash = sha256 of every event id of that hour in tape order, joined by commas.
   * The chain starts at the first hour on the Tape (prev = 64 zeros), so a closed hour's hash never changes. */
  const hourMemo = new Map<string, { count: number; ids_hash: string }>(); // closed hours only
  const treasury = () =>
    cached("treasury", 5000, async () => {
      const [h] = await sql`select min(seen_time) first, max(seen_time) last from tape.events`;
      const first = h?.first as Date | null;
      const last = h?.last as Date | null;
      const chain: { hour: string; prev: string; events: number; ids_hash: string; hash: string; open: boolean }[] = [];
      if (first && last) {
        const lastHour = Math.floor(last.getTime() / HOUR) * HOUR;
        let prev = "0".repeat(64);
        for (let t = Math.floor(first.getTime() / HOUR) * HOUR; t <= lastHour; t += HOUR) {
          const hour = new Date(t).toISOString();
          const open = t === lastHour;
          let m = open ? undefined : hourMemo.get(hour);
          if (!m) {
            const [r] = await sql`select count(*)::int n, encode(sha256(convert_to(coalesce(string_agg(id, ',' order by seen_time, id), ''), 'UTF8')), 'hex') ids_hash
              from tape.events where seen_time >= ${new Date(t)} and seen_time < ${new Date(t + HOUR)}`;
            m = { count: r!.n as number, ids_hash: r!.ids_hash as string };
            if (!open) hourMemo.set(hour, m);
          }
          if (m.count === 0) continue;
          const hash = sha(`${prev}|${hour}|${m.count}|${m.ids_hash}`);
          chain.push({ hour, prev, events: m.count, ids_hash: m.ids_hash, hash, open });
          prev = hash;
        }
      }
      const [pos] = await sql`select coalesce(sum(net_sol), 0)::float net, count(*)::int closed from mind.positions where closed_at is not null`;
      const [opn] = await sql`select coalesce(sum(cost_sol), 0)::float cost from mind.positions where closed_at is null`;
      const [tp] = await sql`select coalesce(sum((body->>'net_sol')::float), 0)::float net from tape.events where topic = 'position.closed'`;
      const net = pos!.net as number;
      const diff = Math.abs(net - (tp!.net as number));
      return {
        as_of: last ? last.getTime() : 0,
        mode: "PAPER",
        mandate_sol: mandate,
        paper: { equity_sol: mandate + net, net_sol: net, closed: pos!.closed as number, open_cost_sol: opn!.cost as number },
        reconciliation: { positions_net: net, tape_net: tp!.net as number, diff, ok: diff < 1e-9 },
        // live books (docs/10): empty in paper mode, filled once the Treasurer runs
        proofs: (await sql`select n, hour, sha256, prev_sha256, memo_sig, body from books.proofs order by n desc limit 24`).reverse(),
        sweeps: (await sql`select seen_time, body from tape.events where topic = 'fees.swept' order by seen_time desc, id desc limit 20`).map((x) => ({ at: (x.seen_time as Date).getTime(), ...(x.body as object) })),
        balances: await sql`select account, lamports::text lamports from books.balances order by account`,
        costs: await sql`select leg->>'account' account, sum((leg->>'lamports')::bigint)::text lamports from books.entries, jsonb_array_elements(legs) leg where leg->>'account' like 'exp:%' group by 1 order by 1`,
        chain: chain.slice(-24),
      };
    });

  /** Rewind (S11.4): the Board at time T is the latest signal per (kind, subject) with produced_at <= T < valid_until (docs/03). */
  const board = async (atMs: number | null) => {
    const [r] = await sql`select min(seen_time) f, max(seen_time) t from tape.events`;
    const from = (r?.f as Date | null)?.getTime() ?? 0;
    const to = (r?.t as Date | null)?.getTime() ?? 0;
    const at = Math.min(to, Math.max(from, atMs ?? to));
    return cached(`board:${at}`, atMs == null ? 3000 : 60_000, async () => {
      const iso = new Date(at).toISOString();
      const rows = await boardAt(sql as never, iso);
      const counts = new Map<string, number>();
      const recent = new Map<string, number>();
      for (const x of rows) {
        counts.set(x.kind as string, (counts.get(x.kind as string) ?? 0) + 1);
        recent.set(x.subject as string, Math.max(recent.get(x.subject as string) ?? 0, (x.produced_at as Date).getTime()));
      }
      const top = new Set([...recent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map((e) => e[0]));
      const lineRows = (await sql`select id, topic, seen_time, subject, body, causes from tape.events
        where seen_time <= ${iso} and seen_time > ${iso}::timestamptz - interval '10 minutes'
          and topic not like 'trade.%' and topic not in ('callout.counts', 'observation.raw', 'coin.seen', 'outcome.measured', 'caller.position', 'callout.updated')
        order by seen_time desc, id desc limit 120`) as unknown as Row[];
      return {
        at,
        range: { from, to },
        total: rows.length,
        kinds: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([kind, n]) => ({ kind, n })),
        signals: rows
          .filter((x) => top.has(x.subject as string))
          .map((x) => ({ kind: x.kind, subject: x.subject, sym: sym(x.subject as string), value: x.value, confidence: x.confidence, produced_at: (x.produced_at as Date).getTime(), valid_until: (x.valid_until as Date).getTime() })),
        lines: lineRows.map(line).filter((l): l is NonNullable<typeof l> => l !== null).slice(0, 40),
      };
    });
  };

  /** Connectome (S11.3): nothing trades yet; the room reports the count of fly events honestly. */
  const connectome = () =>
    cached("connectome", 10_000, async () => {
      const [r] = await sql`select count(*)::int n from tape.events where topic like 'fly.%'`;
      return { fly_events: r!.n as number, state: (r!.n as number) > 0 ? "running" : "not trading" };
    });

  /** Share cards (S5.8): 20 callouts with a measured 5 minute outcome. No caller is named. */
  const cardIds = () =>
    cached("cards", 60_000, async () => {
      const rows = await sql`
        with o as (select distinct on (body->>'callout_id') body->>'callout_id' id, body from tape.events
          where topic = 'outcome.measured' and (body->>'horizon_min')::int = 5 order by body->>'callout_id', seen_time desc, id desc)
        select o.id from o join mem.callouts c on c.callout_id = o.id join mem.coins k on k.mint = c.mint
        where o.body->>'coverage' = 'ok' and k.symbol is not null order by c.created_at desc limit 20`;
      return { ids: rows.map((r) => r.id as string) };
    });

  const card = (id: string) =>
    cached(`card:${id}`, 30_000, async () => {
      const [c] = await sql`select c.callout_id, c.mint, c.mcap_at_call, c.opportunity_age_min, c.seen_at, k.symbol from mem.callouts c left join mem.coins k on k.mint = c.mint where c.callout_id = ${id}`;
      if (!c) return null;
      const [o] = await sql`select body from tape.events where topic = 'outcome.measured' and body->>'callout_id' = ${id} and (body->>'horizon_min')::int = 5 order by seen_time desc, id desc limit 1`;
      const at = c.seen_at as Date;
      const sig = await sql`select distinct on (kind) kind, value from board.signals
        where subject in (${c.mint as string}, ${id}) and kind in ('precall.callout_p', 'hawkes.wave_p', 'echo.score', 'curve.progress', 'age.opportunity')
          and produced_at <= ${at} and valid_until > ${at} order by kind, produced_at desc`;
      const v = Object.fromEntries(sig.map((x) => [x.kind as string, x.value as Record<string, number>]));
      const signals: { label: string; value: string }[] = [];
      if (v["curve.progress"]) signals.push({ label: "curve to graduation", value: `${Math.round(v["curve.progress"].progress! * 100)}%` });
      if (v["precall.callout_p"]) signals.push({ label: "callout odds", value: v["precall.callout_p"].p!.toFixed(2) });
      if (v["hawkes.wave_p"]) signals.push({ label: "wave odds, 5 min", value: v["hawkes.wave_p"].p!.toFixed(2) });
      if (v["echo.score"]) signals.push({ label: "echo of earlier calls", value: v["echo.score"].score!.toFixed(2) });
      if (v["age.opportunity"]) signals.push({ label: "price move before call", value: `${v["age.opportunity"].pre_move_pct!.toFixed(0)}%` });
      const [th] = await sql`select sha256, content from mind.commits where content->>'mint' = ${c.mint as string} and content ? 'prediction' order by made_at limit 1`;
      const [held] = await sql`select count(distinct strategy_id)::int n from mind.positions where mint = ${c.mint as string}`;
      const plan = (th?.content as { plan?: { stop: number; ladder: { mult: number; sell: number }[] } } | undefined)?.plan;
      const b = (o?.body ?? {}) as Record<string, any>;
      const n = held!.n as number;
      return {
        id,
        sym: c.symbol ? `$${c.symbol}` : `$${String(c.mint).slice(0, 4)}`,
        mcap_usd: (c.mcap_at_call as number | null) ?? null,
        age_min: (c.opportunity_age_min as number | null) ?? null,
        signals,
        net_multiple: (b.net_multiple as number | undefined) ?? null,
        coverage: (b.coverage as string | undefined) ?? "none",
        ref_sol: (b.ref_sol as number | undefined) ?? 0.02,
        ladder: plan ? `${plan.ladder.map((l) => `${l.mult}x sell ${Math.round(l.sell * 100)}%`).join(", ")}, stop ${plan.stop}x` : null,
        commit: th ? (th.sha256 as string).slice(0, 16) : null,
        position: n > 0 ? `PAPER: ${n} strategy book${n > 1 ? "s" : ""} traded it` : "none",
      };
    });

  const caseFile = (id: string) => buildCase(sql as never, id);

  return { treasury, board, connectome, cardIds, card, caseFile };
}
