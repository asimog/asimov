// Feed Reader (docs/PIPELINE.md): every Pump.fun callout, push-first with poll as the safety net.
// Push: NATS followingFeed.user.> (each callout fanned out per follower; dedupe by calloutId).
// Poll: home-feed/new every FEED_POLL_MS; gap walk with pageToken; startup backfill.
import { isoOrNull } from "../lib/clock.ts";
import crypto from "node:crypto";
import type { Envelope } from "@asimog/contracts";
import type { NatsConnection } from "@nats-io/nats-core";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { putBlob, type Tape } from "../tape/tape.ts";
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

type Via = "poll" | "push" | "history";

export class FeedReader {
  private seen = new Map<string, number>(); // calloutId -> counts hash (in-memory fast path; tape dedupe is the truth)
  private exitSeen = new Set<string>();
  private nc: NatsConnection | null = null;
  private stopped = false;
  private lastGoodPoll: number | null = null;
  stats = { polls: 0, pushes: 0, created: 0, gaps: 0, errors: 0 };

  constructor(private tape: Tape) {}

  async start() {
    await this.backfill(env.int("FEED_BACKFILL_MIN"), env.int("FEED_BACKFILL_PAGES"), 0, "poll");
    void this.pollLoop();
    // the Index's callout history (docs/PIPELINE.md): 30 days, paged slowly in the background so live polling keeps its turn
    const days = env.num("INDEX_CALLOUT_DAYS");
    if (days > 0) void this.backfill(days * 1440, env.int("INDEX_CALLOUT_PAGES"), env.int("INDEX_CALLOUT_PAGE_MS"), "history");
    if (env.bool("FEED_PUSH")) await this.startPush();
  }

  async stop() {
    this.stopped = true;
    await this.nc?.close();
  }

  // ---------- poll ----------
  private async pollLoop() {
    const every = env.int("FEED_POLL_MS");
    while (!this.stopped) {
      try {
        await this.pollOnce();
      } catch (err) {
        this.stats.errors++;
        log.warn("feed poll", { err: String(err) });
      }
      await new Promise((r) => setTimeout(r, every));
    }
  }

  async pollOnce(): Promise<number> {
    this.stats.polls++;
    const page = await this.fetchPage();
    if (!page) return 0;
    let fresh = await this.ingestPage(page, "poll");
    // gap: every item on page 1 was new -> walk back until we meet a known callout
    let token = page.nextPageToken;
    let pages = 0;
    let oldest = page.coins.at(-1)?.position?.callout?.calloutTimestamp;
    while (fresh === page.coins.length && token && pages < env.int("FEED_GAP_PAGES")) {
      this.stats.gaps++;
      const older = await this.fetchPage(token);
      if (!older) break;
      fresh = await this.ingestPage(older, "poll");
      oldest = older.coins.at(-1)?.position?.callout?.calloutTimestamp ?? oldest;
      token = older.nextPageToken;
      pages++;
    }
    // the walk never met a known callout: callouts between the last good poll and the oldest one reached may be missing
    if (this.lastGoodPoll && fresh === page.coins.length && page.coins.length && oldest && Date.parse(oldest) > this.lastGoodPoll)
      this.tape.emit("system.gap", { source: "feed", scope: null, from: new Date(this.lastGoodPoll).toISOString(), to: new Date(oldest).toISOString(), reason: "feed gap walk ran out of pages" }, { source: "feedreader" });
    this.lastGoodPoll = this.tape.clock.now();
    return fresh;
  }

  async backfill(minutes: number, pages: number, pauseMs: number, via: Via) {
    const stopAt = this.tape.clock.now() - minutes * 60_000;
    let token: string | undefined;
    for (let i = 0; i < pages && !this.stopped; i++) {
      if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      const page = await this.fetchPage(token);
      if (!page?.coins.length) break;
      await this.ingestPage(page, via);
      const oldest = page.coins.at(-1)?.position?.callout?.calloutTimestamp;
      if (!oldest || Date.parse(oldest) < stopAt || !page.nextPageToken) break;
      token = page.nextPageToken;
    }
    log.info("feed backfill done", { minutes, created: this.stats.created });
  }

  private async fetchPage(pageToken?: string): Promise<FeedPage | null> {
    const res = await pumpGet<FeedPage>("/home-feed/new", {
      pageSize: env.int("FEED_PAGE_SIZE"),
      chain: "all",
      platform: "WEB",
      pageToken,
    });
    if (res.status !== 200 || !res.body || !Array.isArray(res.body.coins)) {
      this.tape.emit("system.schema_drift", { kind: "feed", detail: { status: res.status, sample: res.raw.slice(0, 300) } }, { source: "feedreader" });
      return null;
    }
    return res.body;
  }

  private async ingestPage(page: FeedPage, via: Via): Promise<number> {
    const newOnes = page.coins.filter((c) => c.position?.callout && !this.seen.has(c.position.callout.calloutId));
    let ob: Envelope | null = null;
    if (newOnes.length) {
      const raw = JSON.stringify(page);
      const { sha256, bytes } = await putBlob(this.tape.sql, "http", "home-feed/new", raw);
      ob = this.tape.emit("observation.raw", { kind: "http", url: "home-feed/new", sha256, bytes, blob_ref: sha256, sample: null }, { source: "feedreader" });
    }
    let fresh = 0;
    for (const item of page.coins) if (this.ingestItem(item, via, ob ? [ob.id] : [])) fresh++;
    return fresh;
  }

  /** returns true if the callout was new */
  ingestItem(item: FeedItem, via: Via, causes: string[]): boolean {
    const p = item.position;
    const c = p?.callout;
    const calledAt = isoOrNull(c?.calloutTimestamp);
    if (!p || !c || !calledAt) return false;
    const isNew = !this.seen.has(c.calloutId);
    if (isNew) {
      this.tape.emit(
        "coin.seen",
        { mint: item.coinMint, symbol: item.symbol, name: item.coinName, image: item.coinImage, mcap_usd: item.marketCap, program: item.program, chain: item.chain },
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
          chain: c.chain ?? item.chain,
          quoted_callout_id: c.quotedCalloutId,
          author_position: { amount_held: p.amountHeld, cost_basis_usd: p.costBasisUsd, pnl_usd: p.pnlUsd },
          via,
        },
        { source: "feedreader", subject: c.calloutId, causes, eventTime: calledAt, dedupe: `callout:${c.calloutId}` },
      );
      this.stats.created++;
    }
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
    return isNew;
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
      if (m.callout && !this.seen.has(m.callout.calloutId)) {
        this.ingestItem(
          {
            coinMint: m.coinMint,
            coinName: null,
            coinImage: m.coinImageUri ?? null,
            symbol: m.coinSymbol ?? null,
            marketCap: null,
            program: null,
            chain: "solana",
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
                chain: "solana",
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
