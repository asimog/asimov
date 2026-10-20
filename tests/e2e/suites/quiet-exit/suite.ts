// Time is an input: with no trades after an entry, the Desk's time exit fires only because clock.tick events arrive on the Tape,
// and the same tape run twice closes the same positions at the same times.
import type { Trade } from "../../../../packages/contracts/src/index.ts";
import { putSignal } from "../../../../services/core/src/board/board.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { desk } from "../../../../services/core/src/mind/desk.ts";
import { step, type Tx } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const CALLER = "CaLLer1111111111111111111111111111111111111";
const P0 = 1e-7;
const QUIET_S = 4 * 3600;
const TICK_S = 60;

async function run(tag: string, ticks: boolean) {
  const db = await freshDb(tag);
  const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
  const clock = replayClock(t0);
  const tape = new Tape(db.sql, clock);
  let n = 0;
  const at = (s: number) => clock.advance!(t0 + s * 1000);
  const trade = (price: number, o: Partial<Trade> = {}): Trade => ({
    mint: MINT, tx: `t${++n}`, slot_index_id: null, ts: "2026-10-19T12:00:00.000Z", side: "buy", wallet: `W${n}`, sol: 0.5, usd: null, tokens: 0.5 / price, price_sol: price, price_usd: null, mcap_usd: null, on_curve: true, program: null, pool_sol: null, ...o,
  });
  try {
    const sig = (kind: string, value: unknown) => putSignal(db.sql as unknown as Tx, clock, { kind, subject: MINT, value, confidence: 0.9, validMs: 24 * 3_600_000, inputs: [], analyzer: "test" });
    await sig("precall.callout_p", { p: 1, p_peak: 1, edge_norm: 1, creator_share: 0 });
    await sig("curve.progress", { progress: 0.2, mcap_usd: 9000 });
    await sig("flow.state", { buyers_60s: 20, heat: 1, top_share: 0 });
    await sig("risk.state", { bundle_share: 0, top10_share: 0.1, creator_sold: 0, score: 0 });
    const buy = tape.emit("trade.curve", trade(P0, { wallet: CALLER, tokens: 1e6 }), { source: "nats", subject: MINT });
    tape.emit("precall.detected", { mint: MINT, caller: CALLER, trade_id: buy.id, buy_sol: 0.1, p: 1, horizon_min: 10 }, { source: "analyzer", subject: MINT });
    await tape.flush();
    for (let s = 2; s <= 20; s += 2) {
      at(s);
      tape.emit("trade.curve", trade(P0), { source: "nats", subject: MINT });
      await tape.flush();
    }
    if (ticks)
      for (let s = 20 + TICK_S; s <= QUIET_S; s += TICK_S) {
        at(s);
        tape.emit("clock.tick", { every_ms: TICK_S * 1000 }, { source: "system" });
        if (s % 3600 === 0) await tape.flush();
      }
    await tape.flush();
    const d = desk(tape, clock);
    while (await step(db.sql, d)) { /* drain */ }
    const [o] = await db.sql`select count(*)::int n from mind.positions`;
    const closed = await db.sql`select strategy_id, closed_at, exit_reason from mind.positions where closed_at is not null order by strategy_id, closed_at`;
    return { opened: o!.n as number, closed: closed.map((r) => `${r.strategy_id}@${(r.closed_at as Date).toISOString()}:${r.exit_reason}`) };
  } finally {
    await tape.close();
    await db.done();
  }
}

export const suite: Suite = {
  name: "quiet-exit",
  tier: "fast",
  covers: ["services/core/src/mind/desk.ts", "packages/contracts/src/index.ts"],
  proves: "After an entry and no further trades, the Desk's time exits fire only when clock.tick events reach it, and the same tape twice closes the same positions at the same times.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const silent = await run("quietnone", false);
    const a = await run("quieta", true);
    const b = await run("quietb", true);
    add("positions opened before the market went quiet", silent.opened > 0 && a.opened > 0, `${silent.opened} without ticks, ${a.opened} with (an exit frees the per-coin cap for another entry)`);
    add("with no tick, a quiet market never closes a position", silent.closed.length === 0, `${silent.closed.length} closed`);
    add("ticks close positions during the quiet hours", a.closed.length > 0, `${a.closed.length} of ${a.opened} closed: ${a.closed.slice(0, 3).join("; ")}`);
    add("the same tape closes the same positions at the same times", JSON.stringify(a.closed) === JSON.stringify(b.closed), `${b.closed.length} closed on the second run`);
    return { checks, metrics: { opened: a.opened, closed: a.closed.length } };
  },
};
