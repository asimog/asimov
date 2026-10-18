// Every bad intent in docs/08's reason-code list must be refused with its own code; good intents pass.
import { type Book, DEFAULT_LIMITS, type GateFlags, type GateIntent, type GateQuote, riskGate } from "../../../../services/core/src/mind/risk.ts";
import type { Suite } from "../../lib/suite.ts";

const NOW = 1_800_000_000_000;
const book = (o: Partial<Book> = {}): Book => ({ equity_sol: 0.2, open_cost_sol: 0, open_coins: new Set(), position_sol: new Map(), realized_today_sol: 0, ...o });
const quote = (o: Partial<GateQuote> = {}): GateQuote => ({ at_ms: NOW - 500, impact_bps: 40, real_sol: 8, graduated: false, ...o });
const flags = (o: Partial<GateFlags> = {}): GateFlags => ({ kill: "running", mode_ok: true, strategy_live: true, ...o });
const buy = (o: Partial<GateIntent> = {}): GateIntent => ({ id: "in_x", mint: "MintA", side: "buy", size_sol: 0.02, duplicate: false, ...o });
const five = new Set(["a", "b", "c", "d", "e"]);

const CASES: { name: string; expect: string | "ok"; run: () => ReturnType<typeof riskGate> }[] = [
  { name: "clean buy passes", expect: "ok", run: () => riskGate(buy(), book(), DEFAULT_LIMITS, quote(), flags(), NOW) },
  { name: "sell passes with no quote", expect: "ok", run: () => riskGate(buy({ side: "sell" }), book(), DEFAULT_LIMITS, null, flags(), NOW) },
  { name: "exit_only stops buys", expect: "kill_switch", run: () => riskGate(buy(), book(), DEFAULT_LIMITS, quote(), flags({ kill: "exit_only" }), NOW) },
  { name: "halted stops sells", expect: "kill_switch", run: () => riskGate(buy({ side: "sell" }), book(), DEFAULT_LIMITS, quote(), flags({ kill: "halted" }), NOW) },
  { name: "exit_only lets sells through", expect: "ok", run: () => riskGate(buy({ side: "sell" }), book(), DEFAULT_LIMITS, quote(), flags({ kill: "exit_only" }), NOW) },
  { name: "zero-size buy", expect: "order_cap", run: () => riskGate(buy({ size_sol: 0 }), book(), DEFAULT_LIMITS, quote(), flags(), NOW) },
  { name: "mode does not allow", expect: "mode_not_live", run: () => riskGate(buy(), book(), DEFAULT_LIMITS, quote(), flags({ mode_ok: false }), NOW) },
  { name: "duplicate intent", expect: "duplicate_intent", run: () => riskGate(buy({ duplicate: true }), book(), DEFAULT_LIMITS, quote(), flags(), NOW) },
  { name: "strategy without capital", expect: "strategy_not_live", run: () => riskGate(buy(), book(), DEFAULT_LIMITS, quote(), flags({ strategy_live: false }), NOW) },
  { name: "own coin", expect: "own_coin", run: () => riskGate(buy({ mint: "Ours" }), book(), { ...DEFAULT_LIMITS, own_mints: ["Ours"] }, quote(), flags(), NOW) },
  { name: "blocklisted coin", expect: "blocklisted", run: () => riskGate(buy({ mint: "Bad" }), book(), { ...DEFAULT_LIMITS, blocklist: ["Bad"] }, quote(), flags(), NOW) },
  { name: "no quote", expect: "stale_quote", run: () => riskGate(buy(), book(), DEFAULT_LIMITS, null, flags(), NOW) },
  { name: "quote 4 s old", expect: "stale_quote", run: () => riskGate(buy(), book(), DEFAULT_LIMITS, quote({ at_ms: NOW - 4000 }), flags(), NOW) },
  { name: "thin curve", expect: "liquidity_too_low", run: () => riskGate(buy(), book(), DEFAULT_LIMITS, quote({ real_sol: 1.2 }), flags(), NOW) },
  { name: "impact 450 bps", expect: "impact_too_high", run: () => riskGate(buy(), book(), DEFAULT_LIMITS, quote({ impact_bps: 450 }), flags(), NOW) },
  { name: "order 0.05 SOL", expect: "order_cap", run: () => riskGate(buy({ size_sol: 0.05 }), book(), DEFAULT_LIMITS, quote(), flags(), NOW) },
  { name: "proposal asks for 100 SOL", expect: "order_cap", run: () => riskGate(buy({ size_sol: 100 }), book({ equity_sol: 1000 }), DEFAULT_LIMITS, quote(), flags(), NOW) },
  { name: "position over 0.04 SOL", expect: "position_cap", run: () => riskGate(buy(), book({ position_sol: new Map([["MintA", 0.03]]), open_coins: new Set(["MintA"]), open_cost_sol: 0.03 }), DEFAULT_LIMITS, quote(), flags(), NOW) },
  { name: "sixth coin", expect: "open_coins_cap", run: () => riskGate(buy(), book({ open_coins: five, open_cost_sol: 0.05, equity_sol: 1 }), DEFAULT_LIMITS, quote(), flags(), NOW) },
  { name: "free SOL under the floor", expect: "wallet_balance_low", run: () => riskGate(buy(), book({ open_cost_sol: 0.09, open_coins: new Set(["x"]) }), DEFAULT_LIMITS, quote(), flags(), NOW) },
  { name: "lost 25% today", expect: "daily_loss_stop", run: () => riskGate(buy(), book({ equity_sol: 0.15, realized_today_sol: -0.05 }), DEFAULT_LIMITS, quote(), flags(), NOW) },
  { name: "graduated coin skips the curve liquidity rule", expect: "ok", run: () => riskGate(buy(), book(), DEFAULT_LIMITS, quote({ graduated: true, real_sol: null }), flags(), NOW) },
];

export const suite: Suite = {
  name: "riskgate-refuses",
  proves: "Every listed bad intent is refused with its own reason code, and clean intents pass.",
  async run() {
    const rows = CASES.map((c) => {
      const r = c.run();
      const got = r.ok ? "ok" : r.reason_code;
      return { case: c.name, expect: c.expect, got, pass: got === c.expect };
    });
    const codes = new Set(rows.filter((r) => r.got !== "ok").map((r) => r.got));
    const required = ["kill_switch", "mode_not_live", "duplicate_intent", "strategy_not_live", "own_coin", "blocklisted", "stale_quote", "liquidity_too_low", "impact_too_high", "order_cap", "position_cap", "open_coins_cap", "wallet_balance_low", "daily_loss_stop"];
    return {
      checks: [
        ...rows.map((r) => ({ name: r.case, pass: r.pass, detail: `expected ${r.expect}, got ${r.got}` })),
        { name: "every reason code exercised", pass: required.every((c) => codes.has(c)), detail: required.filter((c) => !codes.has(c)).join(", ") || "all 14" },
      ],
      metrics: { cases: rows.length, limits: DEFAULT_LIMITS },
    };
  },
};
