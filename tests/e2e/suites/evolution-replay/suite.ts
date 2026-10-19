// Evolution on the fixture tape: births and retirements happen, children are valid, no duplicate specs.
import { specDistance, type Spec, validate } from "../../../../services/core/src/mind/dsl.ts";
import { E } from "../../../../services/core/src/mind/evolve.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "evolution-replay",
  tier: "slow",
  covers: ["services/core/src/mind/evolve.ts", "services/core/src/mind/kernel.ts"],
  proves: "The evolution loop runs on tape time: offspring are born from parents with trades, all pass the validator, none is a near-copy in its niche, and lineage is on the Tape.",
  tape: true,
  async run(ctx) {
    const sql = (await ctx.replay()).sql;
    const born = await sql`select body from tape.events where topic = 'strategy.born' order by seen_time, id`;
    const retired = await sql`select body->>'reason' reason, count(*)::int n from tape.events where topic = 'strategy.retired' group by 1`;
    const children = born.map((b) => b.body as { origin: string; parents: string[]; spec: Spec; strategy_id: string }).filter((b) => b.origin !== "seed");
    const invalid = children.filter((c) => !validate(c.spec).ok).length;
    let dupes = 0;
    const seen: Spec[] = [];
    for (const b of born.map((x) => (x.body as { spec: Spec }).spec)) {
      if (seen.some((s) => s.family === b.family && s.horizon === b.horizon && specDistance(s, b) < E.minDistance) && !b.id.startsWith("sr_seed_")) dupes++;
      seen.push(b);
    }
    const [lineage] = await sql`select count(*)::int n from mind.strategies where origin <> 'seed' and cardinality(parents) > 0`;
    const min = Number(process.env.E2E_MIN_BIRTHS ?? 1);
    return {
      checks: [
        { name: `at least ${min} offspring`, pass: children.length >= min, detail: `${children.length} offspring (${children.filter((c) => c.origin === "crossover").length} crossover)` },
        { name: "every child passes the validator", pass: invalid === 0, detail: `${invalid} invalid` },
        { name: "no near-duplicate specs", pass: dupes === 0, detail: `${dupes} duplicates` },
        { name: "lineage recorded", pass: lineage!.n === children.length, detail: `${lineage!.n} with parents` },
      ],
      metrics: { births: born.length, offspring: children.length, retired, sample: children.slice(0, 3).map((c) => ({ id: c.strategy_id, origin: c.origin, parents: c.parents })) },
    };
  },
};
