// The live gate (docs/09): the only writer of order.created. An intent of a strategy listed in LIVE_STRATEGIES becomes an
// order only in live mode, only after the Risk Gate says yes, with the kill switch read from ops.kill. Everything else
// stays on the paper desk. Default: LIVE_STRATEGIES is empty, so nothing here ever fires until the owner says so (S6.8).
import type { Envelope } from "@asimog/contracts";
import { quoteFor } from "../mind/fill.ts";
import { type Book, DEFAULT_LIMITS, type GateRisk, type Limits, riskGate } from "../mind/risk.ts";
import { curveFromPrice } from "../analyzers/curve-math.ts";
import { liveFor } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { killed } from "../treasury/kill.ts";
import { LAMPORTS } from "./builder.ts";

export type GateConfig = { live: () => boolean; strategies: () => Set<string> };
const fromEnv: GateConfig = { live: () => env.opt("ASIMOG_MODE") === "live", strategies: () => new Set((env.opt("LIVE_STRATEGIES") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) };

export function orderGate(tape: Tape, clock: Clock, wallets: { trade: string }, cfg: GateConfig = fromEnv): Consumer {
  async function book(tx: Tx, now: number): Promise<Book> {
    const [bal] = await tx`select lamports from books.balances where account = ${`sol:${wallets.trade}`}`;
    const lots = await tx`select mint, sum(cost_sol)::float cost from books.lots group by 1`;
    const [day] = await tx`select coalesce(sum(realized_sol), 0)::float r from books.realized where day = ${new Date(now).toISOString().slice(0, 10)}`;
    const openCost = lots.reduce((s, l) => s + (l.cost as number), 0);
    return {
      equity_sol: Number(bal?.lamports ?? 0) / LAMPORTS + openCost,
      open_cost_sol: openCost,
      open_coins: new Set(lots.map((l) => l.mint as string)),
      position_sol: new Map(lots.map((l) => [l.mint as string, l.cost as number])),
      realized_today_sol: day!.r as number,
    };
  }

  async function handleOne(tx: Tx, e: Envelope, liveSet: Set<string>) {
    const b = e.body as { strategy_id: string; mint: string; side: "buy" | "sell"; size_sol: number | null; fraction: number | null };
    if (!liveSet.has(b.strategy_id)) return;
    const intentId = e.subject as string;
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
    const g = riskGate({ id: intentId, mint: b.mint, side: b.side, size_sol: b.size_sol ?? 0, duplicate: !!dup }, await book(tx, now), limits, quote, { kill: await killed(tx), mode_ok: cfg.live(), strategy_live: liveSet.has(b.strategy_id) } /* handle() already skips both; passed for real so the gate checks them too */, now);
    if (!g.ok) return void (await tape.emitIn(tx, "order.rejected", { intent_id: intentId, reason_code: g.reason_code, detail: g.detail }, { source: "riskgate", subject: intentId, causes: [e.id], after: e.seen_time }));
    const orderId = clock.id("order");
    await tape.emitIn(tx, "order.created", { order_id: orderId, intent_id: intentId, strategy_id: b.strategy_id, mint: b.mint, side: b.side, size_sol: b.size_sol, fraction: b.fraction, max_slippage_bps: limits.max_slippage_bps, limits_version: Number(lim?.version ?? 0) },
      { source: "riskgate", subject: orderId, causes: [e.id], after: e.seen_time });
  }

  return {
    name: "order.gate",
    topics: ["intent.created"],
    startAtHead: true,
    async handle(events, tx) {
      if (!cfg.live()) return;
      const liveSet = cfg.strategies();
      if (!liveSet.size) return;
      for (const e of events) await handleOne(tx, e, liveSet);
    },
  };
}
