// Pump bonding-curve math for standard (depth 0) SOL curves: constant product on virtual reserves.
// Initial reserves read from chain on 2026-10-17 (docs/DECISIONS.md): 30 SOL virtual, 1,073,000,000 tokens virtual,
// 793,100,000 real tokens. Fees: protocol 95 bps + creator 30 bps per side (FEE_BPS overrides).
import { env } from "../lib/env.ts";

const V_SOL0 = env.num("CURVE_V_SOL0");
const V_TOK0 = env.num("CURVE_V_TOK0");
const REAL_TOK0 = env.num("CURVE_REAL_TOK0");
const K = V_SOL0 * V_TOK0;
export const FEE = env.num("FEE_BPS") / 10_000;

export type CurveState = { vSol: number; vTok: number; realSol: number; progress: number; k: number };

/** Recover the curve state from the last traded price (SOL per token). */
export function curveFromPrice(priceSol: number): CurveState {
  const vSol = Math.sqrt(K * priceSol);
  const vTok = Math.sqrt(K / priceSol);
  const sold = Math.max(0, V_TOK0 - vTok);
  return { vSol, vTok, realSol: Math.max(0, vSol - V_SOL0), progress: Math.min(1, sold / REAL_TOK0), k: K };
}

/** Buy `sol` (including fees) on the curve. */
export function quoteBuy(c: CurveState, sol: number) {
  const net = sol * (1 - FEE);
  const tokens = c.vTok - c.k / (c.vSol + net);
  const avgPrice = sol / tokens;
  const spot = c.vSol / c.vTok;
  const after = (c.vSol + net) / (c.k / (c.vSol + net));
  return { tokens, avg_price: avgPrice, impact_bps: (after / spot - 1) * 10_000, slippage_bps: (avgPrice / spot - 1) * 10_000 };
}

/** Sell `tokens` on the curve; returns SOL received after fees. */
export function quoteSell(c: CurveState, tokens: number) {
  const solOut = c.vSol - c.k / (c.vTok + tokens);
  return { sol: solOut * (1 - FEE), spot_after: (c.k / (c.vTok + tokens)) / (c.vTok + tokens) };
}
