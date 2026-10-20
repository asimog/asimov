// The rug feed (docs/UI.md /integrity, docs/SYSTEM.md section 10): risk evidence about coins, in three classes that never mix.
// Observed: scraped replies that report a rug or a dev dump (text and time only, never a handle or wallet, @mentions masked),
// picked by the rug words or, since E7b, by the Librarian's similarity to the owner's rug examples; each says which.
// Computed: the latest `risk.state` Board signal with its method version. AI judgment: the latest BettaFish stance.
// Indicators, never accusations: nothing here names a person. Read-only.
import type postgres from "postgres";

type Deps = { sql: postgres.Sql; cached: (key: string, ms: number, fn: () => Promise<unknown>) => Promise<unknown>; sym: (mint?: string | null) => string };

/** A reply that reports a rug, a dev dump or a bundle. Matching words only; the page calls it a report, never a finding. */
export const RUG_WORDS = /\b(rug(ged|ging|pull)?|dev (sold|dumped|dumping|sells?)|dumped on|honeypot|bundled?|can'?t sell)\b/i;
const mask = (t: string) => t.replace(/@\w+/g, "@…").slice(0, 280);

export function rugFeed({ sql, cached, sym }: Deps) {
  return () =>
    cached("rugfeed", 8000, async () => {
      const [h] = await sql`select max(seen_time) head from tape.events`;
      const head = ((h?.head as Date | null) ?? new Date()).toISOString(); // the Tape's time, as every room
      const risk = await sql`select distinct on (subject) subject, value, confidence, produced_at, valid_until, analyzer, valid_until < ${head}::timestamptz stale
        from board.signals where kind = 'risk.state' and produced_at > ${head}::timestamptz - interval '24 hours' order by subject, produced_at desc`;
      const replies = await sql`select e.body->>'mint' mint, e.seen_time, e.body->>'text' text, s.similarity from tape.events e
        left join lateral (select max((x.body->>'similarity')::float) similarity from tape.events x
          where x.topic = 'reply.rug_score' and x.subject = e.body->>'reply_id' and (x.body->>'rug_like')::bool) s on true
        where e.topic = 'callout.reply' and e.seen_time > ${head}::timestamptz - interval '24 hours' order by e.seen_time desc, e.id desc limit 5000`;
      const reports = new Map<string, { t: number; text: string; match: "words" | "similar"; similarity?: number }[]>();
      for (const r of replies) {
        if (!r.mint) continue; // a reply with no coin belongs to no coin's feed
        const words = RUG_WORDS.test(r.text as string);
        if (!words && r.similarity == null) continue;
        const l = reports.get(r.mint as string) ?? [];
        if (l.length < 6) l.push({ t: (r.seen_time as Date).getTime(), text: mask(r.text as string), ...(words ? { match: "words" as const } : { match: "similar" as const, similarity: Math.round((r.similarity as number) * 100) / 100 }) });
        reports.set(r.mint as string, l);
      }
      const flagged = risk.filter((r) => (r.value.breaches as number) > 0);
      const mints = [...new Set([...flagged.map((r) => r.subject as string), ...reports.keys()])];
      const byMint = new Map(risk.map((r) => [r.subject as string, r]));
      const stances = mints.length
        ? await sql`select distinct on (subject) subject, seen_time, body->>'stance' stance, body->>'preset' preset from tape.events
            where topic = 'synthesis.coin' and subject = any(${mints}) order by subject, seen_time desc, id desc`
        : [];
      const stanceBy = new Map(stances.map((s) => [s.subject as string, s]));
      const coins = mints.map((mint) => {
        const r = byMint.get(mint);
        const s = stanceBy.get(mint);
        return {
          mint, sym: sym(mint),
          observed: reports.get(mint) ?? [],
          computed: r ? { ...(r.value as { score: number; breaches: number } & Record<string, number | null>), confidence: r.confidence as number, method: r.analyzer as string, t: (r.produced_at as Date).getTime(), stale: r.stale as boolean } : null,
          ai_judgment: s ? { stance: s.stance as string, by: `BettaFish ${s.preset}`, t: (s.seen_time as Date).getTime() } : null,
        };
      });
      coins.sort((a, b) => (b.computed?.score ?? 0) - (a.computed?.score ?? 0) || b.observed.length - a.observed.length);
      return { coins: coins.slice(0, 30), reports_scanned: replies.length, risk_coins: risk.length };
    });
}
