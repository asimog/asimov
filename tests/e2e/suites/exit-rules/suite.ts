// C6 (docs/STRATEGY.md section 6): exits fire on the right condition. A desk run on a fresh database: a known caller buys,
// pre_call strategies enter; the caller sells 5% of their buy and the tight pre_call style (caller_sold_gte 0.01) sells,
// the loose one (0.25) does not; the price runs to 1.5x and falls back to 1.0x and the trailing stop (0.3 from the peak)
// closes the loose one at about 1.05x.
import type { BodyOf, Trade } from "../../../../packages/contracts/src/index.ts";
import { putSignal } from "../../../../services/core/src/board/board.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { desk } from "../../../../services/core/src/mind/desk.ts";
import { whenHolds } from "../../../../services/core/src/mind/dsl.ts";
import { step, type Tx } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const CALLER = "CaLLer1111111111111111111111111111111111111";
const P0 = 1e-7;
const trade = (n: number, price: number, o: Partial<Trade> = {}): Trade => ({
  mint: MINT, tx: `t${n}`, slot_index_id: null, ts: "2026-10-19T12:00:00.000Z", side: "buy", wallet: `W${n}`, sol: 0.5, usd: null, tokens: 0.5 / price, price_sol: price, price_usd: null, mcap_usd: null, on_curve: true, program: null, ...o,
});

export const suite: Suite = {
  name: "exit-rules",
  tier: "fast",
  covers: ["services/core/src/mind/desk.ts", "services/core/src/mind/dsl.ts", "services/core/src/mind/seeds.ts"],
  proves: "C6: a caller-sold exit fires when the pre-call caller sells past its share and not before; a trailing stop fires on the fall from the peak and positions keep their peak.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const ctx = (o: Partial<Parameters<typeof whenHolds>[1]>) => ({ mult: 1, heldMin: 1, calledS: null, peakMult: 1, callerSold: null, board: {}, ...o });
    add("trail_from_peak holds at 1.15x after a 1.5x peak and not at 1.25x", whenHolds({ trail_from_peak: 0.2 }, ctx({ mult: 1.15, peakMult: 1.5 })) && !whenHolds({ trail_from_peak: 0.2 }, ctx({ mult: 1.25, peakMult: 1.5 })), "0.2 from the peak = 1.2x");
    add("caller_sold_gte needs a pre-call caller", !whenHolds({ caller_sold_gte: 0.01 }, ctx({ callerSold: null })) && whenHolds({ caller_sold_gte: 0.01 }, ctx({ callerSold: 0.05 })), "null never fires");

    const db = await freshDb("exitrules");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    let n = 0;
    const at = (s: number) => clock.advance!(t0 + s * 1000);
    const tick = async (s: number, price: number, o: Partial<Trade> = {}) => {
      at(s);
      const ev = tape.emit("trade.curve", trade(++n, price, o), { source: "nats", subject: MINT });
      await tape.flush();
      return ev;
    };
    try {
      const sig = (kind: string, value: unknown) => putSignal(db.sql as unknown as Tx, clock, { kind, subject: MINT, value, confidence: 0.9, validMs: 3_600_000, inputs: [], analyzer: "test" });
      await sig("precall.callout_p", { p: 1, p_peak: 1 });
      await sig("curve.progress", { progress: 0.2, mcap_usd: 9000 });
      await sig("flow.state", { buyers_60s: 20, heat: 1, top_share: 0 });
      await sig("risk.state", { bundle_share: 0, top10_share: 0.1, creator_sold: 0, score: 0 });
      const buy = await tick(0, P0, { wallet: CALLER, tokens: 1e6 });
      tape.emit("precall.detected", { mint: MINT, caller: CALLER, trade_id: buy.id, buy_sol: 0.1, p: 1, horizon_min: 10 }, { source: "analyzer", subject: MINT });
      await tape.flush();
      for (let s = 2; s <= 20; s += 2) await tick(s, P0); // pre_call strategies enter and fill
      await tick(22, P0, { wallet: CALLER, side: "sell", tokens: 5e4 }); // the caller sells 5% of their buy
      for (let s = 24; s <= 40; s += 2) await tick(s, P0);
      for (let s = 42; s <= 60; s += 2) await tick(s, P0 * (1 + 0.5 * (s - 40) / 20)); // to 1.5x: the loose style sells half at its 1.3x take-profit
      for (let s = 62; s <= 80; s += 2) await tick(s, P0 * (1.5 - 0.5 * (s - 60) / 20)); // back to 1.0x
      const d = desk(tape, clock);
      while (await step(db.sql, d)) { /* drain */ }
      await tape.flush();
      const sells = (await db.sql`select body from tape.events where topic = 'intent.created' and body->>'side' = 'sell' order by seen_time, id`).map((r) => r.body as BodyOf<"intent.created">);
      const by = (style: string, rule: string) => sells.filter((b) => b.strategy_id.includes("pre_call") && b.strategy_id.endsWith(style) && b.reason[0]!.includes(rule));
      const tightSold = by("_tight", "caller_sold_gte");
      const looseSold = by("_loose", "caller_sold_gte");
      add("the caller sold 5%: tight pre_call (0.01) sells on it", tightSold.length > 0, `${tightSold.length} tight caller_sold exits`);
      add("the loose style (0.25) does not", looseSold.length === 0, `${looseSold.length} loose caller_sold exits`);
      const trail = by("_loose", "stop:trail_from_peak");
      add("the trailing stop fires on the fall from the peak", trail.length > 0, `${trail.length} loose trailing stops; ${sells.map((b) => b.reason[0]).join(", ")}`);
      const [pk] = await db.sql`select max(peak_mult)::float m from mind.positions`;
      add("positions keep their peak multiple", (pk?.m as number) > 1.4, `peak ${(pk?.m as number)?.toFixed(3)}`);
    } finally {
      await tape.close();
      await db.done();
    }
    return { checks, metrics: {} };
  },
};
