// The live gate (docs/09): the only writer of order.created. A live leg exists only for a paper decision that filled
// (intent.ghost_filled), so every live position has a ghost twin whose exit rules sell it (docs/25 5.2). Then: only for
// a strategy in LIVE_STRATEGIES, only in live mode, only after the Risk Gate says yes with the kill state from ops.kill.
// Default: LIVE_STRATEGIES is empty, so nothing here ever fires until the owner says so (S6.8).
import type { Envelope } from "@asimog/contracts";
import { quoteFor } from "../mind/fill.ts";
import { type Book, bookFrom, DEFAULT_LIMITS, type GateRisk, type Limits, riskGate } from "../mind/risk.ts";
import { curveFromPrice } from "../analyzers/curve-math.ts";
import { liveFor } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { killState } from "../treasury/kill.ts";
import { LAMPORTS } from "./builder.ts";

export type GateConfig = { live: () => boolean; strategies: () => Set<string> };
const fromEnv: GateConfig = { live: () => env.opt("ASIMOG_MODE") === "live", strategies: () => new Set((env.opt("LIVE_STRATEGIES") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) };

export function orderGate(tape: Tape, clock: Clock, wallets: { trade: string }, cfg: GateConfig = fromEnv): Consumer {
  async function book(tx: Tx, now: number): Promise<Book> {
    const [bal] = await tx`select lamports from books.balances where account = ${`sol:${wallets.trade}`}`;
    const lots = (await tx`select mint, sum(cost_sol)::float cost_sol, 0::float rent_sol from books.lots group by 1`) as unknown as { mint: string; cost_sol: number; rent_sol: number }[];
    const [day] = await tx`select coalesce(sum(realized_sol), 0)::float r from books.realized where day = ${new Date(now).toISOString().slice(0, 10)}`;
    const openCost = lots.reduce((s, l) => s + l.cost_sol, 0);
    return bookFrom(Number(bal?.lamports ?? 0) / LAMPORTS + openCost, lots, day!.r as number);
  }

  async function handleOne(tx: Tx, fill: Envelope, liveSet: Set<string>) {
    if (!liveSet.has((fill.body as { strategy_id: string }).strategy_id)) return;
    const intentId = fill.subject as string;
    const [ie] = await tx`select body from tape.events where topic = 'intent.created' and subject = ${intentId} limit 1`;
    if (!ie) return;
    const b = ie.body as { strategy_id: string; mint: string; side: "buy" | "sell"; size_sol: number | null; fraction: number | null };
    const e = fill;
    const now = Date.parse(e.seen_time);
    const [lim] = await tx`select version, body from mind.limits order by version desc limit 1`;
    const limits: Limits = { ...DEFAULT_LIMITS, ...((lim?.body as Partial<Limits> | undefined) ?? {}) };
    const [dup] = await tx`select 1 from tape.events c where c.topic = 'order.created' and c.body->>'mint' = ${b.mint} and c.body->>'strategy_id' = ${b.strategy_id}
      and c.seen_time > ${new Date(now - 600_000).toISOString()} and not exists (select 1 from hands.orders h where h.order_id = c.subject and h.state in ('filled', 'failed'))`;
    let quote = null;
    if (b.side === "buy") {
      const [t] = await tx`select topic, seen_time, (body->>'price_sol')::float p from tape.events where subject = ${b.mint} and topic in ('trade.curve', 'trade.amm')
        and seen_time <= ${e.seen_time} and body->>'price_sol' is not null order by seen_time desc, id desc limit 1`;
      if (t) {
        const graduated = t.topic === "trade.amm";
        const q = quoteFor({ price_sol: t.p as number, at_ms: (t.seen_time as Date).getTime(), graduated })(b.size_sol ?? 0);
        const board = await liveFor(tx, b.mint, e.seen_time);
        quote = { at_ms: (t.seen_time as Date).getTime(), impact_bps: q.impact_bps, real_sol: graduated ? null : curveFromPrice(t.p as number).realSol, graduated, risk: (board["risk.state"]?.value as GateRisk | undefined) ?? null };
      }
    }
    const g = riskGate({ id: intentId, mint: b.mint, side: b.side, size_sol: b.size_sol ?? 0, duplicate: !!dup }, await book(tx, now), limits, quote, { kill: await killState(tx), mode_ok: cfg.live(), strategy_live: liveSet.has(b.strategy_id) } /* handle() already skips both; passed for real so the gate checks them too */, now);
    if (!g.ok) return void (await tape.emitIn(tx, "order.rejected", { intent_id: intentId, reason_code: g.reason_code, detail: g.detail }, { source: "riskgate.live", subject: intentId, causes: [e.id], after: e.seen_time }));
    const orderId = clock.id("order");
    await tape.emitIn(tx, "order.created", { order_id: orderId, intent_id: intentId, strategy_id: b.strategy_id, mint: b.mint, side: b.side, size_sol: b.size_sol, fraction: b.fraction, max_slippage_bps: limits.max_slippage_bps, limits_version: Number(lim?.version ?? 0) },
      { source: "riskgate.live", subject: orderId, causes: [e.id], after: e.seen_time });
  }

  return {
    name: "order.gate",
    topics: ["intent.ghost_filled"],
    startAtHead: true,
    async handle(events, tx) {
      if (!cfg.live()) return;
      const liveSet = cfg.strategies();
      if (!liveSet.size) return;
      for (const e of events) await handleOne(tx, e, liveSet);
    },
  };
}
