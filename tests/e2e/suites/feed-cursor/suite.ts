// The feed cursor (docs/PIPELINE.md feed): a restarted reader walks only what it has not read. A fake feed serves 20 pages;
// the reader runs twice in its own process on one database, and the second run may fetch page 1 only.
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const PAGE = 5;
const item = (i: number, at: number) => ({
  coinMint: `mint${i}`, coinName: null, coinImage: null, symbol: `S${i}`, marketCap: null, program: null, chain: "solana",
  position: {
    userId: null, userName: null, walletAddress: `W${i % 7}`, xUsername: null, followerCount: null, totalCallouts: null, amountHeld: null, costBasisUsd: null, pnlUsd: null,
    callout: { calloutId: `c${i}`, calledOutAtMcap: null, calloutPrice: null, thesis: null, mediaUrl: null, calloutTimestamp: new Date(at).toISOString(), chain: "solana", quotedCalloutId: null,
      multiple: null, maxMultiplier: null, likes: 0, replyCount: 0, commentCount: 0, repostCount: 0, quoteCount: 0, viewCount: 0 },
  },
});

export const suite: Suite = {
  name: "feed-cursor",
  proves: "A restarted feed reader does not re-walk the feed: the startup walk stops at the newest callout already read and the history walk resumes or stays done; callouts posted during the downtime are still read.",
  async run() {
    const checks: Check[] = [];
    const t0 = Date.now();
    let items = Array.from({ length: 100 }, (_, i) => item(i, t0 - (i + 1) * 60_000)); // newest first, one a minute
    const requests: string[] = [];
    const server = http.createServer((req, res) => {
      const token = new URL(req.url!, "http://x").searchParams.get("pageToken");
      requests.push(token ?? "page1");
      const from = token ? Number(token) : 0;
      const coins = items.slice(from, from + PAGE);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ coins, nextPageToken: from + PAGE < items.length ? String(from + PAGE) : undefined }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const db = await freshDb("feedcursor");
    const run = () => new Promise<number>((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", path.join(import.meta.dirname, "reader.ts")], {
        env: { ...process.env, DATABASE_URL: db.url, PUMP_API_URL: `http://127.0.0.1:${port}`, FEED_PAGE_SIZE: String(PAGE), FEED_BACKFILL_MIN: "30", FEED_BACKFILL_PAGES: "40",
          FEED_POLL_MS: "600000", FEED_GAP_PAGES: "10", FEED_PUSH: "false", INDEX_CALLOUT_DAYS: "1", INDEX_CALLOUT_PAGES: "100", INDEX_CALLOUT_PAGE_MS: "1" },
        stdio: "ignore",
      });
      const kill = setTimeout(() => child.kill(), 60_000);
      child.on("exit", (code) => {
        clearTimeout(kill);
        resolve(code ?? 1);
      });
    });
    try {
      const first = await run();
      const firstReqs = requests.splice(0);
      items = [item(100, t0), item(101, t0 + 1000), ...items].sort((a, b) => (a.position.callout.calloutTimestamp < b.position.callout.calloutTimestamp ? 1 : -1)); // posted during the downtime
      const second = await run();
      const secondReqs = requests.splice(0);
      const [n] = await db.sql`select count(*)::int n, count(distinct body->>'callout_id')::int ids from tape.events where topic = 'callout.created'`;
      const [cur] = await db.sql`select (select newest_at from tape.feed_cursors where name = 'poll') newest, (select token from tape.feed_cursors where name = 'history') token`;
      checks.push({ name: "both runs exit cleanly", pass: first === 0 && second === 0, detail: `exit codes ${first}, ${second}` });
      checks.push({ name: "the first run walks the whole feed once", pass: new Set(firstReqs).size === 100 / PAGE, detail: `${firstReqs.length} requests over ${new Set(firstReqs).size} pages` });
      checks.push({ name: "a restart fetches page 1 only", pass: secondReqs.length > 0 && secondReqs.every((r) => r === "page1"), detail: `${secondReqs.length} requests: ${secondReqs.join(", ")}` });
      checks.push({ name: "callouts from the downtime are read, nothing twice", pass: n!.n === 102 && n!.ids === 102, detail: `${n!.n} callout.created, ${n!.ids} distinct` });
      checks.push({ name: "cursors saved", pass: cur!.newest != null && cur!.token == null, detail: `poll newest ${(cur!.newest as Date | null)?.toISOString()}, history token ${cur!.token}` });
      return { checks, metrics: { first: firstReqs.length, second: secondReqs.length } };
    } finally {
      server.close();
      await db.done();
    }
  },
};
