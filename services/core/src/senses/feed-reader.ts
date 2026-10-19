// Feed Reader (docs/PIPELINE.md): every Pump.fun callout, push-first with polls as the safety net. Sources come from
// config/feeds.json. Every HTTP source keeps its own cursor in tape.feed_cursors. Filters from config/filters.json run
// before a callout is written; rejected callouts are counted by reason and chain and a hash sample is written as
// filter.sampled. A refused source is skipped for that poll and counted, never retried around.

import crypto from "node:crypto";
import type { Envelope } from "@asimog/contracts";
import type { NatsConnection } from "@nats-io/nats-core";
import { isoOrNull } from "../lib/clock.ts";
import type { Config } from "../lib/config.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { putBlob, type Tape } from "../tape/tape.ts";
import { passes, type RejectReason, sampled } from "./filters.ts";
import { consume, decodeJson, natsConnect } from "./nats.ts";
import { pumpGet } from "./pump-http.ts";

type FeedItem = {
  coinMint: string;
  coinName: string | null;
  coinImage: string | null;
  symbol: string | null;
  marketCap: number | null;
  program: string | null;
  chain: string | null;
  position?: {
    userId: string | null;
    userName: string | null;
    walletAddress: string;
    xUsername: string | null;
    followerCount: number | null;
    totalCallouts: number | null;
    amountHeld: number | null;
    costBasisUsd: number | null;
    pnlUsd: number | null;
    contentKind?: string;
    callout?: {
      calloutId: string;
      calledOutAtMcap: number | null;
      calloutPrice: number | null;
      thesis: string | null;
      mediaUrl: string | null;
      calloutTimestamp: string;
      chain: string | null;
      quotedCalloutId: string | null;
      multiple: number | null;
      maxMultiplier: number | null;
      likes: number | null;
      replyCount: number | null;
      commentCount: number | null;
      repostCount: number | null;
      quoteCount: number | null;
      viewCount: number | null;
      updates?: { id: string; content: string; createdAt: string }[];
    };
  };
};
type FeedPage = { coins: FeedItem[]; headToken?: string; nextPageToken?: string };
type Source = "recent" | "hot" | "follow";
type Via = "poll" | "push" | "history";
type Http = (path: string, params: Record<string, string | number | undefined>) => Promise<{ status: number; body: FeedPage | null; raw: string }>;

const PATHS: Record<Exclude<Source, "follow">, string> = { recent: "/home-feed/new", hot: "/home-feed" };

export class FeedReader {
  private seen = new Map<string, number>(); // calloutId -> counts hash (in-memory fast path; tape dedupe is the truth)
  private exitSeen = new Set<string>();
  private nc: NatsConnection | null = null;
  private stopped = false;
  private lastGoodPoll: Record<string, number> = {};
  readonly stats = {
    polls: 0, pushes: 0, created: 0, gaps: 0, errors: 0, filtered: 0,
    rejected: {} as Record<RejectReason, number>,
    rejected_by_chain: {} as Record<string, number>,
    refused: {} as Record<string, number>, // "<source>:<status>" -> polls skipped
  };

  constructor(private tape: Tape, private config: Config, private http: Http = pumpGet, private samplePct = env.int("FILTER_SAMPLE_PCT")) {}

  async start() {
    if (this.config.feeds.sources.includes("recent")) {
      // the startup walk stops at the newest callout an earlier run already read
      const [cur] = await this.tape.sql`select newest_at from tape.feed_cursors where name = 'recent'`;
      await this.backfill(env.int("FEED_BACKFILL_MIN"), env.int("FEED_BACKFILL_PAGES"), 0, "poll", (cur?.newest_at as Date | undefined)?.getTime(), undefined, "recent");
    }
    void this.pollLoop();
    // the Index's callout history (docs/PIPELINE.md): 30 days, paged slowly in the background so live polling keeps its turn
    const days = env.num("INDEX_CALLOUT_DAYS");
    if (days > 0) void this.history(days * 1440);
    if (this.config.feeds.sources.includes("follow") && env.bool("FEED_PUSH")) await this.startPush();
  }

  /** Newest callout read by this source; only moves forward. */
  private async markNewest(source: Source, page: FeedPage) {
    const t = page.coins.map((c) => isoOrNull(c.position?.callout?.calloutTimestamp)).filter((x): x is string => !!x).sort().at(-1);
    if (t) await this.tape.sql`insert into tape.feed_cursors (name, newest_at) values (${source}, ${t})
      on conflict (name) do update set newest_at = greatest(tape.feed_cursors.newest_at, excluded.newest_at), updated_at = now()`;
  }

