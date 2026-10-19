// C1 (docs/STRATEGY.md section 5): idle counts only active market minutes, and every niche keeps a living member.
// A test-clock desk run: a few minutes of trades, a 3 h gap with none, trades again. Then a pure evolve() pool where
// every member of one niche is past the idle limit. Synthetic rows, fresh database, no tape.
import type { Trade } from "../../../../packages/contracts/src/index.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { desk } from "../../../../services/core/src/mind/desk.ts";
import { E, evolve, type Member } from "../../../../services/core/src/mind/evolve.ts";
import { seedSpecs } from "../../../../services/core/src/mind/seeds.ts";
import { step } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MIN = 60_000;
const trade = (n: number): Trade => ({
  mint: MINT, tx: `t${n}`, slot_index_id: null, ts: "2026-10-19T12:00:00.000Z", side: "buy", wallet: `W${n}`, sol: 0.1, usd: null, tokens: 0.1 / 3e-8, price_sol: 3e-8, price_usd: null, mcap_usd: null, on_curve: true, program: null,
});
const niche = (s: { family: string; horizon: string }) => `${s.family}|${s.horizon}`;

export const suite: Suite = {
  name: "evolve-floor",
  tier: "fast",
  covers: ["services/core/src/mind/evolve.ts", "services/core/src/mind/desk.ts"],
  proves: "C1: a 3 h quiet gap retires nothing as idle, because idle counts only minutes with trades; an evolve round where a whole niche is idle keeps that niche's fittest member.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const db = await freshDb("evolvefloor");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    try {
      let n = 0;
      const tradesFor = async (fromMin: number, minutes: number) => {
        for (let m = 0; m < minutes; m++) {
          clock.advance!(t0 + (fromMin + m) * MIN);
          tape.emit("trade.curve", trade(++n), { source: "nats", subject: MINT });
          await tape.flush();
        }
      };
      await tradesFor(0, 5);
      await tradesFor(5 + 180, 5); // 3 h with no trade, then the market wakes
      const d = desk(tape, clock);
      while (await step(db.sql, d)) { /* drain */ }
      await tape.flush();
      const retired = await db.sql`select body->>'reason' reason, count(*)::int n from tape.events where topic = 'strategy.retired' group by 1`;
      const idle = retired.find((r) => r.reason === "idle")?.n ?? 0;
      add("a 3 h gap retires nothing as idle", idle === 0, JSON.stringify(retired));
      const living = await db.sql`select family, horizon from mind.strategies where retired_at is null`;
      const want = new Set(seedSpecs().map(niche));
      const have = new Set(living.map((r) => niche(r as { family: string; horizon: string })));
      add("every niche keeps a living strategy after the gap", [...want].every((k) => have.has(k)), `${have.size} of ${want.size} niches`);
      const [ca] = await db.sql`select round from mind.desk_clock where name = 'active_min'`;
      add("active minutes count only minutes with trades", ca?.round === 10, `${ca?.round} active minutes over 190 Tape minutes`);
    } finally {
      await tape.close();
      await db.done();
    }

    // a pure evolve round: every member of the first niche is idle past the limit
    const specs = seedSpecs();
    const first = niche(specs[0]!);
    const stats = (sum: number) => ({ n: 3, sum, sq: sum * sum, rets: [sum / 3, sum / 3, sum / 3], max_dd: 0 });
    const pool: Member[] = specs.map((spec, i) => ({ spec, stats: stats(0.001 * (i + 1)), idle_min: niche(spec) === first ? E.retireIdleMin + 1 : 0, mk60: [] }));
    let seq = 0;
    const r = evolve(pool, 0.2, () => 0.5, () => `sr_child_${seq++}`);
    const left = pool.filter((m) => niche(m.spec) === first && !r.retire.some((x) => x.id === m.spec.id));
    const members = pool.filter((m) => niche(m.spec) === first);
    add("a niche that is all idle keeps one member", left.length === 1 && members.length > 1, `${left.length} of ${members.length} kept in ${first}`);
    return { checks, metrics: {} };
  },
};
