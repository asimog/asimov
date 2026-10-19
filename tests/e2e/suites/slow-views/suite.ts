// The slow-mind read surface (docs/SLOW-MIND.md section 4): BettaFish-shaped views exist with upstream's column names, the
// slow_reader role can read them and nothing else, and slow.as_of hides everything seen after it.
import { connect, migrate } from "../../../../services/core/src/lib/db.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

const SHAPE: Record<string, string[]> = {
  pumpfun_callout: ["note_id", "content", "title", "nickname", "user_id", "liked_count", "comment_count", "share_count", "viewd_count", "create_time", "note_url", "source_keyword", "mint"],
  pumpfun_callout_comment: ["comment_id", "note_id", "content", "nickname", "like_count", "create_time"],
  pumpfun_update: ["comment_id", "note_id", "content", "create_time"],
  pumpfun_caller: ["wallet", "handle", "calls_seen", "dna"],
  pumpfun_coin: ["mint", "symbol", "curve", "risk"],
  pumpfun_trade_flow: ["mint", "minute", "net_flow_sol", "unique_buyers"],
  media: ["media_id", "url", "kind", "mint"],
  report_feed: ["report_id", "producer", "subject", "sha256", "summary", "cites", "parent_reports"],
};

export const suite: Suite = {
  name: "slow-views",
  tier: "fast",
  covers: ["services/core/src/sql/schema.sql"],
  proves: "Slow views carry the column shapes the upstream engines expect, slow_reader reads only them, and slow.as_of hides later rows.",
  async run() {
    const sql = connect(undefined, 2);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    try {
      await migrate(sql);
      for (const [view, cols] of Object.entries(SHAPE)) {
        const have = new Set((await sql`select column_name from information_schema.columns where table_schema = 'slow' and table_name = ${view}`).map((r) => r.column_name as string));
        const miss = cols.filter((c) => !have.has(c));
        add(`slow.${view} has the expected columns`, miss.length === 0, miss.join(", ") || `${have.size} columns`);
      }
      const url = new URL(env.str("DATABASE_URL"));
      url.username = "slow_reader";
      const ro = connect(url.toString(), 1);
      try {
        const [n] = await ro`select count(*)::int n from slow.pumpfun_callout`;
        add("slow_reader reads slow.pumpfun_callout", typeof n!.n === "number", `${n!.n} rows`);
        const denied = async (q: Promise<unknown>) => q.then(() => false, () => true);
        add("slow_reader cannot read mem.* directly", await denied(ro`select 1 from mem.callouts limit 1`));
        add("slow_reader cannot write slow.reports", await denied(ro`insert into slow.reports (report_id, producer, kind, subject, sha256, summary, published_at) values ('x','x','x','x','x','x', now())`));
        add("slow_reader cannot read the Tape", await denied(ro`select 1 from tape.events limit 1`));
        const [all] = await ro`select count(*)::int n, min(created_at) first from slow.pumpfun_callout`;
        if ((all!.n as number) > 0) {
          const pinned = await ro.begin(async (tx) => {
            await tx`select set_config('slow.as_of', ${new Date((all!.first as Date).getTime() - 1).toISOString()}, true)`;
            return (await tx`select count(*)::int n from slow.pumpfun_callout`)[0]!.n as number;
          });
          add("slow.as_of before the first callout hides every callout", pinned === 0, `${pinned} visible of ${all!.n}`);
        } else add("slow.as_of check skipped: no callouts", true, "empty database");
      } finally {
        await ro.end({ timeout: 2 });
      }
    } finally {
      await sql.end({ timeout: 2 });
    }
    return { checks, metrics: { views: Object.keys(SHAPE).length } };
  },
};