  /** The history walk resumes from its saved page token and never re-walks once it reached its target. */
  private async history(minutes: number) {
    const target = this.tape.clock.now() - minutes * 60_000;
    const [c] = await this.tape.sql`select oldest_at, token from tape.feed_cursors where name = 'history'`;
    const oldest = (c?.oldest_at as Date | undefined)?.getTime();
    if (oldest != null && (oldest <= target || !c?.token)) return log.info("feed history already walked", { oldest: new Date(oldest).toISOString() });
    await this.backfill(minutes, env.int("INDEX_CALLOUT_PAGES"), env.int("INDEX_CALLOUT_PAGE_MS"), "history", undefined, (c?.token as string | null) ?? undefined, "recent");
  }

  async stop() {
    this.stopped = true;
    await this.nc?.close();
  }

  // ---------- poll ----------
  private async pollLoop() {
    const every = env.int("FEED_POLL_MS");
    while (!this.stopped) {
      for (const source of this.config.feeds.sources) if (source !== "follow") await this.pollSource(source);
      await new Promise((r) => setTimeout(r, every));
    }
  }

  /** Poll one HTTP source. A challenge (403) or 429 skips it for this poll and is counted with its status. */
  async pollSource(source: Exclude<Source, "follow">): Promise<number> {
    this.stats.polls++;
    try {
      const page = await this.fetchPage(source);
      if (!page) return 0;
      let fresh = await this.ingestPage(page, "poll", source);
      await this.markNewest(source, page);
      if (source === "recent") fresh = await this.walkGap(page, fresh);
      this.lastGoodPoll[source] = this.tape.clock.now();
      return fresh;
    } catch (err) {
      this.stats.errors++;
      log.warn("feed poll", { source, err: String(err) });
      return 0;
    }
  }

  async pollOnce(): Promise<number> {
    return this.pollSource("recent");
  }

  private async walkGap(page: FeedPage, firstFresh: number): Promise<number> {
    let fresh = firstFresh;
    let token = page.nextPageToken;
    let pages = 0;
    let oldest = page.coins.at(-1)?.position?.callout?.calloutTimestamp;
    while (fresh === page.coins.length && token && pages < env.int("FEED_GAP_PAGES")) {
      this.stats.gaps++;
      const older = await this.fetchPage("recent", token);
      if (!older) break;
      fresh = await this.ingestPage(older, "poll", "recent");
      oldest = older.coins.at(-1)?.position?.callout?.calloutTimestamp ?? oldest;
      token = older.nextPageToken;
      pages++;
    }
    // the walk never met a known callout: callouts between the last good poll and the oldest one reached may be missing
    if (this.lastGoodPoll.recent && fresh === page.coins.length && page.coins.length && oldest && Date.parse(oldest) > this.lastGoodPoll.recent)
      this.tape.emit("system.gap", { source: "feed", scope: null, from: new Date(this.lastGoodPoll.recent).toISOString(), to: new Date(oldest).toISOString(), reason: "feed gap walk ran out of pages" }, { source: "feedreader" });
    return fresh;
  }

  /** Walk back from `token` (or page 1) to `knownMs`, else `minutes` ago. The history walk saves its place after every page. */
  async backfill(minutes: number, pages: number, pauseMs: number, via: Via, knownMs?: number, token?: string, source: Exclude<Source, "follow"> = "recent") {
    const stopAt = knownMs ?? this.tape.clock.now() - minutes * 60_000; // after downtime, back to what was read (pages still bound it)
    for (let i = 0; i < pages && !this.stopped; i++) {
      if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      const page = (await this.fetchPage(source, token)) ?? (token && i === 0 ? await this.fetchPage(source) : null); // a stale saved token starts over
      if (!page?.coins.length) break;
      await this.ingestPage(page, via, source);
      if (via === "poll" && i === 0) await this.markNewest(source, page);
      const oldest = isoOrNull(page.coins.at(-1)?.position?.callout?.calloutTimestamp);
      if (via === "history" && oldest) await this.tape.sql`insert into tape.feed_cursors (name, oldest_at, token) values ('history', ${oldest}, ${page.nextPageToken ?? null})
        on conflict (name) do update set oldest_at = excluded.oldest_at, token = excluded.token, updated_at = now()`;
      if (!oldest || Date.parse(oldest) < stopAt || !page.nextPageToken) break;
      token = page.nextPageToken;
    }
    log.info("feed backfill done", { minutes, via, created: this.stats.created });
  }

