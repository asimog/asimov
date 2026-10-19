// C4 (docs/STRATEGY.md section 5): honest promotion. A pool whose scores carry no information (returns are coin luck,
// shared by every member that traded the coin) promotes none; a family with a real edge still promotes. Pure kernel,
// seeded random, no database.
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { type AllocRow, allocate, statsOf } from "../../../../services/core/src/mind/kernel.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

const FAMILIES = 8;
const MEMBERS = 12;
const COINS = 120;
const BOOK = 0.2;

/** Each family sees COINS coins; every member trades a random 70% of them. A coin's return is shared luck plus a little noise. */
function pool(seed: number, edge: number): { rows: AllocRow[]; perTrade: AllocRow[] } {
  const rand = replayClock(0, seed).rand;
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
  const rows: AllocRow[] = [];
  const perTrade: AllocRow[] = [];
  for (let f = 0; f < FAMILIES; f++) {
    const coin = Array.from({ length: COINS }, () => edge + 0.3 * normal());
    const members = Array.from({ length: MEMBERS }, () => [] as number[]);
    const repeats = Array.from({ length: MEMBERS }, () => [] as number[]);
    for (const r of coin)
      for (let m = 0; m < MEMBERS; m++) {
        if (rand() >= 0.7) continue;
        const x = r + 0.02 * normal();
        members[m]!.push(x);
        repeats[m]!.push(x, x, x); // the old count: three re-entries on one coin were three trades
      }
    const family = { coinRets: coin, members: MEMBERS };
    for (let m = 0; m < MEMBERS; m++) {
      rows.push({ strategy_id: `f${f}m${m}`, stats: statsOf(members[m]!), family });
      perTrade.push({ strategy_id: `f${f}m${m}`, stats: statsOf(repeats[m]!), family: { coinRets: [], members: 1 } });
    }
  }
  return { rows, perTrade };
}

export const suite: Suite = {
  name: "promote-honest",
  tier: "fast",
  covers: ["services/core/src/mind/kernel.ts"],
  proves: "C4: a pool of random-score families (no edge, correlated trades) promotes none across seeds; a family with a real edge still leaves ghost.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    let promoted = 0;
    let naive = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { rows, perTrade } = pool(seed, 0);
      const rand = replayClock(0, seed + 100).rand;
      promoted += allocate(rows, BOOK, rand).filter((a) => a.stage !== "ghost").length;
      // the same pool judged the old way: every re-entry a trade, no family window, a 90% bound for one try
      naive += allocate(perTrade.map((r) => ({ ...r, family: { coinRets: r.stats.rets, members: 1 } })), BOOK, rand).filter((a) => a.stage !== "ghost").length;
    }
    add("a random-score pool promotes none (20 seeds, 960 strategies)", promoted === 0, `${promoted} promoted; ${naive} would leave ghost with no family window, no dedupe, no raised bound`);
    const good = allocate(pool(7, 0.12).rows, BOOK, replayClock(0, 7).rand).filter((a) => a.stage !== "ghost").length;
    add("a family with a real edge still promotes", good > 0, `${good} of ${FAMILIES * MEMBERS} left ghost at +12% per coin`);
    return { checks, metrics: { promoted, naive, good } };
  },
};
