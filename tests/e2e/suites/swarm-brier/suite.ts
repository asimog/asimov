// The Scorekeeper scores MiroShark's swarm.wave_p (docs/SLOW-MIND.md P8): a run that predicted a wave is a hit when five or more
// distinct callers really call the coin within SWARM_HORIZON_MIN, scored only after the horizon passes (no lookahead).
// And BettaFish's coin stance (synthesis.coin) as P(price up at STANCE_HORIZON_MIN): bullish 1, bearish 0; a coin with
// no trade on either side is not scored.
import { putSignal } from "../../../../services/core/src/board/board.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { scorekeeper } from "../../../../services/core/src/scorekeeper/scorekeeper.ts";
import { step } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT_HIT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT_MISS = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const MINT_QUIET = "4Nd1mYQq9jN5vYw3fR8kZ2sT6uXbLpH7cGaE1dKoV9Mq";
const trade = (mint: string, price: number, at: string, tx: string) => ({ mint, tx, slot_index_id: null, ts: at, side: "buy" as const, wallet: "W0", sol: 0.1, usd: null, tokens: 1e6, price_sol: price, price_usd: null, mcap_usd: null, on_curve: true, program: null });
const callout = (id: string, mint: string, wallet: string, at: string) => ({
  callout_id: id, mint, symbol: null, name: null, author_wallet: wallet, author_user_id: null, author_handle: null, author_x: null, author_followers: null, author_total_callouts: null,
  text: "call", media_url: null, mcap_at_call_usd: null, price_at_call_usd: null, created_at: at, chain: null, quoted_callout_id: null, author_position: null, via: "history" as const,
});

export const suite: Suite = {
  name: "swarm-brier",
  proves: "swarm.wave_p is Brier-scored against the real feed: a hit when five or more distinct callers call within the horizon, a miss otherwise, never before the horizon has passed. synthesis.coin stances are scored on the price an hour later; a coin with no trades is skipped.",
  async run() {
    const db = await freshDb("swarmbrier");
    const t0 = Date.UTC(2026, 9, 18, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    try {
      const sk = scorekeeper(tape, clock);
      await db.sql.begin(async (tx) => {
        await putSignal(tx, clock, { kind: "swarm.wave_p", subject: MINT_HIT, value: { wave_p: 0.8 }, confidence: 0.5, validMs: 1_800_000, inputs: [], analyzer: "miroshark@1", at: new Date(t0).toISOString() });
        await putSignal(tx, clock, { kind: "swarm.wave_p", subject: MINT_MISS, value: { wave_p: 0.6 }, confidence: 0.5, validMs: 1_800_000, inputs: [], analyzer: "miroshark@1", at: new Date(t0).toISOString() });
        for (const [mint, stance] of [[MINT_HIT, "bullish"], [MINT_MISS, "bearish"], [MINT_QUIET, "neutral"]] as const)
          await putSignal(tx, clock, { kind: "synthesis.coin", subject: mint, value: { stance }, confidence: 0.6, validMs: 1_800_000, inputs: [], analyzer: "bettafish@1", at: new Date(t0).toISOString() });
      });
      for (const m of [MINT_HIT, MINT_MISS]) tape.emit("trade.curve", trade(m, 1e-8, new Date(t0).toISOString(), `t0${m}`), { source: "nats", subject: m });
      const at = (min: number) => {
        clock.advance!(t0 + min * 60_000);
        return new Date(t0 + min * 60_000).toISOString();
      };
      for (let i = 0; i < 5; i++) tape.emit("callout.created", callout(`c_hit${i}`, MINT_HIT, `W${i}`, at(10 + i)), { source: "feedreader", subject: MINT_HIT });
      for (let i = 0; i < 3; i++) tape.emit("callout.created", callout(`c_miss${i}`, MINT_MISS, `W${i}`, at(20 + i)), { source: "feedreader", subject: MINT_MISS });
      for (const m of [MINT_HIT, MINT_MISS]) tape.emit("trade.curve", trade(m, 2e-8, at(50), `t50${m}`), { source: "nats", subject: m }); // both coins rose
      tape.emit("callout.created", callout("c_mid", MINT_MISS, "W9", at(60)), { source: "feedreader", subject: MINT_MISS });
      await tape.flush();
      while (await step(db.sql, sk)) { /* drain */ }
      const [early] = await db.sql`select count(*)::int n from mind.score_days where kind = 'swarm.wave_p'`;
      add("nothing is scored before the horizon passes", early!.n === 0, `${early!.n} rows at 60 min`);
      tape.emit("callout.created", callout("c_late", MINT_MISS, "W8", at(125)), { source: "feedreader", subject: MINT_MISS });
      await tape.flush();
      while (await step(db.sql, sk)) { /* drain */ }
      const [s] = await db.sql`select sum(n)::int n, sum(hits)::int hits, sum(brier_sum)::float brier_sum, sum(p_sum)::float p_sum from mind.score_days where kind = 'swarm.wave_p'`;
      add("both swarm runs are scored after the horizon", s?.n === 2, JSON.stringify(s));
      add("five distinct callers is a hit, four is a miss", s?.hits === 1, `hits ${s?.hits}`);
      const want = (0.8 - 1) ** 2 + (0.6 - 0) ** 2;
      add("the Brier sum is (0.8-1)^2 + (0.6-0)^2", Math.abs(Number(s?.brier_sum) - want) < 1e-9, `${s?.brier_sum} vs ${want}`);
      const [st] = await db.sql`select sum(n)::int n, sum(hits)::int hits, sum(brier_sum)::float brier_sum from mind.score_days where kind = 'synthesis.coin' and horizon_min = 60`;
      add("stances are scored at one hour; the coin with no trades is skipped", st?.n === 2, JSON.stringify(st));
      add("bullish on a rising coin is right and bearish on it is wrong (Brier sum 1)", st?.hits === 2 && Number(st?.brier_sum) === 1, JSON.stringify(st));
      const [right] = await db.sql`select sum(n)::int n, sum(hits)::int hits from mind.score_days where kind = 'synthesis.coin.right'`;
      add("stance accuracy counts decisive stances right: bullish rose (right), bearish rose (wrong)", right?.n === 2 && right.hits === 1, JSON.stringify(right));
      return { checks, metrics: { brier: Number(s?.brier_sum) / Number(s?.n || 1), stance_brier: Number(st?.brier_sum) / Number(st?.n || 1) } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