  private async fetchPage(source: Exclude<Source, "follow">, pageToken?: string): Promise<FeedPage | null> {
    const res = await this.http(PATHS[source], {
      pageSize: env.int("FEED_PAGE_SIZE"),
      chain: "all",
      platform: "WEB",
      pageToken,
    });
    if (res.status === 403 || res.status === 429) {
      const key = `${source}:${res.status}`;
      this.stats.refused[key] = (this.stats.refused[key] ?? 0) + 1;
      log.warn("feed source refused", { source, status: res.status, skipped: true });
      return null;
    }
    if (res.status !== 200 || !res.body || !Array.isArray(res.body.coins)) {
      this.tape.emit("system.schema_drift", { kind: "feed", detail: { source, status: res.status, sample: res.raw.slice(0, 300) } }, { source: "feedreader" });
      return null;
    }
    return res.body;
  }

  private async ingestPage(page: FeedPage, via: Via, source: Source): Promise<number> {
    const newOnes = page.coins.filter((c) => c.position?.callout && !this.seen.has(c.position.callout.calloutId));
    let ob: Envelope | null = null;
    if (newOnes.length) {
      const raw = JSON.stringify(page);
      const { sha256, bytes } = await putBlob(this.tape.sql, "http", PATHS[source as Exclude<Source, "follow">] ?? "followingFeed", raw);
      ob = this.tape.emit("observation.raw", { kind: "http", url: PATHS[source as Exclude<Source, "follow">] ?? "followingFeed", sha256, bytes, blob_ref: sha256, sample: null }, { source: "feedreader" });
    }
    let fresh = 0;
    for (const item of page.coins) if (this.ingestItem(item, via, ob ? [ob.id] : [], source)) fresh++;
    return fresh;
  }

  /** Applies the callout door. Returns true only when a new callout was written. */
  ingestItem(item: FeedItem, via: Via, causes: string[], source: Source = "recent"): boolean {
    const p = item.position;
    const c = p?.callout;
    const calledAt = isoOrNull(c?.calloutTimestamp);
    if (!p || !c || !calledAt) return false;
    const isNew = !this.seen.has(c.calloutId);
    if (!isNew) return false;
    const positionUsd = p.costBasisUsd ?? (p.amountHeld != null && c.calloutPrice != null ? p.amountHeld * c.calloutPrice : null);
    const chain = c.chain ?? item.chain ?? null;
    const mcapUsd = c.calledOutAtMcap ?? item.marketCap ?? null;
    const reason = passes({ callout_id: c.calloutId, chain, position_usd: positionUsd, mcap_usd: mcapUsd }, this.config.filters.callout);
    this.seen.set(c.calloutId, -1);
    if (reason) {
      this.stats.filtered++;
      this.stats.rejected[reason] = (this.stats.rejected[reason] ?? 0) + 1;
      const byChain = chain ?? "unknown";
      this.stats.rejected_by_chain[byChain] = (this.stats.rejected_by_chain[byChain] ?? 0) + 1;
      if (sampled(c.calloutId, this.samplePct))
        this.tape.emit("filter.sampled", { reason, source, chain, callout: { callout_id: c.calloutId, mint: item.coinMint, position_usd: positionUsd, mcap_usd: mcapUsd }, launch: null }, { source: "feedreader", subject: c.calloutId, causes });
      return false;
    }
    this.tape.emit(
      "coin.seen",
      { mint: item.coinMint, symbol: item.symbol, name: item.coinName, image: item.coinImage, mcap_usd: item.marketCap, program: item.program, chain },
      { source: "feedreader", subject: item.coinMint, causes, dedupe: `coin:${item.coinMint}:${new Date(this.tape.clock.now()).toISOString().slice(0, 13)}` },
    );
    this.tape.emit(
      "callout.created",
      {
        callout_id: c.calloutId,
        mint: item.coinMint,
        symbol: item.symbol,
        name: item.coinName,
        author_wallet: p.walletAddress,
        author_user_id: p.userId,
        author_handle: p.userName,
        author_x: p.xUsername,
        author_followers: p.followerCount,
        author_total_callouts: p.totalCallouts,
        text: c.thesis ?? "",
        media_url: c.mediaUrl,
        mcap_at_call_usd: c.calledOutAtMcap,
        price_at_call_usd: c.calloutPrice,
        created_at: calledAt,
        chain,
        quoted_callout_id: c.quotedCalloutId,
        author_position: { amount_held: p.amountHeld, cost_basis_usd: p.costBasisUsd, pnl_usd: p.pnlUsd },
        via,
      },
      { source: "feedreader", subject: c.calloutId, causes, eventTime: calledAt, dedupe: `callout:${c.calloutId}` },
    );
    this.stats.created++;
    for (const u of c.updates ?? []) {
      const updatedAt = isoOrNull(u.createdAt);
      if (!updatedAt) continue;
      this.tape.emit(
        "callout.updated",
        { callout_id: c.calloutId, mint: item.coinMint, update_id: u.id, text: u.content, created_at: updatedAt },
        { source: "feedreader", subject: c.calloutId, causes, eventTime: updatedAt, dedupe: `update:${u.id}` },
      );
    }
    const counts = {
      likes: c.likes ?? 0,
      replies: c.replyCount ?? 0,
      comments: c.commentCount ?? 0,
      reposts: c.repostCount ?? 0,
      quotes: c.quoteCount ?? 0,
      views: c.viewCount ?? 0,
    };
    const h = hashNum({ ...counts, m: Math.round((c.multiple ?? 0) * 100) });
    if (via === "poll" && this.seen.get(c.calloutId) !== h) {
      this.tape.emit(
        "callout.counts",
        { callout_id: c.calloutId, mint: item.coinMint, ...counts, multiple: c.multiple, max_multiple: c.maxMultiplier, mcap_usd: item.marketCap },
        { source: "feedreader", subject: c.calloutId, causes, dedupe: `counts:${c.calloutId}:${h}` }, // a restart's re-walk never re-emits the same counts
      );
    }
    this.seen.set(c.calloutId, via === "poll" ? h : (this.seen.get(c.calloutId) ?? -1));
    if (this.seen.size > 50_000) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }

