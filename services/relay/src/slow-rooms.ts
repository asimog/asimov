// The slow-mind rooms (docs/SLOW-MIND.md P8, docs/UI.md): /synthesis (BettaFish forum lines, feed and coin syntheses, reports with
// their cites) and /simulations (MiroShark swarm runs: wave probability, branch A vs B, belief drift, simulated posts,
// the Swarm Report). Read-only. Everything from MiroShark carries `simulated: true`; the site labels it SIMULATED.
import type postgres from "postgres";
import { slowScores } from "../../core/src/scorekeeper/slow-scores.ts";

type Deps = { sql: postgres.Sql; cached: (key: string, ms: number, fn: () => Promise<unknown>) => Promise<unknown>; sym: (mint?: string | null) => string };

export function slowRooms({ sql, cached, sym }: Deps) {
  const now = () => new Date().toISOString();
  const synthesis = () =>
    cached("synthesis", 5000, async () => {
      const forum = await sql`select id, seen_time, body from tape.events where topic = 'synthesis.forum_line' order by seen_time desc, id desc limit 40`;
      const [feed] = await sql`select seen_time, body from tape.events where topic = 'synthesis.feed' order by seen_time desc, id desc limit 1`;
      const coins = await sql`select distinct on (subject) subject, seen_time, body from tape.events where topic = 'synthesis.coin' order by subject, seen_time desc, id desc`;
      const reports = await sql`select report_id, producer, kind, subject, summary, cites, parent_reports, published_at, left(markdown, 6000) markdown from slow.reports
        where producer like 'bettafish.%' order by published_at desc limit 8`;
      return {
        forum: forum.reverse().map((f) => ({ id: f.id, t: (f.seen_time as Date).getTime(), agent: f.body.agent, text: String(f.body.text).replace(/@\w+/g, "@…"), cites: f.body.cites ?? [] })),
        feed: feed ? { t: (feed.seen_time as Date).getTime(), narratives: feed.body.narratives ?? [], claims_total: feed.body.claims_total ?? 0, claims_dropped: feed.body.claims_dropped ?? 0 } : null,
        coins: coins.sort((a, b) => (b.seen_time as Date).getTime() - (a.seen_time as Date).getTime()).slice(0, 12).map((c) => ({ mint: c.subject, sym: sym(c.subject), t: (c.seen_time as Date).getTime(), stance: c.body.stance, narrative: c.body.narrative, claims: c.body.claims ?? [], claims_dropped: c.body.claims_dropped ?? 0 })),
        reports: reports.map((r) => ({ id: r.report_id, producer: r.producer, kind: r.kind, subject: r.subject === "global" ? "feed" : sym(r.subject), summary: r.summary, cites: r.cites, parents: r.parent_reports, t: (r.published_at as Date).getTime(), markdown: r.markdown })),
        scores: await slowScores(sql as never, now()),
      };
    });

  const simulations = () =>
    cached("simulations", 5000, async () => {
      const runs = await sql`select w.seen_time, w.body wave, i.body impact, b.body beliefs from tape.events w
          left join lateral (select body from tape.events where topic = 'swarm.impact' and body->>'swarm_id' = w.body->>'swarm_id' limit 1) i on true
          left join lateral (select body from tape.events where topic = 'swarm.beliefs' and body->>'swarm_id' = w.body->>'swarm_id' limit 1) b on true
        where w.topic = 'swarm.wave_p' order by w.seen_time desc, w.id desc limit 6`;
      const out = [];
      for (const r of runs) {
        const id = r.wave.swarm_id as string;
        const posts = await sql`select body from tape.events where topic = 'swarm.post' and body->>'swarm_id' = ${id} order by id limit 60`;
        const [rep] = await sql`select report_id, summary, left(markdown, 8000) markdown, ir->'graph' graph from slow.reports where producer = 'miroshark.report' and report_id like ${`${id}%`} limit 1`;
        out.push({
          id, mint: r.wave.mint, sym: sym(r.wave.mint), t: (r.seen_time as Date).getTime(), simulated: true,
          wave_p: r.wave.wave_p, samples: r.wave.samples, truncated: r.wave.truncated, preset: r.wave.preset,
          d_callers: r.impact?.d_callers ?? null, d_net_sol: r.impact?.d_net_sol ?? null,
          drift: r.beliefs ? Object.fromEntries(Object.entries(r.beliefs.branches as Record<string, { round: number; stance: Record<string, number> }[][]>).map(([k, v]) => [k, v[0] ?? []])) : {},
          posts: posts.map((p) => ({ branch: p.body.branch, platform: p.body.platform ?? "pumpfun", agent: p.body.agent, archetype: p.body.archetype, text: String(p.body.text).replace(/@\w+/g, "@…") })), // simulated, but a persona may name a real handle
          report: rep ? { id: rep.report_id, summary: rep.summary, markdown: rep.markdown, graph: rep.graph } : null,
        });
      }
      return { runs: out, scores: await slowScores(sql as never, now()) };
    });

  return { synthesis, simulations };
}
