// C10 (docs/STRATEGY.md section 3): caller records checked by hand. Three known callers on a fresh database with a test
// clock: A buys three coins, calls two of them within the horizon (one of them their own launch) and sells into one
// call; B buys one coin and never calls; C calls one coin after the horizon. Every field is worked out below from the
// prices written, then compared with callerRecord and callerFields.
import type { Trade } from "../../../../packages/contracts/src/index.ts";
import { callerFields, callerRecord } from "../../../../services/core/src/analyzers/precall.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MIN = 60_000;
const H = env.num("PRECALL_HORIZON_MIN"); // 5
const COST = env.num("INDEX_ROUND_TRIP_COST"); // 0.03
const N = env.num("PRECALL_PRIOR_N"); // 4
const close = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 1e-9;

export const suite: Suite = {
  name: "caller-records",
  tier: "fast",
  covers: ["services/core/src/analyzers/precall.ts"],
  proves: "C10: buy_to_call_rate, lag_med_s, post_call_net, miss_net, dump_rate, creator_share and n_calls for three callers match hand-worked numbers, each shrunk to the population.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const db = await freshDb("callerrecords");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0 - 86_400_000);
    const tape = new Tape(db.sql, clock);
    let n = 0;
    const at = (ms: number) => clock.advance!(ms);
    const trade = async (ms: number, mint: string, wallet: string, side: "buy" | "sell", price: number) => {
      at(ms);
      const t: Trade = { mint, tx: `t${++n}`, slot_index_id: null, ts: new Date(ms).toISOString(), side, wallet, sol: 0.1, usd: null, tokens: 0.1 / price, price_sol: price, price_usd: null, mcap_usd: null, on_curve: true, program: "pump", pool_sol: null };
      tape.emit("trade.curve", t, { source: "nats", subject: mint });
      await tape.flush();
    };
    const call = (id: string, mint: string, wallet: string, ms: number) => {
      const iso = new Date(ms).toISOString();
      return db.sql`insert into mem.callouts (callout_id, mint, wallet, text, created_at, seen_at, first_on_coin) values (${id}, ${mint}, ${wallet}, 'call', ${iso}, ${iso}, true)`;
    };
    try {
      // every caller is known: one callout a day before
      for (const w of ["A", "B", "C"]) await call(`${w}0`, `${w}0`, w, t0 - 86_400_000);
      // A launched A1 (the Scout's watch names the creator)
      at(t0 - MIN);
      tape.emit("coin.watched", { mint: "A1", reason: "metrics", wallet: null, note: null, buyers_60s: 1, net_sol_60s: 0, trigger_tx: null, creator_record: null,
        features: { from_birth: true, age_s: 1, first_slot: 1, creator: "A", trades: 1, buyers: 1, holders_est: 1, mcap_usd: null, bundle_buys: 0, bundle_wallets: 0, bundle_share: 0, dev_buy_sol: 0, block0_sniper_share: 0, sniper_share: 0, top_buyer_share: 1, creator_sold: 0, smart_buyers: 0 } }, { source: "nats", subject: "A1" });
      await tape.flush();
      const s = 1000;
      // A1: A buys at 1.0, we enter at the next trade (1.0), A calls 2 min later, the first trade at the call is 1.5
      await trade(t0, "A1", "A", "buy", 1.0); await trade(t0 + 5 * s, "A1", "X", "buy", 1.0); await call("A1c", "A1", "A", t0 + 2 * MIN); await trade(t0 + 2 * MIN, "A1", "X", "buy", 1.5);
      // A2: entry 1.0, call after 1 min, exit 1.5, and A sells 1 min after calling (a dump)
      const a2 = t0 + 10 * MIN;
      await trade(a2, "A2", "A", "buy", 1.0); await trade(a2 + 5 * s, "A2", "X", "buy", 1.0); await call("A2c", "A2", "A", a2 + MIN); await trade(a2 + MIN, "A2", "X", "buy", 1.5); await trade(a2 + 2 * MIN, "A2", "A", "sell", 1.4);
      // A3: no call; the last trade in the horizon is 0.8
      const a3 = t0 + 20 * MIN;
      await trade(a3, "A3", "A", "buy", 1.0); await trade(a3 + 5 * s, "A3", "X", "buy", 1.0); await trade(a3 + 4 * MIN, "A3", "X", "sell", 0.8); await trade(a3 + 9 * MIN, "A3", "X", "sell", 0.5);
      // B1: flat at 1.0, no call
      const b1 = t0 + 30 * MIN;
      await trade(b1, "B1", "B", "buy", 1.0); await trade(b1 + 5 * s, "B1", "X", "buy", 1.0); await trade(b1 + 4 * MIN, "B1", "X", "buy", 1.0);
      // C1: C calls after 10 min, outside the 5 min horizon: a miss, exit at the last trade in the horizon (1.1)
      const c1 = t0 + 40 * MIN;
      await trade(c1, "C1", "C", "buy", 1.0); await trade(c1 + 5 * s, "C1", "X", "buy", 1.0); await trade(c1 + 3 * MIN, "C1", "X", "buy", 1.1); await call("C1c", "C1", "C", c1 + 10 * MIN); await trade(c1 + 10 * MIN, "C1", "X", "buy", 2);
      const now = t0 + 2 * 3_600_000;
      at(now);

      const net = (x: number) => x * (1 - COST);
      // population by hand: 5 buys, 2 called; called nets 1.5 and 1.5; missed nets 0.8 (A3), 1.0 (B1), 1.1 (C1)
      const pop = { rate: (2 + 1) / (5 + 2), called_net: net(1.5), missed_net: (net(0.8) + net(1.0) + net(1.1)) / 3 };
      const popRec = await db.sql.begin((tx) => callerRecord(tx as never, null, now));
      add("the population record matches", popRec.buys === 5 && popRec.called === 2 && close(popRec.missed_nets.reduce((a, b) => a + b, 0) / 3, pop.missed_net), JSON.stringify({ buys: popRec.buys, called: popRec.called }));
      const want = {
        A: { rate: (pop.rate * N + 2) / (N + 3), post: (N * pop.called_net + 2 * net(1.5)) / (N + 2), miss: (N * pop.missed_net + net(0.8)) / (N + 1), dump: 1 / 2, creator: 1 / 3, calls: 3, lag: 90 },
        B: { rate: (pop.rate * N + 0) / (N + 1), post: pop.called_net, miss: (N * pop.missed_net + net(1.0)) / (N + 1), dump: null, creator: 0, calls: 1, lag: null },
        C: { rate: (pop.rate * N + 0) / (N + 1), post: pop.called_net, miss: (N * pop.missed_net + net(1.1)) / (N + 1), dump: null, creator: 0, calls: 2, lag: null },
      } as const;
      for (const [w, x] of Object.entries(want)) {
        const r = await db.sql.begin((tx) => callerRecord(tx as never, w, now));
        const f = callerFields(r, pop);
        const edge = x.rate * (x.post - 1) - (1 - x.rate) * (1 - x.miss);
        const ok = close(f.buy_to_call_rate, x.rate) && close(f.post_call_net, x.post) && close(f.miss_net, x.miss) && close(f.edge, edge)
          && f.dump_rate === x.dump && close(f.creator_share, x.creator) && f.n_calls === x.calls && f.lag_med_s === x.lag;
        add(`caller ${w} matches the hand-worked record`, ok, JSON.stringify({ ...f, want: x }));
      }
    } finally {
      await tape.close();
      await db.done();
    }
    return { checks, metrics: { horizon_min: H } };
  },
};