  // ---------- push ----------
  private async startPush() {
    this.nc = await natsConnect("feed", () => this.tape.clock.now(), (from, to) =>
      this.tape.emit("system.gap", { source: "feed.push", scope: null, from: new Date(from).toISOString(), to: new Date(to).toISOString(), reason: "NATS feed connection dropped; the poll still covers the interval" }, { source: "feedreader" }),
    );
    const sub = this.nc.subscribe("followingFeed.user.>");
    void consume(sub, (_subject, data) => {
      const m = decodeJson(data) as {
        type?: string;
        walletAddress?: string;
        coinMint?: string;
        coinSymbol?: string;
        coinImageUri?: string;
        userId?: string;
        isExited?: boolean;
        amountHeld?: number;
        costBasisUsd?: number;
        realizedPnlSol?: number;
        timestamp?: number;
        callout?: { calloutId: string; calloutPrice: number; calloutMarketCap: number; thesis: string; createdAt: number; multiplier?: number; maxMultiplier?: number };
      };
      if (m.type !== "position" || !m.coinMint || !m.walletAddress) return;
      this.stats.pushes++;
      if (m.callout) {
        this.ingestItem(
          {
            coinMint: m.coinMint,
            coinName: null,
            coinImage: m.coinImageUri ?? null,
            symbol: m.coinSymbol ?? null,
            marketCap: null,
            program: null,
            chain: null, // the payload carries chainId, not a chain name: the door's unknown_chain decides
            position: {
              userId: m.userId ?? null,
              userName: null,
              walletAddress: m.walletAddress,
              xUsername: null,
              followerCount: null,
              totalCallouts: null,
              amountHeld: m.amountHeld ?? null,
              costBasisUsd: m.costBasisUsd ?? null,
              pnlUsd: null,
              callout: {
                calloutId: m.callout.calloutId,
                calledOutAtMcap: m.callout.calloutMarketCap,
                calloutPrice: m.callout.calloutPrice,
                thesis: m.callout.thesis,
                mediaUrl: null,
                calloutTimestamp: new Date(m.callout.createdAt).toISOString(),
                chain: null,
                quotedCalloutId: null,
                multiple: m.callout.multiplier ?? null,
                maxMultiplier: m.callout.maxMultiplier ?? null,
                likes: null,
                replyCount: null,
                commentCount: null,
                repostCount: null,
                quoteCount: null,
                viewCount: null,
              },
            },
          },
          "push",
          [],
          "follow",
        );
      }
      const exitKey = `${m.walletAddress}:${m.coinMint}`;
      if (m.isExited && !this.exitSeen.has(exitKey)) {
        this.exitSeen.add(exitKey);
        if (this.exitSeen.size > 50_000) this.exitSeen.delete(this.exitSeen.values().next().value!);
        this.tape.emit(
          "caller.position",
          {
            callout_id: m.callout?.calloutId ?? null,
            mint: m.coinMint,
            wallet: m.walletAddress,
            is_exited: true,
            amount_held: m.amountHeld ?? null,
            realized_pnl_sol: m.realizedPnlSol ?? null,
            at: new Date(m.timestamp ?? this.tape.clock.now()).toISOString(),
          },
          { source: "feedreader", subject: m.coinMint, dedupe: `exit:${m.walletAddress}:${m.coinMint}` },
        );
      }
    });
    log.info("feed push subscribed");
  }
}

function hashNum(o: Record<string, number>): number {
  return crypto.createHash("md5").update(JSON.stringify(o)).digest().readUInt32BE(0);
}
