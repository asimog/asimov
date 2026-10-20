// C2 (docs/STRATEGY.md section 3): a coin the Scout promotes is in play with no callout, and every decision records why it
// was in play. Synthetic rows on a fresh database: two coin.watched (metrics, follow), Board signals that open the
// launch_scan and smart_early universes, then trades. No tape, no callouts.
import type { BodyOf, Trade } from "../../../../packages/contracts/src/index.ts";
import { putSignal } from "../../../../services/core/src/board/board.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { desk } from "../../../../services/core/src/mind/desk.ts";
import { seedSpecs } from "../../../../services/core/src/mind/seeds.ts";
import { step, type Tx } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const SCOUTED = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const FOLLOWED = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const features: BodyOf<"coin.watched">["features"] = {
  from_birth: true, age_s: 30, first_slot: 100, creator: null, trades: 40, buyers: 20, holders_est: 20, mcap_usd: 9000, bundle_buys: 0, bundle_wallets: 0,
  bundle_share: 0, dev_buy_sol: 1, block0_sniper_share: 0, sniper_share: 0, top_buyer_share: 0.1, creator_sold: 0, smart_buyers: 1,
};
const trade = (mint: string, n: number, price: number): Trade => ({
  mint, tx: `t${mint.slice(0, 4)}${n}`, slot_index_id: null, ts: "2026-10-19T12:00:00.000Z", side: "buy", wallet: `W${n}`, sol: 0.5, usd: null, tokens: 0.5 / price, price_sol: price, price_usd: null, mcap_usd: null, on_curve: true, program: null, pool_sol: null,
});

export const suite: Suite = {
  name: "desk-in-play",
  tier: "fast",
  covers: ["services/core/src/mind/desk.ts"],
  proves: "C2: coin.watched puts a coin in play with no callout; launch_scan decides on a metrics coin tagged scout, a followed wallet's coin is tagged smart_buy, and every intent records its in-play reason.",
  async run() {
    const db = await freshDb("deskinplay");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    try {
      for (const [mint, reason] of [[SCOUTED, "metrics"], [FOLLOWED, "follow"]] as const) {
        tape.emit("coin.watched", { mint, reason, wallet: reason === "follow" ? "Fw1" : null, note: null, buyers_60s: 20, net_sol_60s: 5, trigger_tx: null, features, creator_record: null }, { source: "nats", subject: mint });
        const sig = (kind: string, value: unknown) => putSignal(db.sql as unknown as Tx, clock, { kind, subject: mint, value, confidence: 0.9, validMs: 3_600_000, inputs: [], analyzer: "test" });
        await sig("curve.progress", { progress: 0.2, mcap_usd: 9000 });
        await sig("flow.state", { buyers_60s: 20, heat: 1, top_share: 0 });
        await sig("risk.state", { bundle_share: 0, top10_share: 0.1, creator_sold: 0, score: 0 });
        await sig("wallets.smart_buying", { n: 2, score: 1 });
      }
      await tape.flush();
      for (let n = 1; n <= 30; n++) {
        clock.advance!(t0 + n * 2000);
        for (const mint of [SCOUTED, FOLLOWED]) tape.emit("trade.curve", trade(mint, n, 3e-8 * (1 + n / 100)), { source: "nats", subject: mint });
        await tape.flush();
      }
      // an agent's proposals: code decides. A valid spec joins the pool as a ghost; an invalid one does not
      const good = { ...seedSpecs()[0]!, id: "ignored" } as unknown as Record<string, unknown>;
      tape.emit("proposal.strategy", { proposal_id: "sr_proposed_ok", by: "agents", spec: good, why: ["test"], because: [] }, { source: "agents", subject: "sr_proposed_ok" });
      tape.emit("proposal.strategy", { proposal_id: "sr_proposed_bad", by: "agents", spec: { family: "nonsense" }, why: ["test"], because: [] }, { source: "agents", subject: "sr_proposed_bad" });
      await tape.flush();
      const d = desk(tape, clock);
      while (await step(db.sql, d)) { /* drain */ }
      await tape.flush();
      const born = (await db.sql`select subject, body->>'origin' origin from tape.events where topic = 'strategy.born' and body->>'origin' = 'proposal'`).map((r) => r.subject as string);
      add("a valid proposal joins the pool; an invalid one does not", born.join() === "sr_proposed_ok", born.join() || "none");

      const intents = await db.sql`select subject, body from tape.events where topic = 'intent.created' order by seen_time, id`;
      const buys = intents.map((r) => r.body as BodyOf<"intent.created">).filter((b) => b.side === "buy");
      const strategyOf = async (b: BodyOf<"intent.created">) => b.strategy_id;
      const scoutBuys = buys.filter((b) => b.mint === SCOUTED);
      const followBuys = buys.filter((b) => b.mint === FOLLOWED);
      const launchScan = await Promise.all(scoutBuys.map(strategyOf)).then((ids) => ids.filter((id) => id.includes("launch_scan")).length);
      add("launch_scan decides on a coin with no callout", launchScan > 0, `${launchScan} launch_scan buys of ${scoutBuys.length} on the metrics coin`);
      add("a metrics watch is tagged scout", scoutBuys.length > 0 && scoutBuys.every((b) => b.in_play === "scout"), JSON.stringify([...new Set(scoutBuys.map((b) => b.in_play))]));
      add("a followed wallet's coin is tagged smart_buy", followBuys.length > 0 && followBuys.every((b) => b.in_play === "smart_buy"), JSON.stringify([...new Set(followBuys.map((b) => b.in_play))]));
      add("every intent records an in-play reason", intents.length > 0 && intents.every((r) => (r.body as BodyOf<"intent.created">).in_play !== null), `${intents.length} intents`);
      return { checks, metrics: { intents: intents.length, scout: scoutBuys.length, smart_buy: followBuys.length } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
