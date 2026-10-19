// Commit-reveal: every position's decision is hashed at entry and revealed at close; every reveal matches.
import crypto from "node:crypto";
import { canonical } from "../../../../packages/contracts/src/index.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "commit-reveal",
  tier: "slow",
  covers: ["services/core/src/mind/desk.ts", "services/core/src/hands/thesis.ts", "services/core/src/hands/publisher.ts"],
  proves: "Every decision commit is published as a hash before the outcome, and every reveal matches its hash when recomputed from the revealed content.",
  tape: true,
  async run(ctx) {
    const sql = (await ctx.replay()).sql;
    const pairs = await sql`
      select m.body->>'sha256' sha, r.body->'content' content, (r.body->>'matches')::bool claimed, m.seen_time made, r.seen_time revealed
      from tape.events m join tape.events r on r.topic = 'commit.revealed' and r.body->>'commit_id' = m.body->>'commit_id'
      where m.topic = 'commit.made'`;
    const recomputed = pairs.filter((p) => crypto.createHash("sha256").update(canonical(p.content)).digest("hex") === p.sha).length;
    const ordered = pairs.filter((p) => (p.made as Date) < (p.revealed as Date)).length;
    const [made] = await sql`select count(*)::int n from tape.events where topic = 'commit.made'`;
    const min = Number(process.env.E2E_MIN_REVEALS ?? 20);
    return {
      checks: [
        { name: `at least ${min} reveals`, pass: pairs.length >= min, detail: `${pairs.length} reveals of ${made!.n} commits` },
        { name: "every reveal matches when recomputed", pass: recomputed === pairs.length, detail: `${recomputed} of ${pairs.length}` },
        { name: "every reveal came after its commit", pass: ordered === pairs.length, detail: `${ordered} of ${pairs.length}` },
        { name: "every reveal claims a match", pass: pairs.every((p) => p.claimed), detail: `${pairs.filter((p) => p.claimed).length} of ${pairs.length}` },
      ],
      metrics: { commits: made!.n, reveals: pairs.length, sample: pairs.slice(0, 3).map((p) => ({ sha: p.sha, content: p.content })) },
    };
  },
};
