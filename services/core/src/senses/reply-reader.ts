// Reply Reader (docs/06, docs/24 4.2): reads the replies thread of recent callouts that have replies, from the same read
// endpoint the pump.fun site calls (`GET /callout/{id}/replies`, docs/research/pumpfun-endpoints.md). Writes
// `callout.reply` (one per reply, deduped by reply id). Polite: through pumpGet (one request in flight, backoff on 429),
// at most REPLY_CALLOUTS_PER_MIN threads a minute, a thread is re-read only when its reply count grew.
// Ways it fails: the endpoint changes shape (replies with no id or text are skipped and counted); a thread with more
// replies than one page (only the first page is read; counted as `truncated`); a deleted reply (tombstone, skipped).
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { Tape } from "../tape/tape.ts";
import { pumpGet } from "./pump-http.ts";

type Reply = { id?: string; content?: string; createdAt?: string; likeCount?: number; walletAddress?: string | null; userName?: string | null; mediaUrl?: string | null; parentMessageId?: string | null; tombstone?: boolean };

export class ReplyReader {
  private timer: NodeJS.Timeout | null = null;
  private seen = new Map<string, number>(); // callout_id -> reply count when last read
  stats = { threads: 0, replies: 0, skipped: 0, truncated: 0, errors: 0 };

  constructor(private tape: Tape, private sql: Sql) {}

  start() {
    const every = env.int("REPLY_POLL_S", 60) * 1000;
    const tick = () => void this.tick().catch((err) => (this.stats.errors++, log.warn("reply-reader", { err: String(err).slice(0, 160) })));
    tick();
    this.timer = setInterval(tick, every);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    const hours = env.num("REPLY_WINDOW_H", 6);
    const rows = await this.sql`select callout_id, mint, replies from mem.callouts
      where replies > 0 and created_at > now() - make_interval(hours => ${hours}) order by created_at desc limit 500`;
    const due = rows.filter((r) => (this.seen.get(r.callout_id as string) ?? -1) < Number(r.replies)).slice(0, env.int("REPLY_CALLOUTS_PER_MIN", 20));
    for (const r of due) await this.read(r.callout_id as string, r.mint as string, Number(r.replies));
  }

  async read(calloutId: string, mint: string, count: number) {
    const res = await pumpGet<{ replies?: Reply[] }>(`/callout/${encodeURIComponent(calloutId)}/replies`);
    if (res.status !== 200 || !res.body) return void this.stats.errors++;
    const list = res.body.replies ?? [];
    this.stats.threads++;
    if (list.length < count) this.stats.truncated++;
    for (const x of list) {
      if (!x.id || !x.content || !x.createdAt || x.tombstone) {
        this.stats.skipped++;
        continue;
      }
      this.tape.emit("callout.reply", { callout_id: calloutId, mint, reply_id: x.id, parent_id: x.parentMessageId ?? null, wallet: x.walletAddress ?? null, handle: x.userName ?? null, text: x.content, likes: x.likeCount ?? 0, media_url: x.mediaUrl ?? null, created_at: x.createdAt }, { source: "feedreader", subject: calloutId, dedupe: `reply:${x.id}` });
      this.stats.replies++;
    }
    this.seen.set(calloutId, count);
  }
}
