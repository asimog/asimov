// Creator records (docs/PIPELINE.md section 4): how many coins a creator launched in the last 7 days (a mass deployer
// launches many) and how their past coins ended. Read from idx.coin plus the launches the Index holds but has not
// flushed yet, as of `now`. The Scout writes the record onto `coin.watched`, so risk.state and replays read it from the Tape.
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";

const C = {
  /** a past coin is one at least this old: young coins have not ended yet */
  pastMin: env.num("CREATOR_PAST_MIN"),
  /** a past coin that did not graduate and fell under this share of its peak price is counted a rug */
  rugFrac: env.num("CREATOR_RUG_FRAC"),
};

export type CreatorRecord = { launches_7d: number; past: number; rugs: number; rug_rate: number | null };

/** `unflushed`: launches by this creator the Index holds in memory and has not written, as [mint, first seen ms]. */
export async function creatorRecord(sql: Sql, creator: string, nowMs: number, unflushed: [string, number][] = []): Promise<CreatorRecord> {
  const now = new Date(nowMs).toISOString();
  const [r] = await sql`select
      count(*) filter (where first_seen_at > ${now}::timestamptz - interval '7 days' and first_seen_at <= ${now})::int launches,
      count(*) filter (where first_seen_at <= ${now}::timestamptz - make_interval(mins => ${C.pastMin}))::int past,
      count(*) filter (where first_seen_at <= ${now}::timestamptz - make_interval(mins => ${C.pastMin}) and not graduated
        and peak_price > 0 and last_price < ${C.rugFrac}::float8 * peak_price)::int rugs
    from idx.coin where creator = ${creator} and not (mint = any(${unflushed.map(([m]) => m)}))`;
  const fresh = unflushed.filter(([, at]) => at > nowMs - 7 * 86_400_000 && at <= nowMs).length;
  const past = r!.past as number;
  const rugs = r!.rugs as number;
  return { launches_7d: (r!.launches as number) + fresh, past, rugs, rug_rate: past ? rugs / past : null };
}
