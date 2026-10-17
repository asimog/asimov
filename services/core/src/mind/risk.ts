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
  blocklist: string[];
  own_mints: string[];
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
  blocklist: [],
  own_mints: [],
};

export type Book = {
  equity_sol: number; // starting capital + realized net
  open_cost_sol: number; // cost basis + rent of open positions
  open_coins: Set<string>;
  position_sol: Map<string, number>;
  realized_today_sol: number;
};

export type GateIntent = { id: string; mint: string; side: "buy" | "sell"; size_sol: number; duplicate: boolean };
export type GateQuote = { at_ms: number; impact_bps: number; real_sol: number | null; graduated: boolean };
export type GateFlags = { kill: boolean; mode_ok: boolean; strategy_live: boolean };

export type GateResult = { ok: true } | { ok: false; reason_code: string; detail: string };

const no = (reason_code: string, detail: string): GateResult => ({ ok: false, reason_code, detail });

export function riskGate(i: GateIntent, book: Book, L: Limits, q: GateQuote | null, f: GateFlags, now_ms: number): GateResult {
  if (f.kill) return no("kill_switch", "kill switch is on");
  if (!f.mode_ok) return no("mode_not_live", "mode does not allow this order");
  if (i.duplicate) return no("duplicate_intent", "an intent for this coin is already pending");
  if (i.side === "sell") return { ok: true }; // exits reduce risk; only the switches above stop them
  if (!f.strategy_live) return no("strategy_not_live", "strategy has no capital");
  if (L.own_mints.includes(i.mint)) return no("own_coin", "never trade our own coin");
  if (L.blocklist.includes(i.mint)) return no("blocklisted", "coin is on the blocklist");
  if (!q) return no("stale_quote", "no quote for this coin");
  if (now_ms - q.at_ms > L.max_quote_age_ms) return no("stale_quote", `quote ${now_ms - q.at_ms} ms old`);
  if (!q.graduated && (q.real_sol ?? 0) < L.min_real_sol) return no("liquidity_too_low", `curve real SOL ${(q.real_sol ?? 0).toFixed(2)}`);
  if (q.impact_bps > L.max_impact_bps) return no("impact_too_high", `${q.impact_bps.toFixed(0)} bps`);
  if (i.size_sol > L.max_order_sol + 1e-12) return no("order_cap", `${i.size_sol} SOL over ${L.max_order_sol}`);
  if ((book.position_sol.get(i.mint) ?? 0) + i.size_sol > L.max_position_sol + 1e-12) return no("position_cap", "combined position over cap");
  if (!book.open_coins.has(i.mint) && book.open_coins.size >= L.max_open_coins) return no("open_coins_cap", `${book.open_coins.size} coins open`);
  if (book.equity_sol - book.open_cost_sol - i.size_sol < L.min_free_sol - 1e-12) return no("wallet_balance_low", "free SOL would fall under the floor");
  if (-book.realized_today_sol >= L.daily_loss_stop_frac * Math.max(book.equity_sol - book.realized_today_sol, 1e-9))
    return no("daily_loss_stop", `lost ${(-book.realized_today_sol).toFixed(4)} SOL today`);
  return { ok: true };
}
