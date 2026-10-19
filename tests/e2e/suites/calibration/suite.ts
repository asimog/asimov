// C3 (docs/STRATEGY.md section 4): calibration maps and the sizing that reads them. Pure checks of the map (equal-count
// bins of CALIB_MIN_PER_BIN, non-decreasing win share and mean) and of Kelly on the map, capped at KELLY_CAP. Then a desk
// run on a fresh database: a `full` launch_scan strategy whose family has one bin still buys at the probe size, and the
// allocation round emits the family's map with its counts.
import type { BodyOf, Trade } from "../../../../packages/contracts/src/index.ts";
import { putSignal } from "../../../../services/core/src/board/board.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { CALIB, calibrate } from "../../../../services/core/src/mind/calibrate.ts";
import { desk } from "../../../../services/core/src/mind/desk.ts";
import { evaluateEntry, geometry } from "../../../../services/core/src/mind/dsl.ts";
import { defaultLimits } from "../../../../services/core/src/mind/risk.ts";
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
const trade = (n: number): Trade => ({
  mint: MINT, tx: `t${n}`, slot_index_id: null, ts: "2026-10-19T12:00:00.000Z", side: "buy", wallet: `W${n}`, sol: 0.5, usd: null, tokens: 5e6, price_sol: 1e-7, price_usd: null, mcap_usd: null, on_curve: true, program: null, pool_sol: null,
});

