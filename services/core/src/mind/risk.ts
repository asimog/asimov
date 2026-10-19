// Risk Gate (docs/STRATEGY.md): a pure function. Same inputs, same answer, in ghost, paper and live.
import type { KillState } from "@asimog/contracts";
import type { Sql } from "../lib/db.ts";
import type { Tx } from "../tape/consumer.ts";
// Limits come from mind.limits and the lists from mind.lists, both set by the owner with the admin token (ctl limits,
// ctl lists). DEFAULT_LIMITS is the documented default for the 0.2 SOL start, used for every key the owner has not set.

export type Limits = {
  max_order_sol: number;
  /** the one fixed size of a ghost or probe strategy's buy, until the kernel gives it a full share */
  probe_order_sol: number;
  max_position_sol: number;
  max_open_coins: number;
  min_free_sol: number;
  daily_loss_stop_frac: number;
  max_impact_bps: number;
  min_real_sol: number;
  max_quote_age_ms: number;
  max_slippage_bps: number;
  blocked_mints: string[];
  own_mints: string[];
  blocked_creators: string[];
  blocked_wallets: string[];
  // rug and bundle floor (docs/PIPELINE.md section 3): shares of SOL bought; top-10 of the circulating supply
  max_bundle_share: number;
  max_top10_share: number;
  max_creator_sold: number;
};

export const DEFAULT_LIMITS: Limits = {
  max_order_sol: 0.02,
  probe_order_sol: 0.01,
  max_position_sol: 0.04,
  max_open_coins: 5,
  min_free_sol: 0.1,
  daily_loss_stop_frac: 0.25,
  max_impact_bps: 300,
  min_real_sol: 3,
  max_quote_age_ms: 3000,
  max_slippage_bps: 300,
  blocked_mints: [],
  own_mints: [],
  blocked_creators: [],
  blocked_wallets: [],
  max_bundle_share: 0.2,
  max_top10_share: 0.3,
  max_creator_sold: 0.5,
};

export type Book = {
  equity_sol: number; // starting capital + realized net
  open_cost_sol: number; // cost basis + rent of open positions
  open_coins: Set<string>;
  position_sol: Map<string, number>;
  realized_today_sol: number;
};

/** One book shape for the ghost desk and the live gate, so both check the same caps. */
export function bookFrom(equity_sol: number, lots: { mint: string; cost_sol: number; rent_sol: number }[], realized_today_sol: number): Book {
  const b: Book = { equity_sol, open_cost_sol: 0, open_coins: new Set(), position_sol: new Map(), realized_today_sol };
  for (const l of lots) {
    b.open_cost_sol += l.cost_sol;
    b.open_coins.add(l.mint);
    b.position_sol.set(l.mint, (b.position_sol.get(l.mint) ?? 0) + l.cost_sol - l.rent_sol);
  }
  return b;
}

/** The owner's limits and lists in force at `asOf` (the newest when omitted). */
export async function loadLimits(sql: Sql | Tx, asOf?: string): Promise<Limits> {
  const known = asOf ? sql`where set_at <= ${asOf}` : sql``;
  const [lim] = await sql`select body from mind.limits ${known} order by version desc limit 1`;
  const lists = await sql`select distinct on (kind) kind, items from mind.lists ${known} order by kind, version desc`;
  const L: Limits = { ...DEFAULT_LIMITS, ...((lim?.body as Partial<Limits> | undefined) ?? {}) };
  for (const r of lists) if (r.kind in L) (L as Record<string, unknown>)[r.kind as string] = r.items;
  return L;
}

export type GateIntent = { id: string; mint: string; side: "buy" | "sell"; size_sol: number; duplicate: boolean; creator?: string | null; caller?: string | null };
export type GateRisk = { bundle_share: number; top10_share: number | null; creator_sold: number };
export type GateQuote = { at_ms: number; impact_bps: number; real_sol: number | null; graduated: boolean; risk?: GateRisk | null };
export type GateFlags = { kill: KillState; mode_ok: boolean; strategy_live: boolean };

export type GateResult = { ok: true } | { ok: false; reason_code: string; detail: string };

const no = (reason_code: string, detail: string): GateResult => ({ ok: false, reason_code, detail });

export function riskGate(i: GateIntent, book: Book, L: Limits, q: GateQuote | null, f: GateFlags, now_ms: number): GateResult {
  if (f.kill === "halted") return no("kill_switch", "halted: nothing trades");
  if (!f.mode_ok) return no("mode_not_live", "mode does not allow this order");
  if (i.duplicate) return no("duplicate_intent", "an intent for this coin is already pending");
  if (i.side === "sell") return { ok: true }; // exits reduce risk: exit_only still lets them run
  if (f.kill !== "running") return no("kill_switch", `${f.kill}: no new buys`);
  if (!(i.size_sol > 0)) return no("order_cap", `buy size ${i.size_sol} SOL is not positive`);
  if (!f.strategy_live) return no("strategy_not_live", "strategy has no capital");
  if (L.own_mints.includes(i.mint)) return no("own_coin", "never trade our own coin");
  if (L.blocked_mints.includes(i.mint)) return no("blocklisted", "coin is on the blocklist");
  if (i.creator && L.blocked_creators.includes(i.creator)) return no("blocklisted", "creator is on the blocklist");
  if (i.caller && L.blocked_wallets.includes(i.caller)) return no("blocklisted", "caller wallet is on the blocklist");
  if (!q) return no("stale_quote", "no quote for this coin");
  if (now_ms - q.at_ms > L.max_quote_age_ms) return no("stale_quote", `quote ${now_ms - q.at_ms} ms old`);
  if (!q.graduated && (q.real_sol ?? 0) < L.min_real_sol) return no("liquidity_too_low", `curve real SOL ${(q.real_sol ?? 0).toFixed(2)}`);
  if (q.impact_bps > L.max_impact_bps) return no("impact_too_high", `${q.impact_bps.toFixed(0)} bps`);
  const r = q.risk;
  if (r && r.bundle_share > L.max_bundle_share) return no("bundled", `first-slot buyers hold ${(r.bundle_share * 100).toFixed(0)}% of supply`);
  if (r && r.top10_share != null && r.top10_share > L.max_top10_share) return no("concentrated", `top 10 hold ${(r.top10_share * 100).toFixed(0)}%`);
  if (r && r.creator_sold > L.max_creator_sold) return no("creator_sold", `creator sold ${(r.creator_sold * 100).toFixed(0)}%`);
  if (i.size_sol > L.max_order_sol + 1e-12) return no("order_cap", `${i.size_sol} SOL over ${L.max_order_sol}`);
  if ((book.position_sol.get(i.mint) ?? 0) + i.size_sol > L.max_position_sol + 1e-12) return no("position_cap", "combined position over cap");
  if (!book.open_coins.has(i.mint) && book.open_coins.size >= L.max_open_coins) return no("open_coins_cap", `${book.open_coins.size} coins open`);
  if (book.equity_sol - book.open_cost_sol - i.size_sol < L.min_free_sol - 1e-12) return no("wallet_balance_low", "free SOL would fall under the floor");
  if (-book.realized_today_sol >= L.daily_loss_stop_frac * Math.max(book.equity_sol - book.realized_today_sol, 1e-9))
    return no("daily_loss_stop", `lost ${(-book.realized_today_sol).toFixed(4)} SOL today`);
  return { ok: true };
}
