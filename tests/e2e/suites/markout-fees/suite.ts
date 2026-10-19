// C5 (docs/STRATEGY.md section 5): retirement reads fee-adjusted 60 s markouts. A desk run on one scouted coin whose price
// climbs about 3% a minute: the raw 60 s markout of a probe buy is positive, but the exit fee and both priority fees eat
// it. evolve() then retires a strategy with 50 such markouts, and keeps one judged on the raw numbers.
import type { BodyOf, Trade } from "../../../../packages/contracts/src/index.ts";
import { putSignal } from "../../../../services/core/src/board/board.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { desk } from "../../../../services/core/src/mind/desk.ts";
import { E, evolve } from "../../../../services/core/src/mind/evolve.ts";
import { seedSpecs } from "../../../../services/core/src/mind/seeds.ts";
import { step, type Tx } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const features: BodyOf<"coin.watched">["features"] = {
  from_birth: true, age_s: 30, first_slot: 100, creator: null, trades: 40, buyers: 20, holders_est: 20, mcap_usd: 9000, bundle_buys: 0, bundle_wallets: 0,
  bundle_share: 0, dev_buy_sol: 1, block0_sniper_share: 0, sniper_share: 0, top_buyer_share: 0.1, creator_sold: 0, smart_buyers: 1,
};
const trade = (n: number, price: number): Trade => ({
  mint: MINT, tx: `t${n}`, slot_index_id: null, ts: "2026-10-19T12:00:00.000Z", side: "buy", wallet: `W${n}`, sol: 0.5, usd: null, tokens: 0.5 / price, price_sol: price, price_usd: null, mcap_usd: null, on_curve: true, program: null,
});

export const suite: Suite = {
  name: "markout-fees",
  tier: "fast",
  covers: ["services/core/src/mind/desk.ts", "services/core/src/mind/fill.ts", "services/core/src/mind/evolve.ts"],
  proves: "C5: a buy whose raw 60 s markout is positive but loses after the exit and priority fees records a negative fee-adjusted markout, and a strategy with 50 of them retires.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const db = await freshDb("markoutfees");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    let raw: number[] = [];
    let adj: number[] = [];
    try {
      tape.emit("coin.watched", { mint: MINT, reason: "metrics", wallet: null, note: null, buyers_60s: 20, net_sol_60s: 5, trigger_tx: null, features }, { source: "nats", subject: MINT });
      const sig = (kind: string, value: unknown) => putSignal(db.sql as unknown as Tx, clock, { kind, subject: MINT, value, confidence: 0.9, validMs: 3_600_000, inputs: [], analyzer: "test" });
      await sig("curve.progress", { progress: 0.2, mcap_usd: 9000 });
      await sig("flow.state", { buyers_60s: 20, heat: 1, top_share: 0 });
      await sig("risk.state", { bundle_share: 0, top10_share: 0.1, creator_sold: 0, score: 0 });
      await sig("wallets.smart_buying", { n: 2, score: 1 });
      await tape.flush();
      for (let n = 1; n <= 180; n++) { // 6 minutes (markouts finish at 5 min), +0.1% every 2 s
        clock.advance!(t0 + n * 2000);
        tape.emit("trade.curve", trade(n, 1e-7 * 1.001 ** n), { source: "nats", subject: MINT });
        await tape.flush();
      }
      const d = desk(tape, clock);
      while (await step(db.sql, d)) { /* drain */ }
      await tape.flush();
      const mk = (await db.sql`select body from tape.events where topic = 'markout.measured' and body->>'side' = 'buy' and body->>'h60s' is not null`).map((r) => r.body as BodyOf<"markout.measured">);
      raw = mk.map((b) => b.h60s!);
      adj = mk.map((b) => b.h60s! - b.cost_bps);
      const stored = (await db.sql`select unnest(mk60) v from mind.stats`).map((r) => r.v as number);
      add("buys get a positive raw 60 s markout", raw.length > 0 && raw.every((x) => x > 0), `${raw.length} buys, raw ${Math.min(...raw).toFixed(0)}..${Math.max(...raw).toFixed(0)} bps`);
      add("the fee-adjusted markout is negative", adj.length > 0 && adj.every((x) => x < 0), `adjusted ${Math.min(...adj).toFixed(0)}..${Math.max(...adj).toFixed(0)} bps`);
      add("the desk stores the fee-adjusted value for retirement", stored.length > 0 && stored.every((x) => x < 0), `${stored.length} stored, max ${Math.max(...stored).toFixed(0)} bps`);
    } finally {
      await tape.close();
      await db.done();
    }

    // evolve: one strategy with 50 fee-adjusted markouts (losing), its twin judged on the raw ones (winning)
    const [a, b] = seedSpecs().filter((s) => s.family === "launch_scan");
    const many = (xs: number[]) => Array.from({ length: E.retireMinTrades }, (_, i) => xs[i % xs.length]!);
    const quiet = { n: 0, sum: 0, sq: 0, rets: [], max_dd: 0 };
    const r = evolve([{ spec: a!, stats: quiet, idle_min: 0, mk60: many(adj) }, { spec: b!, stats: quiet, idle_min: 0, mk60: many(raw) }], 0.2, () => 0.5, () => "sr_x");
    const why = r.retire.find((x) => x.id === a!.id)?.reason;
    add("a fee-losing strategy retires", why === "markout_60s_negative", `retired: ${why ?? "no"}`);
    add("its raw-markout twin would not have", !r.retire.some((x) => x.id === b!.id), r.retire.map((x) => x.id).join(", ") || "none");
    return { checks, metrics: { buys: raw.length } };
  },
};
