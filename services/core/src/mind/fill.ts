// Fill model (docs/STRATEGY.md): one model for ghost, replay and live checks. An intent fills at the first trade seen after
// the modeled latency, at that trade's curve state, with pump fees, priority fee and token-account rent.
import { curveFromPrice, FEE, quoteBuy, quoteSell } from "../analyzers/curve-math.ts";
import { env } from "../lib/env.ts";

export const F = {
  latencyMedianMs: env.num("FILL_LATENCY_MEDIAN_MS"),
  latencySigma: env.num("FILL_LATENCY_SIGMA"),
  failP: env.num("FILL_FAIL_P"),
  priorityFeeSol: env.num("PRIORITY_FEE_SOL"),
  rentSol: env.num("ATA_RENT_SOL"), // a 165-byte token account, rent exempt: 2,039,280 lamports
  staleFillMs: env.int("FILL_STALE_MS"),
  ammFee: env.num("AMM_FEE_BPS") / 10_000,
};

export function sampleLatencyMs(rand: () => number) {
  const z = Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
  return Math.round(F.latencyMedianMs * Math.exp(F.latencySigma * z));
}

/** `pool_sol`: the AMM pool's SOL reserve at the last trade (graduated coins); null when no trade has carried it. */
export type Market = { price_sol: number; at_ms: number; graduated: boolean; pool_sol?: number | null };

export type BuyFill = { tokens: number; price_sol: number; fee_sol: number; priority_sol: number; slippage_bps: number; spent_sol: number };
export type SellFill = { sol: number; price_sol: number; fee_sol: number; priority_sol: number; slippage_bps: number };

/**
 * The AMM as a constant-product pool (docs/STRATEGY.md section 8): SOL reserve x from the last trade, token reserve
 * x / price. Our size moves the price, so a bigger order gets a worse average price.
 */
function pool(m: Market) {
  if (!(m.pool_sol && m.pool_sol > 0)) return null;
  return { x: m.pool_sol, y: m.pool_sol / m.price_sol };
}

export function fillBuy(m: Market, sol: number): BuyFill {
  if (m.graduated) {
    const p = pool(m);
    const net = sol * (1 - F.ammFee);
    // no reserve known: no impact can be modeled; quoteFor refuses such a buy, so this only prices a replayed record
    const tokens = p ? (p.y * net) / (p.x + net) : net / m.price_sol;
    const price_sol = sol / tokens;
    return { tokens, price_sol, fee_sol: sol * F.ammFee, priority_sol: F.priorityFeeSol, slippage_bps: (price_sol / m.price_sol - 1) * 10_000, spent_sol: sol + F.priorityFeeSol };
  }
  const q = quoteBuy(curveFromPrice(m.price_sol), sol);
  return { tokens: q.tokens, price_sol: q.avg_price, fee_sol: sol * FEE, priority_sol: F.priorityFeeSol, slippage_bps: q.slippage_bps, spent_sol: sol + F.priorityFeeSol };
}

export function fillSell(m: Market, tokens: number): SellFill {
  const gross = tokens * m.price_sol;
  if (m.graduated) {
    const p = pool(m);
    const out = p ? (p.x * tokens) / (p.y + tokens) : gross; // no reserve: the last price, for the scorekeeper's reference measure only; the desk waits for a pool
    const sol = out * (1 - F.ammFee) - F.priorityFeeSol;
    return { sol, price_sol: (sol + F.priorityFeeSol) / tokens, fee_sol: out * F.ammFee, priority_sol: F.priorityFeeSol, slippage_bps: (1 - (sol + F.priorityFeeSol) / gross) * 10_000 };
  }
  const q = quoteSell(curveFromPrice(m.price_sol), tokens);
  const before = q.sol / (1 - FEE);
  return { sol: q.sol - F.priorityFeeSol, price_sol: q.sol / tokens, fee_sol: before - q.sol, priority_sol: F.priorityFeeSol, slippage_bps: (1 - before / gross) * 10_000 };
}

/**
 * The fee side of a markout (docs/STRATEGY.md section 10): the entry price already holds the entry fee and slippage, so a
 * buy still owes the exit fee and the priority fee on both legs. Basis points of the size.
 */
export function markoutCostBps(sol: number, graduated: boolean) {
  return ((graduated ? F.ammFee : FEE) + (2 * F.priorityFeeSol) / Math.max(sol, 1e-9)) * 10_000;
}

export function quoteFor(m: Market) {
  if (m.graduated) {
    const p = pool(m);
    // no reserve, no model: an infinite impact refuses the buy (the spec's max_impact_bps, the gate's max_impact_bps)
    if (!p) return (_sol: number) => ({ slippage_bps: Number.POSITIVE_INFINITY, impact_bps: Number.POSITIVE_INFINITY });
    return (sol: number) => {
      const net = sol * (1 - F.ammFee);
      const avg = sol / ((p.y * net) / (p.x + net));
      return { slippage_bps: (avg / m.price_sol - 1) * 10_000, impact_bps: (((p.x + net) / p.x) ** 2 - 1) * 10_000 };
    };
  }
  const c = curveFromPrice(m.price_sol);
  return (sol: number) => quoteBuy(c, sol);
}
