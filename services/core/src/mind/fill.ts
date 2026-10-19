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

export type Market = { price_sol: number; at_ms: number; graduated: boolean };

export type BuyFill = { tokens: number; price_sol: number; fee_sol: number; priority_sol: number; slippage_bps: number; spent_sol: number };
export type SellFill = { sol: number; price_sol: number; fee_sol: number; priority_sol: number; slippage_bps: number };

export function fillBuy(m: Market, sol: number): BuyFill {
  if (m.graduated) {
    const tokens = (sol * (1 - F.ammFee)) / m.price_sol;
    return { tokens, price_sol: sol / tokens, fee_sol: sol * F.ammFee, priority_sol: F.priorityFeeSol, slippage_bps: F.ammFee * 10_000, spent_sol: sol + F.priorityFeeSol };
  }
  const q = quoteBuy(curveFromPrice(m.price_sol), sol);
  return { tokens: q.tokens, price_sol: q.avg_price, fee_sol: sol * FEE, priority_sol: F.priorityFeeSol, slippage_bps: q.slippage_bps, spent_sol: sol + F.priorityFeeSol };
}

export function fillSell(m: Market, tokens: number): SellFill {
  const gross = tokens * m.price_sol;
  if (m.graduated) {
    const sol = gross * (1 - F.ammFee) - F.priorityFeeSol;
    return { sol, price_sol: (sol + F.priorityFeeSol) / tokens, fee_sol: gross * F.ammFee, priority_sol: F.priorityFeeSol, slippage_bps: F.ammFee * 10_000 };
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
  if (m.graduated) return (_sol: number) => ({ slippage_bps: F.ammFee * 10_000, impact_bps: 0 });
  const c = curveFromPrice(m.price_sol);
  return (sol: number) => quoteBuy(c, sol);
}
