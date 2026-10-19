// Plan A5 and A6. `risk.state` is recomputed on every holder snapshot (bundle and sniper shares ride on the snapshot), and a restart
// restores the coin's creator. The Index numbers are hand computed: early_right uses the peak after the wallet's first buy, the copy price
// survives a rollup flush, and copy value is marked at a fixed horizon (INDEX_MIN_AGE_MIN after the first buy), not at the last trade.
import type { BodyOf, Trade } from "../../../../packages/contracts/src/index.ts";
import { indexSignals } from "../../../../services/core/src/analyzers/index-signals.ts";
import { refresh } from "../../../../services/core/src/index/refresh.ts";
import { Rollup } from "../../../../services/core/src/index/rollup.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import { step } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const features = (o: Partial<BodyOf<"coin.watched">["features"]> = {}): BodyOf<"coin.watched">["features"] => ({
  from_birth: true, age_s: 30, first_slot: 100, creator: null, trades: 10, buyers: 6, holders_est: 6, mcap_usd: 9000, bundle_buys: 1, bundle_wallets: 1,
  bundle_share: 0.05, sniper_share: 0, top_buyer_share: 0.2, creator_sold: 0, smart_buyers: 0, ...o,
});
const snapshot = (f: ReturnType<typeof features>) => ({ mint: MINT, supply: 1e9, top: [{ account: "A1", amount: 1e8 }], excluded: [], top10_share: 0.2, features: f });

const MIN = 60_000;
const tr = (wallet: string, mint: string, side: "buy" | "sell", tokens: number, price: number): Trade => ({
  mint, tx: `${wallet}${mint}${tokens}${price}`, slot_index_id: null, ts: "2026-10-18T12:00:00.000Z", side, wallet, sol: tokens * price, usd: null, tokens, price_sol: price, price_usd: null, mcap_usd: null, on_curve: true, program: null,
});

