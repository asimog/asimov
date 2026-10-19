// C8 (docs/STRATEGY.md section 8): after graduation, fills move the price with size. Real AMM trades from the recorded
// slice (tests/e2e/fixtures/pump/trades-slice.json) carry the pool's SOL reserve; the fill model treats the pool as
// constant product, so a bigger buy gets a worse average price and the gate refuses one past max_impact_bps. A graduated
// coin with no known reserve cannot be bought. No database.
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../../services/core/src/lib/env.ts";
import { fillBuy, fillSell, quoteFor } from "../../../../services/core/src/mind/fill.ts";
import { defaultLimits, riskGate } from "../../../../services/core/src/mind/risk.ts";
import { toTrade } from "../../../../services/core/src/senses/chain-reader.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "amm-impact",
  tier: "fast",
  covers: ["services/core/src/mind/fill.ts", "services/core/src/senses/chain-reader.ts"],
  proves: "C8: a real pump_amm trade gives the pool reserve; AMM buys and sells move the price with size; the gate refuses an AMM buy past max_impact_bps; with no reserve an AMM buy is refused.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const slice = JSON.parse(fs.readFileSync(path.join(env.root, "tests/e2e/fixtures/pump/trades-slice.json"), "utf8")) as { nats: { messages: { data: Record<string, unknown> }[] }[] };
    const raw = slice.nats.flatMap((n) => n.messages.map((m) => m.data)).find((d) => d.isBondingCurve === false)!;
    const t = toTrade(raw)!;
    add("a real pump_amm trade carries the pool's SOL reserve", t.on_curve === false && t.pool_sol === Number(raw.quoteReserves), `pool ${t.pool_sol} SOL, price ${t.price_sol}`);
    const curve = slice.nats.flatMap((n) => n.messages.map((m) => m.data)).find((d) => d.isBondingCurve === true)!;
    add("a curve trade carries none", toTrade(curve)!.pool_sol === null, "null");

    const m = { price_sol: t.price_sol!, at_ms: 0, graduated: true, pool_sol: t.pool_sol };
    const sizes = [0.01, 0.1, 1, 10];
    const avg = sizes.map((s) => fillBuy(m, s).price_sol);
    add("a bigger AMM buy gets a worse average price", avg.every((p, i) => i === 0 || p > avg[i - 1]!), sizes.map((s, i) => `${s} SOL: +${((avg[i]! / m.price_sol - 1) * 10_000).toFixed(0)} bps`).join(", "));
    const tokens = fillBuy(m, 1).tokens;
    const out = (x: number) => { const f = fillSell(m, x); return f.sol + f.priority_sol; }; // per-token proceeds before the fixed priority fee
    const back = out(tokens);
    const small = out(tokens / 100) * 100;
    add("a bigger AMM sell gets less per token", back < small, `${back.toFixed(4)} SOL for the whole, ${small.toFixed(4)} as 100x a hundredth`);
    const q = quoteFor(m);
    const imp = sizes.map((s) => q(s).impact_bps);
    add("impact rises with size", imp.every((x, i) => i === 0 || x > imp[i - 1]!), imp.map((x) => x.toFixed(0)).join(", "));

    const L = defaultLimits();
    const gate = (sol: number, mk = m) => {
      const qq = quoteFor(mk)(sol);
      return riskGate({ id: "i", mint: t.mint, side: "buy", size_sol: sol, duplicate: false }, { equity_sol: 1000, open_cost_sol: 0, open_coins: new Set(), position_sol: new Map(), realized_today_sol: 0 }, { ...L, max_order_sol: 100, max_position_sol: 100 },
        { at_ms: 0, impact_bps: qq.impact_bps, real_sol: null, graduated: true, risk: { bundle_share: 0, top10_share: 0.1, creator_sold: 0 } }, { kill: "running", mode_ok: true, strategy_live: true }, 0);
    };
    const big = gate(10);
    add("the gate passes a small AMM buy and refuses one past max_impact_bps", gate(0.02).ok && !big.ok && big.reason_code === "impact_too_high", big.ok ? "passed" : big.detail);
    const blind = gate(0.02, { ...m, pool_sol: null });
    add("with no known reserve an AMM buy is refused", !blind.ok && blind.reason_code === "impact_too_high", blind.ok ? "passed" : blind.detail);
    return { checks, metrics: { pool_sol: t.pool_sol } };
  },
};
