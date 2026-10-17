// The fixture tape through memory, cheap analyzers, Reflex (recorded Jev answers) and the Scorekeeper.
import { everyReplayChecks, signalCounts, topicCounts } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "analyzers-replay",
  proves: "Every cheap analyzer and every Jev pack question produces signals from the tape, the Scorekeeper resolves outcomes and Brier scores, and the replay checks hold.",
  tape: true,
  async run(ctx) {
    const r = await ctx.replay();
    const sql = r.sql;
    const signals = await signalCounts(sql);
    const scores = await sql`select kind, horizon_min, n, round((brier_sum / n)::numeric, 4)::float brier, round((hits::float / n)::numeric, 4)::float base_rate,
      round((p_sum / n)::numeric, 4)::float mean_p from mind.scores order by kind, horizon_min`;
    const outcomes = await sql`select (body->>'horizon_min')::int h, count(*)::int n, round(avg((body->>'multiple')::float)::numeric, 4)::float mean_multiple,
      round(avg((body->>'new_callouts')::float)::numeric, 3)::float mean_new_callouts from tape.events where topic = 'outcome.measured' group by 1 order by 1`;
    const [mem] = await sql`select (select count(*)::int from mem.coins) coins, (select count(*)::int from mem.callers) callers, (select count(*)::int from mem.callouts) callouts, (select count(*)::int from mem.bars_1m) bars`;
    const required = ["age.opportunity", "echo.score", "hawkes.wave_p", "hawkes.branching", "hawkes.intensity", "callers.wave_p", "caller.dna", "curve.progress", "curve.quote",
      "jev.callout.kind", "jev.callout.thesis_quality", "jev.callout.promo", "jev.callout.countdown", "jev.callout.injection", "jev.callout.narrative"];
    const topics = await topicCounts(sql);
    const checks = [
      ...(await everyReplayChecks(sql, r.netCalls)),
      { name: "all signal kinds present", pass: required.every((k) => (signals[k]?.n ?? 0) > 0), detail: required.filter((k) => !signals[k]).join(", ") || `${required.length} kinds` },
      { name: "one jev signal set per recorded answer", pass: (signals["jev.callout.kind"]?.n ?? 0) === (topics["jev.answer"] ?? -1), detail: `${signals["jev.callout.kind"]?.n ?? 0} kind signals, ${topics["jev.answer"] ?? 0} answers` },
      { name: "outcomes resolved at every horizon", pass: outcomes.length === 3 && outcomes.every((o) => o.n > 0), detail: outcomes.map((o) => `${o.h}m:${o.n}`).join(" ") },
      { name: "brier scores computed", pass: scores.length > 0, detail: `${scores.length} kind x horizon rows` },
    ];
    return { checks, metrics: { replay: { inputs: r.inputs, windows: r.windows, ms: r.ms, db: r.db, from: r.first, to: r.last }, memory: mem, signals, scores, outcomes, topics } };
  },
};
