// Risk Gate (docs/08): a pure function. Same inputs, same answer, in ghost, paper and live.
// Limits come from mind.limits (set by the owner through the admin path). DEFAULT_LIMITS is the documented
// default for the 0.2 SOL start, used only while mind.limits is empty.

export type Limits = {
  max_order_sol: number;
  max_position_sol: number;
  max_open_coins: number;
  min_free_sol: number;
  daily_loss_stop_frac: number;
  max_impact_bps: number;
  min_real_sol: number;
  max_quote_age_ms: number;
  max_slippage_bps: number;
  blocklist: string[];
  own_mints: string[];
  // rug and bundle floor (docs/23 section 3): shares of SOL bought; top-10 of the circulating supply
  max_bundle_share: number;
  max_top10_share: number;
  max_fresh_share: number;
  max_creator_sold: number;
};

export const DEFAULT_LIMITS: Limits = {
  max_order_sol: 0.02,
  max_position_sol: 0.04,
  max_open_coins: 5,
  min_free_sol: 0.1,
  daily_loss_stop_frac: 0.25,
  max_impact_bps: 300,
  min_real_sol: 3,
  max_quote_age_ms: 3000,
  max_slippage_bps: 300,
  blocklist: [],
  own_mints: [],
  max_bundle_share: 0.2,
  max_top10_share: 0.3,
  max_fresh_share: 0.6,
  max_creator_sold: 0.5,
};

export type Book = {
  equity_sol: number; // starting capital + realized net
  open_cost_sol: number; // cost basis + rent of open positions
  open_coins: Set<string>;
  position_sol: Map<string, number>;
  realized_today_sol: number;
};

export type GateIntent = { id: string; mint: string; side: "buy" | "sell"; size_sol: number; duplicate: boolean };
export type GateRisk = { bundle_share: number; top10_share: number | null; fresh_share: number; creator_sold: number };
export type GateQuote = { at_ms: number; impact_bps: number; real_sol: number | null; graduated: boolean; risk?: GateRisk | null };
export type GateFlags = { kill: boolean; mode_ok: boolean; strategy_live: boolean };

export type GateResult = { ok: true } | { ok: false; reason_code: string; detail: string };

const no = (reason_code: string, detail: string): GateResult => ({ ok: false, reason_code, detail });

export function riskGate(i: GateIntent, book: Book, L: Limits, q: GateQuote | null, f: GateFlags, now_ms: number): GateResult {
  if (!f.mode_ok) return no("mode_not_live", "mode does not allow this order");
  if (i.duplicate) return no("duplicate_intent", "an intent for this coin is already pending");
  if (i.side === "sell") return { ok: true }; // exits reduce risk, so the kill switch never strands a position
  if (f.kill) return no("kill_switch", "kill switch is on");
  if (!(i.size_sol > 0)) return no("order_cap", `buy size ${i.size_sol} SOL is not positive`);
  if (!f.strategy_live) return no("strategy_not_live", "strategy has no capital");
  if (L.own_mints.includes(i.mint)) return no("own_coin", "never trade our own coin");
  if (L.blocklist.includes(i.mint)) return no("blocklisted", "coin is on the blocklist");
  if (!q) return no("stale_quote", "no quote for this coin");
  if (now_ms - q.at_ms > L.max_quote_age_ms) return no("stale_quote", `quote ${now_ms - q.at_ms} ms old`);
  if (!q.graduated && (q.real_sol ?? 0) < L.min_real_sol) return no("liquidity_too_low", `curve real SOL ${(q.real_sol ?? 0).toFixed(2)}`);
  if (q.impact_bps > L.max_impact_bps) return no("impact_too_high", `${q.impact_bps.toFixed(0)} bps`);
  const r = q.risk;
  if (r && r.bundle_share > L.max_bundle_share) return no("bundled", `first-slot buyers hold ${(r.bundle_share * 100).toFixed(0)}% of supply`);
  if (r && r.top10_share != null && r.top10_share > L.max_top10_share) return no("concentrated", `top 10 hold ${(r.top10_share * 100).toFixed(0)}%`);
  if (r && r.fresh_share > L.max_fresh_share) return no("fresh_wallets", `${(r.fresh_share * 100).toFixed(0)}% bought by new wallets`);
  if (r && r.creator_sold > L.max_creator_sold) return no("creator_sold", `creator sold ${(r.creator_sold * 100).toFixed(0)}%`);
  if (i.size_sol > L.max_order_sol + 1e-12) return no("order_cap", `${i.size_sol} SOL over ${L.max_order_sol}`);
  if ((book.position_sol.get(i.mint) ?? 0) + i.size_sol > L.max_position_sol + 1e-12) return no("position_cap", "combined position over cap");
  if (!book.open_coins.has(i.mint) && book.open_coins.size >= L.max_open_coins) return no("open_coins_cap", `${book.open_coins.size} coins open`);
  if (book.equity_sol - book.open_cost_sol - i.size_sol < L.min_free_sol - 1e-12) return no("wallet_balance_low", "free SOL would fall under the floor");
  if (-book.realized_today_sol >= L.daily_loss_stop_frac * Math.max(book.equity_sol - book.realized_today_sol, 1e-9))
    return no("daily_loss_stop", `lost ${(-book.realized_today_sol).toFixed(4)} SOL today`);
  return { ok: true };
}
