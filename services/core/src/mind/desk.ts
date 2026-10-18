// The paper desk (docs/STRATEGY.md): every strategy in the Strategy Pool trades its own ghost book on every relevant event.
// Order of work per event: periodic rounds (allocation, evolution, sweeps), then fills, markouts, exits, entries.
// All state lives in mind.* and is cached in memory; a failed batch drops the cache so it reloads from Postgres.
// Every decision is a Tape event written in the same transaction as the consumer offset (Tape.emitIn).
import crypto from "node:crypto";
import { type BodyOf, canonical, type Envelope } from "@asimog/contracts";
import { curveFromPrice } from "../analyzers/curve-math.ts";
import { liveFor } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { type BoardValues, evaluateEntry, type Spec, validate, whenHolds } from "./dsl.ts";
import { evolve, type Member } from "./evolve.ts";
import { F, fillBuy, fillSell, type Market, quoteFor, sampleLatencyMs } from "./fill.ts";
import { allocate, lcb, type Stats } from "./kernel.ts";
import { type Book, bookFrom, DEFAULT_LIMITS, type GateRisk, type Limits, loadLimits, riskGate } from "./risk.ts";
import { seedSpecs } from "./seeds.ts";

const D = {
  bookSol: env.num("GHOST_BOOK_SOL"),
  evalMinMs: env.int("EVAL_MIN_MS"),
  entryWindowMs: env.int("ENTRY_WINDOW_MIN") * 60_000,
  reentryMs: env.int("REENTRY_COOLDOWN_S") * 1000,
  sweepMs: env.int("SWEEP_MS"),
  allocateMs: env.int("ALLOCATE_EVERY_S") * 1000,
  evolveMs: env.int("EVOLVE_EVERY_S") * 1000,
  markouts: [1, 10, 60, 300] as const,
};
const MK_KEYS = { 1: "h1s", 10: "h10s", 60: "h60s", 300: "h5m" } as const;

type StatRow = Stats & { wins: number; equity: number; peak: number; mk60: number[]; stage: string; share: number; last_trade_ms: number | null };
type Position = {
  id: string; strategy_id: string; mint: string; callout_id: string | null; opened_ms: number; tokens: number; tokens_left: number;
  cost_sol: number; proceeds_sol: number; rent_sol: number; entry_price: number; bands: number[]; fired: number[]; commit_id: string | null;
};
type Intent = { id: string; strategy_id: string; mint: string; side: "buy" | "sell"; size_sol: number | null; tokens: number | null; position_id: string | null; reason: string; created_ms: number; fill_after_ms: number; event_id: string; score: number | null };
type Fill = { id: string; intent_id: string; strategy_id: string; mint: string; side: "buy" | "sell"; at_ms: number; price_sol: number; mk: Record<string, number | null> };

const sha = (x: unknown) => crypto.createHash("sha256").update(canonical(x)).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) => Math.floor(ms / 86_400_000);

export type Desk = Consumer & { stats: Record<string, number | Record<string, number>> };

