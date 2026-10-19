// The rug feed (docs/UI.md /integrity, docs/SYSTEM.md section 10): risk evidence about coins, in three classes that never mix.
// Observed: scraped replies that report a rug or a dev dump (text and time only, never a handle or wallet, @mentions masked).
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
      const risk = await sql`select distinct on (subject) subject, value, confidence, produced_at, valid_until, analyzer, valid_until < now() stale
        from board.signals where kind = 'risk.state' and produced_at > now() - interval '24 hours' order by subject, produced_at desc`;
      const replies = await sql`select body->>'mint' mint, seen_time, body->>'text' text from tape.events
        where topic = 'callout.reply' and seen_time > now() - interval '24 hours' order by seen_time desc, id desc limit 5000`;
      const reports = new Map<string, { t: number; text: string }[]>();
      for (const r of replies) {
        if (!RUG_WORDS.test(r.text as string)) continue;
        const l = reports.get(r.mint as string) ?? [];
        if (l.length < 6) l.push({ t: (r.seen_time as Date).getTime(), text: mask(r.text as string) });
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
