// The fixture tape through memory, cheap analyzers, Reflex (recorded Jev answers) and the Scorekeeper.

import { env } from "../../../../services/core/src/lib/env.ts";
import { ledger } from "../../../../services/core/src/scorekeeper/ledger.ts";
import { HORIZONS, scoresAsOf } from "../../../../services/core/src/scorekeeper/scorekeeper.ts";
import { everyReplayChecks, signalCounts, topicCounts } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "analyzers-replay",
  tier: "slow",
  covers: ["services/core/src/analyzers/", "services/core/src/reflex/", "services/core/src/memory/", "services/core/src/scorekeeper/"],
  proves: "Every cheap analyzer and every Jev pack question produces signals from the tape, the Scorekeeper resolves outcomes and Brier scores, and the replay checks hold.",
  tape: true,
  async run(ctx) {
    const r = await ctx.replay();
    const sql = r.sql;
    const signals = await signalCounts(sql);
    const scores = (await scoresAsOf(sql, r.last)).map((s) => ({ kind: s.kind, horizon_min: s.horizon_min, n: s.n, brier: s.brier_sum / s.n, base_rate: s.hits / s.n, mean_p: s.p_sum / s.n }));
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
      { name: "outcomes resolved at every horizon", pass: outcomes.length === HORIZONS.length && outcomes.every((o) => o.n > 0), detail: outcomes.map((o) => `${o.h}m:${o.n}`).join(" ") },
      { name: "brier scores computed", pass: scores.length > 0, detail: `${scores.length} kind x horizon rows` },
    ];
    // caller.dna and the ledger count the same calls with the same median, as of the moment the dna was computed
    const dnas = await sql`select subject, produced_at, value from board.signals where kind = 'caller.dna' and (value->>'resolved')::int > 0 order by produced_at, id`;
    const off: string[] = [];
    for (const d of dnas) {
      const v = d.value as { resolved: number; net_win: number; med_net: number };
      const L = (await ledger(sql, { horizon: env.num("DNA_HORIZON_MIN"), at: (d.produced_at as Date).toISOString() })).rows.find((x) => x.wallet === d.subject);
      if (!L || L.ok !== v.resolved || L.net_win !== v.net_win || L.net_med !== v.med_net) off.push(`${(d.subject as string).slice(0, 8)}: dna ${v.resolved}/${v.net_win}/${v.med_net} ledger ${L?.ok}/${L?.net_win}/${L?.net_med}`);
    }
    checks.push({ name: "ledger and caller.dna agree", pass: dnas.length > 0 && off.length === 0, detail: `${dnas.length} dna signals with outcomes, ${off.length} disagree${off[0] ? `: ${off[0]}` : ""}` });
    return { checks, metrics: { replay: { inputs: r.inputs, steps: r.steps, ms: r.ms, db: r.db, from: r.first, to: r.last }, memory: mem, signals, scores, outcomes, topics } };
  },
};
