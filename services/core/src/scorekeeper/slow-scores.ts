// How well the slow mind did (docs/SLOW-MIND.md P8), one read for `ctl slow` and the site. Swarm Brier, the stance Brier and
// stance accuracy (share of decisive stances that were right) come from the Scorekeeper's trailing window (scoresAsOf); claim survival
// is counted from report.published (cites kept against cites the core dropped), per engine, over the window.
// Read-only, bounded by `at`.
import type { Sql } from "../lib/db.ts";
import { scoresAsOf } from "./scorekeeper.ts";

export type SlowScores = {
  swarm: { n: number; brier: number; base_rate: number; horizon_min: number } | null;
  stance: { n: number; brier: number; decisive: number; accuracy: number | null; horizon_min: number } | null;
  claims: { producer: string; reports: number; kept: number; dropped: number; survival: number | null }[];
};

export async function slowScores(sql: Sql, at: string, windowH = 24): Promise<SlowScores> {
  const rows = (await scoresAsOf(sql, at, ["swarm.wave_p", "synthesis.coin", "synthesis.coin.right"])).map((r) => ({ kind: r.kind, h: r.horizon_min, n: r.n, b: r.brier_sum, hits: r.hits }));
  const one = (k: string) => rows.find((r) => r.kind === k) as { h: number; n: number; b: number; hits: number } | undefined;
  const [sw, st, right] = [one("swarm.wave_p"), one("synthesis.coin"), one("synthesis.coin.right")];
  const claims = await sql`select body->>'producer' producer, count(*)::int reports, coalesce(sum(jsonb_array_length(body->'cites')), 0)::int kept,
      coalesce(sum((body->>'cites_dropped')::int), 0)::int dropped
    from tape.events where topic = 'report.published' and seen_time <= ${at} and seen_time > ${new Date(Date.parse(at) - windowH * 3_600_000).toISOString()}
    group by 1 order by 1`;
  return {
    swarm: sw ? { n: sw.n, brier: sw.b / sw.n, base_rate: sw.hits / sw.n, horizon_min: sw.h } : null,
    stance: st ? { n: st.n, brier: st.b / st.n, decisive: right?.n ?? 0, accuracy: right ? right.hits / right.n : null, horizon_min: st.h } : null,
    claims: claims.map((c) => {
      const [kept, dropped] = [c.kept as number, c.dropped as number];
      return { producer: c.producer as string, reports: c.reports as number, kept, dropped, survival: kept + dropped > 0 ? kept / (kept + dropped) : null };
    }),
  };
}