export function desk(tape: Tape, clock: Clock): Desk {
  const counts = { evaluations: 0, intents: 0, fills: 0, closes: 0, markouts: 0, births: 0, retirements: 0, rounds: 0 };
  const rejected: Record<string, number> = {};
  const stats = { ...counts, rejected } as Desk["stats"];
  const bump = (k: keyof typeof counts, n = 1) => ((stats[k] as number) += n);

  let loaded = false;
  let limits: Limits = DEFAULT_LIMITS;
  const strategies = new Map<string, { spec: Spec; born_ms: number }>();
  const st = new Map<string, StatRow>();
  const open = new Map<string, Position[]>(); // mint -> open positions
  const closedToday = new Map<string, { day: number; net: number }>();
  const realized = new Map<string, number>();
  const pending = new Map<string, Intent[]>(); // mint -> intents
  const fills = new Map<string, Fill[]>(); // mint -> fills awaiting markouts
  const market = new Map<string, Market & { real_sol: number | null }>();
  const coinCallout = new Map<string, { callout_id: string; author: string | null; at_ms: number }>();
  const calloutMint = new Map<string, string>();
  const coinPrecall = new Map<string, { caller: string; at_ms: number }>(); // a known caller bought, before their callout (docs/STRATEGY.md)
  const lastEval = new Map<string, number>();
  const lastExit = new Map<string, number>(); // `${strategy}:${mint}` -> ms
  const clockRow = { next_alloc: 0, next_evolve: 0, sweep_bucket: -1, round: 0 };

  const emptyStats = (): StatRow => ({ n: 0, sum: 0, sq: 0, rets: [], max_dd: 0, wins: 0, equity: 0, peak: 0, mk60: [], stage: "ghost", share: 0, last_trade_ms: null });
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);

  // ---------- load ----------
  /** Rebuild every cache in the order an uninterrupted run would have built it: map order decides iteration and RNG draws. */
  async function load(tx: Tx) {
    for (const m of [strategies, st, open, closedToday, realized, pending, fills, market, coinCallout, calloutMint, coinPrecall, lastEval, lastExit] as Map<unknown, unknown>[]) m.clear();
    limits = await loadLimits(tx);
    for (const r of await tx`select id, spec, born_at from mind.strategies where retired_at is null order by born_at, id`)
      strategies.set(r.id as string, { spec: r.spec as Spec, born_ms: (r.born_at as Date).getTime() });
    for (const r of await tx`select * from mind.stats order by strategy_id`)
      st.set(r.strategy_id as string, {
        n: r.trades as number, sum: r.net_sum as number, sq: r.net_sq as number, rets: (r.rets as number[]) ?? [], max_dd: r.max_dd as number,
        wins: r.wins as number, equity: r.equity as number, peak: r.peak as number, mk60: (r.mk60 as number[]) ?? [], stage: r.stage as string,
        share: r.share as number, last_trade_ms: r.last_trade_at ? (r.last_trade_at as Date).getTime() : null,
      });
    for (const r of await tx`select strategy_id, sum(net_sol)::float net from mind.positions where closed_at is not null group by 1`) realized.set(r.strategy_id as string, r.net as number);
    for (const r of await tx`select * from mind.positions where closed_at is null order by opened_at, id`)
      push(open, r.mint as string, {
        id: r.id as string, strategy_id: r.strategy_id as string, mint: r.mint as string, callout_id: r.callout_id as string | null,
        opened_ms: (r.opened_at as Date).getTime(), tokens: r.tokens as number, tokens_left: r.tokens_left as number, cost_sol: r.cost_sol as number,
        proceeds_sol: r.proceeds_sol as number, rent_sol: r.rent_sol as number, entry_price: r.entry_price as number,
        bands: r.exit_bands as number[], fired: ((r.exits as { i: number }[]) ?? []).map((x) => x.i), commit_id: r.commit_id as string | null,
      });
    for (const r of await tx`select * from mind.intents order by created_at, id`)
      push(pending, r.mint as string, {
        id: r.id as string, strategy_id: r.strategy_id as string, mint: r.mint as string, side: r.side as "buy" | "sell", size_sol: r.size_sol as number | null,
        tokens: r.fraction as number | null, position_id: r.position_id as string | null, reason: r.reason as string,
        created_ms: (r.created_at as Date).getTime(), fill_after_ms: (r.fill_after as Date).getTime(), event_id: r.event_id as string, score: null,
      });
    for (const r of await tx`select * from mind.fills where not done order by at, id`)
      push(fills, r.mint as string, { id: r.id as string, intent_id: r.intent_id as string, strategy_id: r.strategy_id as string, mint: r.mint as string, side: r.side as "buy" | "sell", at_ms: (r.at as Date).getTime(), price_sol: r.price_sol as number, mk: r.mk as Record<string, number | null> });
    for (const r of await tx`select * from mind.coin_callout order by at, mint`) {
      coinCallout.set(r.mint as string, { callout_id: r.callout_id as string, author: r.author_wallet as string | null, at_ms: (r.at as Date).getTime() });
      calloutMint.set(r.callout_id as string, r.mint as string);
      if (r.last_eval) lastEval.set(r.mint as string, (r.last_eval as Date).getTime());
    }
    for (const r of await tx`select * from mind.coin_precall order by at, mint`) {
      coinPrecall.set(r.mint as string, { caller: r.caller as string, at_ms: (r.at as Date).getTime() });
      if (r.last_eval) lastEval.set(r.mint as string, Math.max(lastEval.get(r.mint as string) ?? 0, (r.last_eval as Date).getTime())); // the later of both tables
    }
    // caches rebuilt from durable state, so a restart decides exactly as an uninterrupted run (e2e/callout-case-replay)
    for (const r of await tx`select strategy_id, mint, max(closed_at) at from mind.positions where closed_at is not null group by 1, 2`)
      lastExit.set(`${r.strategy_id}:${r.mint}`, (r.at as Date).getTime());
    for (const r of await tx`select strategy_id, floor(extract(epoch from closed_at) / 86400)::int8 d, sum(net_sol)::float net from mind.positions
        where closed_at is not null group by 1, 2 order by 1, 2`)
      closedToday.set(r.strategy_id as string, { day: Number(r.d), net: r.net as number });
    const [off] = await tx`select last_seen_time from tape.consumer_offsets where consumer = 'desk'`;
    const upto = off ? (off.last_seen_time as Date) : null;
    if (upto && upto.getTime() > 0) {
      clockRow.sweep_bucket = Math.floor(upto.getTime() / D.sweepMs);
      const mints = [...new Set([...coinCallout.keys(), ...coinPrecall.keys(), ...open.keys(), ...pending.keys()])];
      for (const r of await tx`select distinct on (subject) subject, topic, seen_time, (body->>'price_sol')::float p from tape.events
          where subject = any(${mints}) and topic in ('trade.curve', 'trade.amm') and seen_time <= ${upto} and body->>'price_sol' is not null and (body->>'price_sol')::float > 0
          order by subject, seen_time desc, id desc`) {
        const graduated = r.topic === "trade.amm";
        market.set(r.subject as string, { price_sol: r.p as number, at_ms: (r.seen_time as Date).getTime(), graduated, real_sol: graduated ? null : curveFromPrice(r.p as number).realSol });
      }
    }
    const [cl] = await tx`select at, round from mind.desk_clock where name = 'next_alloc'`;
    const [ce] = await tx`select at from mind.desk_clock where name = 'next_evolve'`;
    clockRow.next_alloc = cl ? (cl.at as Date).getTime() : 0;
    clockRow.round = cl ? (cl.round as number) : 0;
    clockRow.next_evolve = ce ? (ce.at as Date).getTime() : 0;
    loaded = true;
  }

  // ---------- books ----------
  function book(sid: string, now: number): Book {
    const t = closedToday.get(sid);
    return bookFrom(D.bookSol + (realized.get(sid) ?? 0), [...open.values()].flat().filter((p) => p.strategy_id === sid), t && t.day === day(now) ? t.net : 0);
  }

  async function saveStats(tx: Tx, sid: string) {
    const s = st.get(sid)!;
    await tx`insert into mind.stats (strategy_id, trades, wins, net_sum, net_sq, equity, peak, max_dd, mk60, rets, stage, share, last_trade_at)
      values (${sid}, ${s.n}, ${s.wins}, ${s.sum}, ${s.sq}, ${s.equity}, ${s.peak}, ${s.max_dd}, ${s.mk60}, ${s.rets}, ${s.stage}, ${s.share}, ${s.last_trade_ms ? iso(s.last_trade_ms) : null})
      on conflict (strategy_id) do update set trades = excluded.trades, wins = excluded.wins, net_sum = excluded.net_sum, net_sq = excluded.net_sq,
        equity = excluded.equity, peak = excluded.peak, max_dd = excluded.max_dd, mk60 = excluded.mk60, rets = excluded.rets,
        stage = excluded.stage, share = excluded.share, last_trade_at = excluded.last_trade_at`;
  }

  // ---------- strategies ----------
  async function birth(tx: Tx, spec: Spec, origin: "seed" | "mutation" | "crossover" | "proposal", parents: string[], e: Envelope) {
    const now = clock.now();
    await tx`insert into mind.strategies (id, spec, family, horizon, parents, origin, born_at) values (${spec.id}, ${tx.json(spec as never)}, ${spec.family}, ${spec.horizon}, ${parents}, ${origin}, ${iso(now)}) on conflict do nothing`;
    strategies.set(spec.id, { spec, born_ms: now });
    st.set(spec.id, emptyStats());
    await saveStats(tx, spec.id);
    await tape.emitIn(tx, "strategy.born", { strategy_id: spec.id, family: spec.family, horizon: spec.horizon, origin, parents, spec: spec as never }, { source: "strategies", subject: spec.id, causes: [e.id], after: e.seen_time });
    bump("births");
  }

  async function retire(tx: Tx, sid: string, reason: string, e: Envelope) {
    const s = st.get(sid) ?? emptyStats();
    await tx`update mind.strategies set retired_at = ${iso(clock.now())}, retire_reason = ${reason} where id = ${sid}`;
    strategies.delete(sid);
    await tape.emitIn(tx, "strategy.retired", { strategy_id: sid, reason, trades: s.n, lcb: s.n ? lcb(s) : null }, { source: "strategies", subject: sid, causes: [e.id], after: e.seen_time });
    bump("retirements");
  }

  // ---------- periodic rounds ----------
  async function rounds(tx: Tx, e: Envelope, now: number) {
    if (strategies.size === 0 && (await tx`select count(*)::int n from mind.strategies`)[0]!.n === 0)
      for (const spec of seedSpecs()) {
        const v = validate(spec);
        if (!v.ok) throw new Error(`seed ${spec.id} invalid: ${v.reasons.join("; ")}`);
        await birth(tx, v.spec, "seed", [], e);
      }
    if (!clockRow.next_alloc) clockRow.next_alloc = now + D.allocateMs;
    if (!clockRow.next_evolve) clockRow.next_evolve = now + D.evolveMs;
    if (Math.floor(now / D.sweepMs) > clockRow.sweep_bucket) {
      clockRow.sweep_bucket = Math.floor(now / D.sweepMs);
      await sweep(tx, e, now);
    }
    if (now >= clockRow.next_alloc) {
      clockRow.next_alloc = now + D.allocateMs;
      clockRow.round++;
      const shares = allocate([...strategies.keys()].map((id) => ({ strategy_id: id, stats: st.get(id) ?? emptyStats() })), D.bookSol, clock.rand);
      for (const a of shares) {
        const s = st.get(a.strategy_id);
        if (s && (s.share !== a.share || s.stage !== a.stage)) ((s.share = a.share), (s.stage = a.stage), await saveStats(tx, a.strategy_id));
      }
      await tape.emitIn(tx, "kernel.allocation", { round: clockRow.round, hurdle: 0, shares: shares.slice(0, 32) }, { source: "strategies", causes: [e.id], after: e.seen_time });
      await tx`insert into mind.desk_clock (name, at, round) values ('next_alloc', ${iso(clockRow.next_alloc)}, ${clockRow.round}) on conflict (name) do update set at = excluded.at, round = excluded.round`;
      bump("rounds");
    }
    if (now >= clockRow.next_evolve) {
      clockRow.next_evolve = now + D.evolveMs;
      const pool: Member[] = [...strategies.values()].map(({ spec, born_ms }) => {
        const s = st.get(spec.id) ?? emptyStats();
        return { spec, stats: s, born_ms, last_trade_ms: s.last_trade_ms, mk60: s.mk60 };
      });
      const r = evolve(pool, now, D.bookSol, clock.rand, () => clock.id("strategy"));
      for (const x of r.retire) await retire(tx, x.id, x.reason, e);
      for (const c of r.children) await birth(tx, c.spec, c.origin, c.parents, e);
      await tx`insert into mind.desk_clock (name, at) values ('next_evolve', ${iso(clockRow.next_evolve)}) on conflict (name) do update set at = excluded.at`;
    }
  }

  /** Time exits, stale intents and markouts on coins that went quiet. */
  async function sweep(tx: Tx, e: Envelope, now: number) {
    for (const [mint, ps] of open) {
      const m = market.get(mint);
      if (m) for (const p of [...ps]) await exits(tx, p, m, now, {}, e);
    }
    for (const [mint, list] of pending)
      for (const i of [...list]) if (now - i.fill_after_ms > F.staleFillMs) await fillIntent(tx, i, market.get(mint) ?? null, now, e);
    for (const [mint, list] of fills) for (const f of [...list]) if (now - f.at_ms > 360_000) await finishMarkout(tx, mint, f, e);
  }

  // ---------- intents and fills ----------
  async function newIntent(tx: Tx, i: Omit<Intent, "id" | "event_id" | "fill_after_ms">, reasons: string[], boardSnap: Record<string, unknown>, e: Envelope, gate: () => ReturnType<typeof riskGate>) {
    const id = clock.id("intent");
    const pos = i.side === "sell" ? open.get(i.mint)?.find((p) => p.id === i.position_id) : undefined;
    const fraction = pos && i.tokens != null && pos.tokens_left > 0 ? Math.min(1, i.tokens / pos.tokens_left) : null; // the live leg holds a different token count
    const ev = await tape.emitIn(
      tx, "intent.created",
      { strategy_id: i.strategy_id, mint: i.mint, side: i.side, size_sol: i.size_sol, fraction, reason: reasons, score: i.score, board: boardSnap },
      { source: "strategies", subject: id, causes: [e.id], after: e.seen_time },
    );
    bump("intents");
    const g = gate();
    if (!g.ok) {
      rejected[g.reason_code] = (rejected[g.reason_code] ?? 0) + 1;
      await tape.emitIn(tx, "order.rejected", { intent_id: id, reason_code: g.reason_code, detail: g.detail }, { source: "riskgate.paper", subject: id, causes: [ev.id], after: ev.seen_time });
      return null;
    }
    const full: Intent = { ...i, id, event_id: ev.id, fill_after_ms: i.created_ms + sampleLatencyMs(clock.rand) };
    push(pending, i.mint, full);
    await tx`insert into mind.intents (id, strategy_id, mint, side, size_sol, fraction, position_id, reason, created_at, fill_after, event_id)
      values (${id}, ${i.strategy_id}, ${i.mint}, ${i.side}, ${i.size_sol}, ${i.tokens}, ${i.position_id}, ${i.reason}, ${iso(i.created_ms)}, ${iso(full.fill_after_ms)}, ${ev.id})`;
    return full;
  }

  async function dropIntent(tx: Tx, i: Intent) {
    const list = pending.get(i.mint) ?? [];
    list.splice(list.indexOf(i), 1);
    if (!list.length) pending.delete(i.mint);
    await tx`delete from mind.intents where id = ${i.id}`;
  }

  async function fillIntent(tx: Tx, i: Intent, m: Market | null, now: number, e: Envelope) {
    if (!m) {
      await dropIntent(tx, i);
      if (i.side === "buy") {
        rejected.stale_quote = (rejected.stale_quote ?? 0) + 1;
        await tape.emitIn(tx, "order.rejected", { intent_id: i.id, reason_code: "stale_quote", detail: "no trade on the coin before the fill deadline" }, { source: "riskgate.paper", subject: i.id, causes: [i.event_id], after: e.seen_time });
      }
      return;
    }
    if (clock.rand() < F.failP) {
      if (i.side === "sell") {
        i.fill_after_ms = now + sampleLatencyMs(clock.rand); // a failed exit retries
        await tx`update mind.intents set fill_after = ${iso(i.fill_after_ms)} where id = ${i.id}`;
        return;
      }
      await dropIntent(tx, i);
      rejected.fill_failed = (rejected.fill_failed ?? 0) + 1;
      await tape.emitIn(tx, "order.rejected", { intent_id: i.id, reason_code: "fill_failed", detail: "modeled landing failure" }, { source: "riskgate.paper", subject: i.id, causes: [i.event_id], after: e.seen_time });
      return;
    }
    await dropIntent(tx, i);
    bump("fills");
    if (i.side === "buy") {
      const f = fillBuy(m, i.size_sol!);
      const ev = await tape.emitIn(
        tx, "intent.ghost_filled",
        { intent_id: i.id, strategy_id: i.strategy_id, mint: i.mint, side: "buy", sol: f.spent_sol, tokens: f.tokens, price_sol: f.price_sol, fee_sol: f.fee_sol + f.priority_sol, rent_sol: F.rentSol, slippage_bps: f.slippage_bps },
        { source: "strategies", subject: i.id, causes: [i.event_id, e.id], after: e.seen_time },
      );
      const spec = strategies.get(i.strategy_id)?.spec;
      const bands = (spec?.exits ?? []).map(() => 0.95 + 0.1 * clock.rand());
      const pid = clock.id("position");
      const cc = coinCallout.get(i.mint);
      const content = { position_id: pid, strategy_id: i.strategy_id, mint: i.mint, entry_price: f.price_sol, size_sol: i.size_sol, reason: i.reason, exit_bands: bands, nonce: clock.rand().toString(36).slice(2) };
      const commitId = clock.id("commit");
      const digest = sha(content);
      await tx`insert into mind.commits (commit_id, kind, sha256, content, made_at) values (${commitId}, 'decision', ${digest}, ${tx.json(content as never)}, ${iso(now)})`;
      await tape.emitIn(tx, "commit.made", { commit_id: commitId, kind: "decision", sha256: digest, reveal_after: null }, { source: "strategies", subject: commitId, causes: [ev.id], after: ev.seen_time });
      const p: Position = {
        id: pid, strategy_id: i.strategy_id, mint: i.mint, callout_id: cc?.callout_id ?? null, opened_ms: now, tokens: f.tokens, tokens_left: f.tokens,
        cost_sol: f.spent_sol + F.rentSol, proceeds_sol: 0, rent_sol: F.rentSol, entry_price: f.price_sol, bands, fired: [], commit_id: commitId,
      };
      push(open, i.mint, p);
      await tx`insert into mind.positions (id, strategy_id, mint, callout_id, opened_at, tokens, tokens_left, cost_sol, rent_sol, entry_price, exit_bands, commit_id)
        values (${pid}, ${p.strategy_id}, ${p.mint}, ${p.callout_id}, ${iso(now)}, ${p.tokens}, ${p.tokens_left}, ${p.cost_sol}, ${p.rent_sol}, ${p.entry_price}, ${tx.json(bands as never)}, ${commitId})`;
      await addFill(tx, { id: ev.id, intent_id: i.id, strategy_id: i.strategy_id, mint: i.mint, side: "buy", at_ms: now, price_sol: f.price_sol, mk: {} });
      return;
    }
    const p = (open.get(i.mint) ?? []).find((x) => x.id === i.position_id);
    if (!p) return;
    const tokens = Math.min(p.tokens_left, i.tokens ?? p.tokens_left);
    const f = fillSell(m, tokens);
    const ev = await tape.emitIn(
      tx, "intent.ghost_filled",
      { intent_id: i.id, strategy_id: i.strategy_id, mint: i.mint, side: "sell", sol: f.sol, tokens, price_sol: f.price_sol, fee_sol: f.fee_sol + f.priority_sol, rent_sol: 0, slippage_bps: f.slippage_bps },
      { source: "strategies", subject: i.id, causes: [i.event_id, e.id], after: e.seen_time },
    );
    p.tokens_left -= tokens;
    p.proceeds_sol += f.sol;
    await addFill(tx, { id: ev.id, intent_id: i.id, strategy_id: i.strategy_id, mint: i.mint, side: "sell", at_ms: now, price_sol: f.price_sol, mk: {} });
    const exitRec = { i: Number(i.reason.split(":")[1] ?? -1), at: iso(now), tokens, sol: f.sol, reason: i.reason };
    if (p.tokens_left <= p.tokens * 1e-9) await close(tx, p, i.reason, now, ev, exitRec);
    else await tx`update mind.positions set tokens_left = ${p.tokens_left}, proceeds_sol = ${p.proceeds_sol}, exits = exits || ${tx.json([exitRec] as never)} where id = ${p.id}`;
  }

  async function close(tx: Tx, p: Position, reason: string, now: number, ev: Envelope, exitRec: Record<string, unknown>) {
    const net = p.proceeds_sol + p.rent_sol - p.cost_sol; // the token account is closed after the full exit: rent comes back
    const list = open.get(p.mint)!;
    list.splice(list.indexOf(p), 1);
    if (!list.length) open.delete(p.mint);
    lastExit.set(`${p.strategy_id}:${p.mint}`, now);
    await tx`update mind.positions set tokens_left = 0, proceeds_sol = ${p.proceeds_sol}, exits = exits || ${tx.json([exitRec] as never)},
      closed_at = ${iso(now)}, net_sol = ${net}, exit_reason = ${reason} where id = ${p.id}`;
    await tape.emitIn(
      tx, "position.closed",
      { position_id: p.id, strategy_id: p.strategy_id, mint: p.mint, cost_sol: p.cost_sol, proceeds_sol: p.proceeds_sol, rent_refund_sol: p.rent_sol, net_sol: net, held_ms: now - p.opened_ms, exit_reason: reason },
      { source: "strategies", subject: p.id, causes: [ev.id], after: ev.seen_time },
    );
    if (p.commit_id) {
      const [c] = await tx`update mind.commits set revealed_at = ${iso(now)} where commit_id = ${p.commit_id} returning sha256, content`;
      if (c) await tape.emitIn(tx, "commit.revealed", { commit_id: p.commit_id, content: c.content, matches: sha(c.content) === c.sha256 }, { source: "strategies", subject: p.commit_id, causes: [ev.id], after: ev.seen_time });
    }
    bump("closes");
    realized.set(p.strategy_id, (realized.get(p.strategy_id) ?? 0) + net);
    const t = closedToday.get(p.strategy_id);
    closedToday.set(p.strategy_id, { day: day(now), net: (t && t.day === day(now) ? t.net : 0) + net });
    const s = st.get(p.strategy_id) ?? emptyStats();
    const r = net / Math.max(1e-9, p.cost_sol - p.rent_sol);
    s.n++;
    s.sum += r;
    s.sq += r * r;
    if (r > 0) s.wins++;
    s.rets = [...s.rets, r].slice(-400);
    s.equity += net;
    s.peak = Math.max(s.peak, s.equity);
    s.max_dd = Math.max(s.max_dd, s.peak - s.equity);
    s.last_trade_ms = now;
    st.set(p.strategy_id, s);
    await saveStats(tx, p.strategy_id);
  }

  // ---------- markouts ----------
  async function addFill(tx: Tx, f: Fill) {
    push(fills, f.mint, f);
    await tx`insert into mind.fills (id, intent_id, strategy_id, mint, side, at, price_sol) values (${f.id}, ${f.intent_id}, ${f.strategy_id}, ${f.mint}, ${f.side}, ${iso(f.at_ms)}, ${f.price_sol})`;
  }

  async function markouts(tx: Tx, mint: string, price: number, now: number, e: Envelope) {
    for (const f of [...(fills.get(mint) ?? [])]) {
      let changed = false;
      for (const h of D.markouts) {
        const k = MK_KEYS[h];
        if (f.mk[k] === undefined && now >= f.at_ms + h * 1000) {
          f.mk[k] = (f.side === "buy" ? price / f.price_sol - 1 : 1 - price / f.price_sol) * 10_000;
          changed = true;
        }
      }
      if (D.markouts.every((h) => f.mk[MK_KEYS[h]] !== undefined)) await finishMarkout(tx, mint, f, e);
      else if (changed) await tx`update mind.fills set mk = ${tx.json(f.mk as never)} where id = ${f.id}`;
    }
  }

  async function finishMarkout(tx: Tx, mint: string, f: Fill, e: Envelope) {
    const list = fills.get(mint) ?? [];
    list.splice(list.indexOf(f), 1);
    if (!list.length) fills.delete(mint);
    const v = (k: string) => (f.mk[k] === undefined ? null : f.mk[k]!);
    await tx`update mind.fills set mk = ${tx.json(f.mk as never)}, done = true where id = ${f.id}`;
    await tape.emitIn(tx, "markout.measured", { fill_id: f.id, mint, side: f.side, h1s: v("h1s"), h10s: v("h10s"), h60s: v("h60s"), h5m: v("h5m") }, { source: "strategies", subject: f.id, causes: [f.id], after: e.seen_time });
    bump("markouts");
    const s = st.get(f.strategy_id);
    if (s && f.side === "buy" && f.mk.h60s != null) {
      s.mk60 = [...s.mk60, f.mk.h60s].slice(-200);
      await saveStats(tx, f.strategy_id);
    }
  }

  // ---------- exits and entries ----------
  async function exits(tx: Tx, p: Position, m: Market, now: number, board: BoardValues, e: Envelope) {
    if ((pending.get(p.mint) ?? []).some((i) => i.position_id === p.id)) return;
    const spec = strategies.get(p.strategy_id)?.spec;
    const cc = coinCallout.get(p.mint);
    const ctx = { mult: m.price_sol / p.entry_price, heldMin: (now - p.opened_ms) / 60_000, calledS: cc && cc.at_ms > p.opened_ms ? (now - cc.at_ms) / 1000 : null, board };
    let sell: { tokens: number; reason: string } | null = null;
    if (!spec) sell = { tokens: p.tokens_left, reason: "exit:-1:retired" };
    else if (spec.stop.any.some((w) => whenHolds(w, ctx))) sell = { tokens: p.tokens_left, reason: "exit:-1:stop" };
    else
      for (const [k, x] of spec.exits.entries()) {
        if (p.fired.includes(k) || !whenHolds(x.when, ctx, p.bands[k] ?? 1)) continue;
        p.fired.push(k);
        sell = { tokens: Math.min(p.tokens_left, x.sell * p.tokens), reason: `exit:${k}:${Object.keys(x.when)[0]}` };
        break;
      }
    if (!sell) return;
    await newIntent(tx, { strategy_id: p.strategy_id, mint: p.mint, side: "sell", size_sol: null, tokens: sell.tokens, position_id: p.id, reason: sell.reason, created_ms: now, score: null },
      [sell.reason, `mult ${ctx.mult.toFixed(3)}`, `held ${ctx.heldMin.toFixed(1)} min`], { mult: ctx.mult },
      e, () => riskGate({ id: "", mint: p.mint, side: "sell", size_sol: 0, duplicate: false }, book(p.strategy_id, now), limits, null, { kill: "running", mode_ok: true, strategy_live: true }, now));
  }

  /** The caller the Board is about: the latest callout's author, or a known caller who bought since (pre-call). */
  function callerOf(mint: string) {
    const cc = coinCallout.get(mint);
    const pc = coinPrecall.get(mint);
    return pc && (!cc || pc.at_ms > cc.at_ms) ? pc.caller : (cc?.author ?? null);
  }

  /** In play (docs/STRATEGY.md): called within the entry window, or bought by a known caller within it. */
  function inPlay(mint: string, now: number) {
    const cc = coinCallout.get(mint);
    const pc = coinPrecall.get(mint);
    return (!!cc && now - cc.at_ms <= D.entryWindowMs) || (!!pc && now - pc.at_ms <= D.entryWindowMs);
  }

  async function boardFor(tx: Tx, mint: string, at: string): Promise<BoardValues> {
    const cc = coinCallout.get(mint);
    const author = callerOf(mint);
    const rows = await Promise.all([liveFor(tx, mint, at), cc ? liveFor(tx, cc.callout_id, at) : {}, author ? liveFor(tx, author, at) : {}]);
    const out: BoardValues = {};
    for (const r of rows) for (const [k, v] of Object.entries(r)) out[k] = v.value as Record<string, unknown>;
    return out;
  }

  async function entries(tx: Tx, mint: string, now: number, e: Envelope) {
    const cc = coinCallout.get(mint);
    const m = market.get(mint);
    if (!m || m.graduated || !inPlay(mint, now)) return;
    lastEval.set(mint, now);
    if (cc) await tx`update mind.coin_callout set last_eval = ${iso(now)} where mint = ${mint}`;
    else await tx`update mind.coin_precall set last_eval = ${iso(now)} where mint = ${mint}`;
    const board = await boardFor(tx, mint, e.seen_time);
    const quote = quoteFor(m);
    const busy = new Set([...(open.get(mint) ?? []), ...(pending.get(mint) ?? [])].map((x) => x.strategy_id));
    for (const { spec } of strategies.values()) {
      if (busy.has(spec.id) || now - (lastExit.get(`${spec.id}:${mint}`) ?? -Infinity) < D.reentryMs) continue;
      bump("evaluations");
      const s = st.get(spec.id);
      const d = evaluateEntry(spec, board, quote, s?.stage === "full" ? { budget_sol: s.share * D.bookSol } : { fixed_sol: limits.probe_order_sol });
      if (!d.enter) continue;
      const size = Math.min(d.size_sol, limits.max_order_sol); // sizes are clamped to limits; the gate checks anyway
      const q = quote(size);
      await newIntent(tx, { strategy_id: spec.id, mint, side: "buy", size_sol: size, tokens: null, position_id: null, reason: "entry", created_ms: now, score: d.score },
        [`score ${d.score.toFixed(3)} >= ${spec.enter_if.score_gte.toFixed(3)}`, `edge ${d.edge_bps.toFixed(0)} bps > cost ${d.cost_bps.toFixed(0)} bps`],
        { terms: d.terms, edge_bps: d.edge_bps, cost_bps: d.cost_bps, callout_id: cc?.callout_id ?? null, caller: callerOf(mint) },
        e, () => riskGate({ id: "", mint, side: "buy", size_sol: size, duplicate: false, caller: callerOf(mint) }, book(spec.id, now), limits,
          { at_ms: m.at_ms, impact_bps: q.impact_bps, real_sol: m.real_sol, graduated: m.graduated, risk: (board["risk.state"] as GateRisk | undefined) ?? null }, { kill: "running", mode_ok: true, strategy_live: true }, now));
    }
  }

  // ---------- consumer ----------
  return {
    name: "desk",
    startAtHead: true,
    topics: ["callout.created", "jev.answer", "trade.curve", "trade.amm", "limits.changed", "lists.loaded"],
    batch: 500,
    stats,
    async handle(events, tx) {
      try {
        if (!loaded) await load(tx);
        for (const e of events) {
          const now = Date.parse(e.seen_time);
          clock.advance?.(now);
          if (e.topic === "limits.changed" || e.topic === "lists.loaded") {
            limits = await loadLimits(tx, e.seen_time);
            continue;
          }
          await rounds(tx, e, now);
          if (e.topic === "callout.created") {
            const b = e.body as BodyOf<"callout.created">;
            if (b.via === "history") continue; // the Index's backfill: known callers, never an entry
            coinCallout.set(b.mint, { callout_id: b.callout_id, author: b.author_wallet, at_ms: now });
            calloutMint.set(b.callout_id, b.mint);
            await tx`insert into mind.coin_callout (mint, callout_id, author_wallet, at) values (${b.mint}, ${b.callout_id}, ${b.author_wallet}, ${e.seen_time})
              on conflict (mint) do update set callout_id = excluded.callout_id, author_wallet = excluded.author_wallet, at = excluded.at`;
            if (market.has(b.mint)) await entries(tx, b.mint, now, e);
          } else if (e.topic === "jev.answer") {
            const mint = calloutMint.get((e.body as BodyOf<"jev.answer">).subject);
            if (mint && coinCallout.get(mint)?.callout_id === (e.body as BodyOf<"jev.answer">).subject && market.has(mint)) await entries(tx, mint, now, e);
          } else {
            const t = e.body as BodyOf<"trade.curve">;
            if (!t.price_sol) continue;
            if (t.side === "buy") {
              // the pre-call analyzer ran on this trade first (buildConsumers order): a signal citing it means a known caller bought
              const [pc] = await tx`select value->>'caller' caller from board.signals where kind = 'precall.callout_p' and subject = ${t.mint}
                and produced_at = ${e.seen_time} and ${e.id} = any(inputs) limit 1`;
              if (pc) {
                coinPrecall.set(t.mint, { caller: pc.caller as string, at_ms: now });
                await tx`insert into mind.coin_precall (mint, caller, at) values (${t.mint}, ${pc.caller as string}, ${e.seen_time})
                  on conflict (mint) do update set caller = excluded.caller, at = excluded.at`;
              }
            }
            const prev = market.get(t.mint);
            const graduated = e.topic === "trade.amm";
            const m = { price_sol: t.price_sol, at_ms: now, graduated, real_sol: graduated ? null : curveFromPrice(t.price_sol).realSol };
            market.set(t.mint, m);
            for (const i of [...(pending.get(t.mint) ?? [])]) if (now >= i.fill_after_ms) await fillIntent(tx, i, m, now, e);
            if (fills.has(t.mint)) await markouts(tx, t.mint, t.price_sol, now, e);
            if (open.has(t.mint)) {
              const needsBoard = [...open.get(t.mint)!].some((p) => strategies.get(p.strategy_id)?.spec.stop.any.some((w) => "sig" in w));
              const board = needsBoard ? await boardFor(tx, t.mint, e.seen_time) : {};
              for (const p of [...(open.get(t.mint) ?? [])]) await exits(tx, p, m, now, board, e);
            }
            if (inPlay(t.mint, now) && (!prev || now - (lastEval.get(t.mint) ?? 0) >= D.evalMinMs)) await entries(tx, t.mint, now, e);
          }
        }
      } catch (err) {
        loaded = false; // the transaction rolls back; reload state from Postgres next batch
        throw err;
      }
    },
  };
}