export const suite: Suite = {
  name: "index-rows",
  tier: "fast",
  covers: ["services/core/src/index/", "services/core/src/analyzers/index-signals.ts"],
  proves: "A5: two holder snapshots for one coin give two different risk.state values, and a restart restores the creator and adds idx.coin deltas. A6: a hand-computed wallet table matches the Index: early_right counts the peak after the first buy, the copy price survives a flush, copy value is marked at a fixed horizon.",
  async run() {
    const db = await freshDb("indexrows");
    const t0 = Date.UTC(2026, 9, 18, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    try {
      // ---- A5: risk.state moves with every snapshot
      const at = (min: number) => clock.advance!(t0 + min * MIN);
      at(0);
      tape.emit("coin.watched", { mint: MINT, reason: "heat", wallet: null, buyers_60s: 5, net_sol_60s: 3, trigger_tx: null, features: features() }, { source: "nats", subject: MINT });
      at(1);
      tape.emit("holders.snapshot", snapshot(features({ bundle_share: 0.1, sniper_share: 0.05 })), { source: "rpc", subject: MINT });
      at(2);
      tape.emit("holders.snapshot", snapshot(features({ bundle_share: 0.3, sniper_share: 0.15 })), { source: "rpc", subject: MINT });
      await tape.flush();
      const consumer = indexSignals(clock);
      while (await step(db.sql, consumer)) { /* drain */ }
      const sigs = await db.sql`select value, produced_at from board.signals where kind = 'risk.state' and subject = ${MINT} order by produced_at, id`;
      const v = sigs.map((s) => s.value as Record<string, number>);
      add("one risk.state per event: the watch and two snapshots", sigs.length === 3, `${sigs.length} signals`);
      add("the second snapshot gives a different risk.state from the first", v.length === 3 && v[1]!.bundle_share !== v[2]!.bundle_share && v[1]!.score !== v[2]!.score, JSON.stringify([v[1], v[2]]));
      add("bundle and sniper shares come from the snapshot", v[2]?.bundle_share === 0.3 && v[2]?.sniper_share === 0.15, JSON.stringify(v[2]));

      // ---- A5: a restart restores the creator and adds deltas
      const base = t0 + 10 * MIN;
      const r1 = new Rollup();
      r1.launch("MC", "CREATOR", "CURVE", null, base);
      r1.trade(tr("CREATOR", "MC", "buy", 1000, 1), base);
      r1.trade(tr("X1", "MC", "buy", 500, 1), base + 1000);
      r1.trade(tr("CREATOR", "MC", "sell", 400, 1.1), base + 2000);
      await r1.flush(db.sql, base + 3000);
      const r2 = new Rollup();
      await r2.load(db.sql);
      const f2 = r2.features("MC", base + 60_000);
      add("after a restart the coin's creator is restored", f2?.creator === "CREATOR", `creator ${f2?.creator}`);
      add("after a restart the creator's sold share is restored (400 of 1000 bought)", Math.abs((f2?.creator_sold ?? -1) - 0.4) < 1e-9, `creator_sold ${f2?.creator_sold}`);
      r2.trade(tr("X2", "MC", "buy", 100, 1.2), base + 70_000);
      await r2.flush(db.sql, base + 71_000);
      const [c] = await db.sql`select trades, creator from idx.coin where mint = 'MC'`;
      add("idx.coin counters add deltas across a restart (3 + 1 trades)", c?.trades === 4 && c.creator === "CREATOR", JSON.stringify(c));

      // ---- A6: a hand-computed wallet table
      const cost = env.num("INDEX_ROUND_TRIP_COST");
      const lat = env.num("FILL_LATENCY_MEDIAN_MS");
      const horizon = env.num("INDEX_MIN_AGE_MIN") * MIN;
      const T = t0 + 24 * 3_600_000; // buys at T + 10 s, on both coins at the same instant so both weigh the same
      const r = new Rollup();
      const go = (ms: number, w: string, m: string, side: "buy" | "sell", tokens: number, price: number) => r.trade(tr(w, m, side, tokens, price), T + ms);
      for (const m of ["CA", "CB"]) go(0, "Z", m, "buy", 10, 10); // an early peak of 10 before W1 comes in
      go(10_000, "W1", "CA", "buy", 100, 2);
      go(10_000, "W1", "CB", "buy", 50, 1);
      await r.flush(db.sql, T + 11_000); // W1's rows are written before their copy price is known
      go(10_000 + lat, "Y", "CA", "buy", 10, 2.5); // the first trade after W1's buy plus latency: the copy price on A
      go(10_000 + lat, "Y", "CB", "buy", 10, 1.2); // and on B
      go(60_000, "Y", "CA", "buy", 10, 5); // A's peak after W1's buy is 5 = 2 x 2.5: early right
      go(60_000, "Y", "CB", "buy", 10, 1.5); // B's peak after W1's buy is 1.5 < 2 x 1.2: not early right, whatever the 10 before
      await r.flush(db.sql, T + 61_000);
      go(15 * MIN, "W1", "CA", "sell", 40, 3); // 120 SOL back
      go(20 * MIN, "Y", "CA", "buy", 10, 4);
      go(35 * MIN, "Y", "CA", "buy", 10, 3); // past W1's horizon: A is marked at the price in force at 10 s + 30 min, which is 4
      go(35 * MIN, "Y", "CB", "buy", 10, 2); // B is marked at 1.5
      await r.flush(db.sql, T + 35 * MIN + 1000);
      go(120 * MIN, "Y", "CA", "buy", 10, 0.5); // the last prices: not used for marking
      go(120 * MIN, "Y", "CB", "buy", 10, 2.2); // still under 2 x 1.2, so B stays not early right
      await r.flush(db.sql, T + 120 * MIN + 1000);
      clock.advance!(T + 3 * 3_600_000);
      const out = await refresh(db.sql, tape);
      const [w1] = await db.sql`select n, copy_net, early_right from idx.wallet where wallet = 'W1'`;
      const mA = ((120 + 60 * 4) / 100 / 2.5) * (1 - cost); // sold 40 for 120, 60 left marked at 4, bought at 2.5
      const mB = (50 * 1.5) / 50 / 1.2 * (1 - cost); // 50 left marked at 1.5, bought at 1.2
      const want = Math.sqrt(mA * mB);
      add("the table scores W1 on both coins", out.wallets >= 1 && w1?.n === 2, JSON.stringify(w1));
      add(`copy_net is the geometric mean of ${mA.toFixed(4)} and ${mB.toFixed(4)} (copy price kept across the flush, marks at the horizon)`, Math.abs(Number(w1?.copy_net) - want) < 1e-9, `${w1?.copy_net} vs ${want}`);
      add("early_right is 0.5: A's peak after the first buy reaches 2x, B's does not", Math.abs(Number(w1?.early_right) - 0.5) < 1e-9, `${w1?.early_right}`);
      add("the horizon is INDEX_MIN_AGE_MIN", horizon === 30 * MIN, `${horizon} ms`);
      return { checks, metrics: { copy_net: Number(w1?.copy_net), expected: want } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
