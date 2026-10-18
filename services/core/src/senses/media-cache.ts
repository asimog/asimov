// Media cache (docs/24 4.2): copies callout media and coin images, the files pump.fun already serves to every viewer,
// into our blob store (tape.blobs) with their sha256, and writes `media.cached`. BettaFish's Media engine reads them
// through slow.media and never fetches the web. Polite: MEDIA_PER_MIN files a minute, MEDIA_MAX_BYTES each.
// Ways it fails: a host that is not on the allow list (skipped; only pump.fun image hosts and the IPFS gateway it uses);
// a file that is not an image (skipped by content type); a file too large (skipped and counted).
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { putBlob, type Tape } from "../tape/tape.ts";

const HOSTS = () => (env.opt("MEDIA_HOSTS") ?? "socialimages.pump.fun,pump.mypinata.cloud,ipfs.io").split(",").map((h) => h.trim());

export class MediaCache {
  private timer: NodeJS.Timeout | null = null;
  stats = { cached: 0, skipped: 0, errors: 0 };
  private tried = new Set<string>(); // skipped this run: not picked again until restart

  constructor(private tape: Tape, private sql: Sql) {}

  start() {
    const tick = () => void this.tick().catch((err) => (this.stats.errors++, log.warn("media-cache", { err: String(err).slice(0, 160) })));
    tick();
    this.timer = setInterval(tick, 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    const rows = await this.sql`select m.media_id, m.url, m.kind, m.mint, m.callout_id from slow.media m
      where m.url is not null and not exists (select 1 from tape.events e where e.topic = 'media.cached' and e.subject = m.media_id)
      order by m.media_id desc limit ${env.int("MEDIA_PER_MIN") + this.tried.size}`;
    for (const r of rows.filter((x) => !this.tried.has(x.media_id as string)).slice(0, env.int("MEDIA_PER_MIN"))) await this.fetchOne(r.media_id as string, r.url as string, r.kind as string, r.mint as string, (r.callout_id as string | null) ?? null);
  }

  async fetchOne(mediaId: string, rawUrl: string, kind: string, mint: string, calloutId: string | null) {
    this.tried.add(mediaId);
    // public ipfs.io rate-limits; pump.fun itself loads the same files through its gateway (MEDIA_IPFS_GATEWAY)
    const url = rawUrl.replace(/^https:\/\/ipfs\.io\/ipfs\//, `${env.str("MEDIA_IPFS_GATEWAY")}/ipfs/`);
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      return void this.stats.skipped++;
    }
    if (!HOSTS().includes(host)) return void this.stats.skipped++;
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) }) /* a redirect could leave the host allowlist */.catch(() => null);
    const type = res?.headers.get("content-type") ?? "";
    if (!res?.ok || !type.startsWith("image/")) return void this.stats.skipped++;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > env.int("MEDIA_MAX_BYTES")) return void this.stats.skipped++;
    const blob = await putBlob(this.sql, "media", url, buf);
    this.tape.emit("media.cached", { media_id: mediaId, kind: kind as "callout" | "coin", mint, callout_id: calloutId, url, sha256: blob.sha256, bytes: blob.bytes, mime: type }, { source: "feedreader", subject: mediaId, dedupe: `media:${mediaId}` });
    this.stats.cached++;
  }
}