export const suite: Suite = {
  name: "calibration",
  tier: "fast",
  covers: ["services/core/src/mind/calibrate.ts", "services/core/src/mind/dsl.ts", "services/core/src/mind/desk.ts"],
  proves: "C3: each family's map has bins of at least CALIB_MIN_PER_BIN with non-decreasing win share and mean; Kelly reads the map's win share capped at KELLY_CAP; with fewer than 3 bins even a full strategy buys at the probe size; the map is on the Tape with its counts.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

    // ---- the map: wins get likelier with score, with noise that breaks monotonicity before the fit
    const rand = replayClock(0, 3).rand;
    const rows = Array.from({ length: 200 }, () => {
      const score = rand();
      return { score, r: rand() < 0.2 + 0.5 * score ? 0.3 : -0.2 };
    });
    const bins = calibrate(rows);
    const up = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]! - 1e-12);
    add("the map has equal-count bins of at least CALIB_MIN_PER_BIN", bins.length === Math.floor(200 / CALIB.minPerBin) && bins.every((b) => b.n >= CALIB.minPerBin), bins.map((b) => `${b.lo.toFixed(2)}-${b.hi.toFixed(2)} n=${b.n} win=${b.win.toFixed(2)} mean=${b.mean.toFixed(3)}`).join("; "));
    add("win share and mean never fall as the score rises", up(bins.map((b) => b.win)) && up(bins.map((b) => b.mean)), "monotone");
    add("fewer decisions than one bin gives no map", calibrate(rows.slice(0, CALIB.minPerBin - 1)).length === 0, "empty");

    // ---- Kelly on the map, capped
    const spec = seedSpecs().find((s) => s.family === "launch_scan")!;
    const board = { "curve.progress": { mcap_usd: 9000, progress: 0.2 }, "flow.state": { buyers_60s: 20, heat: 1, top_share: 0 }, "risk.state": { score: 0 }, "wallets.smart_buying": { score: 1 } };
    const quote = () => ({ slippage_bps: 10, impact_bps: 20 });
    const sure = [{ lo: 0, hi: 1, n: 20, win: 0.99, mean: 0.5 }, { lo: 0.1, hi: 1, n: 20, win: 0.99, mean: 0.5 }, { lo: 0.2, hi: 1, n: 20, win: 0.99, mean: 0.5 }];
    const d = evaluateEntry(spec, board, quote, { budget_sol: 1 }, sure);
    const g = geometry(spec);
    const k = Math.min(CALIB.kellyCap, spec.size.kelly_fraction * ((0.99 * g.b - 0.01) / g.b));
    add("full sizing is fractional Kelly on the bin's win share, capped at KELLY_CAP", d.enter && Math.abs(d.size_sol - Math.min(spec.size.max_sol, k)) < 1e-9, d.enter ? `${d.size_sol.toFixed(4)} SOL of a 1 SOL budget, cap ${CALIB.kellyCap}` : d.reason);
    const losing = sure.map((b) => ({ ...b, win: 0.3, mean: -0.05 }));
    const dl = evaluateEntry(spec, board, quote, { fixed_sol: 0.005 }, losing);
    add("a bin whose mean net is under the costs refuses the entry", !dl.enter && dl.reason === "below_cost_floor", dl.enter ? "entered" : dl.reason);

    // ---- the desk: a full strategy before calibration buys at the probe size; the round emits the map
    const db = await freshDb("calibration");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    try {
      await db.sql`insert into mind.strategies (id, spec, family, horizon, origin, born_at) values (${spec.id}, ${db.sql.json(spec as never)}, ${spec.family}, ${spec.horizon}, 'seed', ${new Date(t0).toISOString()})`;
      await db.sql`insert into mind.stats (strategy_id, stage, share) values (${spec.id}, 'full', 0.25)`;
      for (let i = 0; i < 30; i++) {
        const at = new Date(t0 - (60 - i) * 60_000).toISOString();
        const r = i % 2 ? 0.2 : -0.1;
        await db.sql`insert into mind.positions (id, strategy_id, mint, opened_at, tokens, tokens_left, cost_sol, rent_sol, entry_price, exit_bands, closed_at, net_sol, score)
          values (${`pos_${i}`}, ${spec.id}, ${`Old${i}`}, ${at}, 1, 0, 0.012, 0.002, 1e-7, ${db.sql.json([] as never)}, ${at}, ${r * 0.01}, ${0.5 + i / 100})`;
      }
      tape.emit("coin.watched", { mint: MINT, reason: "metrics", wallet: null, note: null, buyers_60s: 20, net_sol_60s: 5, trigger_tx: null, features, creator_record: null }, { source: "nats", subject: MINT });
      for (const [kind, value] of Object.entries(board)) await putSignal(db.sql as unknown as Tx, clock, { kind, subject: MINT, value: { ...value, n: 2 }, confidence: 0.9, validMs: 3_600_000, inputs: [], analyzer: "test" });
      await tape.flush();
      for (let n = 1; n <= 30; n++) {
        clock.advance!(t0 + n * 5000);
        tape.emit("trade.curve", trade(n), { source: "nats", subject: MINT });
        await tape.flush();
      }
      const dk = desk(tape, clock);
      while (await step(db.sql, dk)) { /* drain */ }
      await tape.flush();
      const buys = (await db.sql`select body from tape.events where topic = 'intent.created' and body->>'side' = 'buy' and seen_time < ${new Date(t0 + 120_000).toISOString()}`).map((r) => r.body as BodyOf<"intent.created">);
      const probe = defaultLimits().probe_order_sol;
      add("no Kelly before calibration: a full strategy buys at the probe size", buys.length > 0 && buys.every((b) => b.size_sol === probe), `${buys.length} buys at ${[...new Set(buys.map((b) => b.size_sol))].join(", ")} SOL (probe ${probe})`);
      const maps = (await db.sql`select body from tape.events where topic = 'calibration.map'`).map((r) => r.body as BodyOf<"calibration.map">);
      const m = maps.find((x) => x.family === "launch_scan");
      add("the family's map is on the Tape with its counts", !!m && m.decisions === 30 && m.bins.length === 1 && m.bins[0]!.n === 30, m ? `v${m.version}: ${m.bins.map((b) => `n=${b.n} win=${b.win.toFixed(2)} mean=${b.mean.toFixed(3)}`).join("; ")}` : "no map");
    } finally {
      await tape.close();
      await db.done();
    }
    return { checks, metrics: { bins: bins.length } };
  },
};
