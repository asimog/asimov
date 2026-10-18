// How well the slow mind did (docs/24 P8), one read for `ctl slow` and the site. Swarm Brier and stance scores come
// from the Scorekeeper's mind.scores; claim survival is counted from report.published (cites kept against cites the
// core dropped), per engine, over the window. Read-only, bounded by `at`.
import type { Sql } from "../lib/db.ts";

export type SlowScores = {
  swarm: { n: number; brier: number | null; base_rate: number | null; horizon_min: number } | null;
  stance: { n: number; accuracy: number | null; up_rate: number | null; horizon_min: number } | null;
  claims: { producer: string; reports: number; kept: number; dropped: number; survival: number | null }[];
};

export async function slowScores(sql: Sql, at: string, windowH = 24): Promise<SlowScores> {
  const rows = await sql`select kind, horizon_min, n, brier_sum, hits from mind.scores where kind in ('swarm.wave_p', 'synthesis.coin') and n > 0`;
  const one = (k: string) => rows.find((r) => r.kind === k);
  const sw = one("swarm.wave_p");
  const st = one("synthesis.coin");
  const claims = await sql`select body->>'producer' producer, count(*)::int reports, coalesce(sum(jsonb_array_length(body->'cites')), 0)::int kept,
      coalesce(sum((body->>'cites_dropped')::int), 0)::int dropped
    from tape.events where topic = 'report.published' and seen_time <= ${at} and seen_time > ${new Date(Date.parse(at) - windowH * 3_600_000).toISOString()}
    group by 1 order by 1`;
  return {
    swarm: sw ? { n: sw.n as number, brier: (sw.brier_sum as number) / (sw.n as number), base_rate: (sw.hits as number) / (sw.n as number), horizon_min: sw.horizon_min as number } : null,
    stance: st ? { n: st.n as number, accuracy: 1 - (st.brier_sum as number) / (st.n as number), up_rate: (st.hits as number) / (st.n as number), horizon_min: st.horizon_min as number } : null,
    claims: claims.map((c) => ({ producer: c.producer as string, reports: c.reports as number, kept: c.kept as number, dropped: c.dropped as number, survival: (c.kept as number) + (c.dropped as number) > 0 ? (c.kept as number) / ((c.kept as number) + (c.dropped as number)) : null })),
  };
}
