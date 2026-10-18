// Pump bonding-curve math, ported from @pump-fun/pump-sdk (getBuyTokenAmountFromSolAmount,
// getSellSolAmountFromTokenAmount) in integers (lamports, base token units). The `amm-golden` suite compares it with
// the SDK on every run. Fees: protocol and creator basis points on the SOL side (the SDK's flat schedule).
export type Curve = { vTok: bigint; vSol: bigint; realTok: bigint; realSol: bigint };
export type Fees = { protocolBps: bigint; creatorBps: bigint };

/** Mainnet defaults read on 2026-10-17 (docs/21): 1,073,000,000 tokens (6 decimals), 30 SOL virtual, 793,100,000 real. */
export const START: Curve = { vTok: 1_073_000_000_000_000n, vSol: 30_000_000_000n, realTok: 793_100_000_000_000n, realSol: 0n };
export const FEES: Fees = { protocolBps: 95n, creatorBps: 30n };

const fee = (amount: bigint, bps: bigint) => (amount * bps + 9999n) / 10_000n;

/** Tokens received for `lamports` paid in, fees included. */
export function buyTokens(c: Curve, lamports: bigint, f: Fees = FEES): bigint {
  if (lamports <= 0n || c.vTok === 0n) return 0n;
  const input = ((lamports - 1n) * 10_000n) / (f.protocolBps + f.creatorBps + 10_000n);
  const out = (input * c.vTok) / (c.vSol + input);
  return out < c.realTok ? out : c.realTok;
}

/** Lamports received for selling `tokens`, after fees. */
export function sellSol(c: Curve, tokens: bigint, f: Fees = FEES): bigint {
  if (tokens <= 0n || c.vTok === 0n) return 0n;
  const gross = (tokens * c.vSol) / (c.vTok + tokens);
  return gross - (fee(gross, f.protocolBps) + fee(gross, f.creatorBps));
}

/** The curve after a buy (returns the tokens too). */
export function applyBuy(c: Curve, lamports: bigint, f: Fees = FEES): { curve: Curve; tokens: bigint } {
  const tokens = buyTokens(c, lamports, f);
  const input = ((lamports - 1n) * 10_000n) / (f.protocolBps + f.creatorBps + 10_000n);
  return { tokens, curve: { vTok: c.vTok - tokens, vSol: c.vSol + input, realTok: c.realTok - tokens, realSol: c.realSol + input } };
}

/** The curve after a sell (returns the SOL too). */
export function applySell(c: Curve, tokens: bigint, f: Fees = FEES): { curve: Curve; lamports: bigint } {
  const gross = (tokens * c.vSol) / (c.vTok + tokens);
  const lamports = sellSol(c, tokens, f);
  return { lamports, curve: { vTok: c.vTok + tokens, vSol: c.vSol - gross, realTok: c.realTok + tokens, realSol: c.realSol > gross ? c.realSol - gross : 0n } };
}

/** Recover a curve from the last traded price (SOL per whole token), like core's curveFromPrice, in integers. */
export function curveFromPrice(priceSol: number): Curve {
  const k = Number(START.vSol) * Number(START.vTok);
  const priceBase = priceSol * 1e9 / 1e6; // lamports per base token unit
  const vSol = Math.sqrt(k * priceBase);
  const vTok = Math.sqrt(k / priceBase);
  const sold = Math.max(0, Number(START.vTok) - vTok);
  return { vTok: BigInt(Math.round(vTok)), vSol: BigInt(Math.round(vSol)), realTok: START.realTok - BigInt(Math.round(Math.min(sold, Number(START.realTok)))), realSol: BigInt(Math.max(0, Math.round(vSol - Number(START.vSol)))) };
}

export const spotLamportsPerToken = (c: Curve) => Number(c.vSol) / Number(c.vTok);
