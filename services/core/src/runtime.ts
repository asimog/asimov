// The runtime: one place that wires parts together. main.ts runs it live; the replay driver runs the same consumers.
import type { Clock } from "./lib/clock.ts";
import type { Sql } from "./lib/db.ts";
import { env } from "./lib/env.ts";
import { log } from "./lib/log.ts";
import { snapshotHolders } from "./index/holders.ts";
import { refresh, seed } from "./index/refresh.ts";
import { RpcPool } from "./lib/rpc.ts";
import { cheapAnalyzers } from "./analyzers/cheap.ts";
import { indexSignals } from "./analyzers/index-signals.ts";
import { slowSignals } from "./analyzers/slow-signals.ts";
import { precallAnalyzers } from "./analyzers/precall.ts";
import { memory } from "./memory/projections.ts";
import { publisher } from "./hands/publisher.ts";
import { replies } from "./hands/replies.ts";
import { desk } from "./mind/desk.ts";
import { reflexSignals, reflexTrigger } from "./reflex/reflex.ts";
import { scorekeeper } from "./scorekeeper/scorekeeper.ts";
import { Backfill } from "./senses/backfill.ts";
import { ChainReader } from "./senses/chain-reader.ts";
import { FeedReader } from "./senses/feed-reader.ts";
import { MediaCache } from "./senses/media-cache.ts";
import { ReplyReader } from "./senses/reply-reader.ts";
import { Scout } from "./senses/scout.ts";
import { startMcp } from "./mcp/server.ts";
import { parseTokens, Toolbox } from "./mcp/toolbox.ts";
import { ensureGenesis } from "./soul/soul.ts";
import { type Consumer, runLive } from "./tape/consumer.ts";
import { treasuryWiring } from "./treasury/wire.ts";
import { Tape } from "./tape/tape.ts";

export interface Runtime {
  tape: Tape;
  consumers: Consumer[];
  start(): Promise<void>;
  stop(): Promise<void>;
  stats(): Record<string, unknown>;
}

/** Consumers in dependency order. Each gets its own clock stream (Clock.fork), named after it. */
export function buildConsumers(tape: Tape): Consumer[] {
  const own = (name: string) => tape.for(tape.clock.fork(name));
  const t = Object.fromEntries(["analyzers.cheap", "analyzers.precall", "analyzers.index", "analyzers.slow", "reflex.trigger", "reflex.signals", "desk", "publisher", "replies", "scorekeeper"].map((n) => [n, own(n)]));
  const at = (n: string) => [t[n]!, t[n]!.clock] as const;
  return [
    memory, cheapAnalyzers(t["analyzers.cheap"]!.clock), precallAnalyzers(...at("analyzers.precall")), indexSignals(t["analyzers.index"]!.clock), slowSignals(t["analyzers.slow"]!.clock),
    reflexTrigger(...at("reflex.trigger")), reflexSignals(t["reflex.signals"]!.clock),
    desk(...at("desk")), publisher(...at("publisher")), replies(...at("replies")), scorekeeper(...at("scorekeeper")),
  ];
}

export async function runtime({ sql, clock }: { sql: Sql; clock: Clock }): Promise<Runtime> {
  const tape = new Tape(sql, clock);
  const treasury = treasuryWiring(sql, tape, clock); // null without keys: paper runs as before
  const consumers = [...buildConsumers(tape), ...(treasury?.consumers ?? [])];
  const feed = env.bool("SENSE_FEED") ? new FeedReader(tape) : null;
  const replies = env.bool("SENSE_REPLIES") ? new ReplyReader(tape, sql) : null;
  const media = env.bool("SENSE_MEDIA") ? new MediaCache(tape, sql) : null;
  const pool = new RpcPool();
  const backfill = env.bool("SENSE_BACKFILL") && pool.size ? new Backfill(tape, sql, pool) : null;
  const chain = env.bool("SENSE_CHAIN") ? new ChainReader(tape, sql, (mint) => backfill?.enqueue(mint)) : null;
  const scout = chain && env.bool("SCOUT")
    ? new Scout(tape, sql, (mint) => chain.isWatched(mint), (mint, curveAccount, eventId, features) => {
        chain.watchNow(mint); // subscribes and queues the Backfill
        // a coin seconds old may be unknown to the RPC yet: snapshot after HOLDERS_DELAY_S, retry once
        const snap = (tries: number) => void snapshotHolders(pool, tape, mint, curveAccount, [eventId], features).catch((err) =>
          tries > 0 ? setTimeout(() => snap(tries - 1), 30_000) : log.warn("holders", { mint, err: String(err).slice(0, 120) }));
        if (pool.size) setTimeout(() => snap(1), env.int("HOLDERS_DELAY_S") * 1000);
      })
    : null;
  const timers: NodeJS.Timeout[] = [];
  // the door for thinking agents (docs/SYSTEM.md): off unless MCP_TOKENS names at least one lane
  const tokens = parseTokens(env.opt("MCP_TOKENS"));
  const soulFile = `${env.root}/SOUL.md`;
  let mcp: Awaited<ReturnType<typeof startMcp>> | null = null;
  // the Index (docs/PIPELINE.md): seed lists every INDEX_SEED_HOURS, a new score version every INDEX_REFRESH_MIN
  const indexJobs = async (seedToo: boolean) => {
    try {
      if (seedToo) await seed(sql, clock.iso());
      await refresh(sql, tape);
    } catch (err) {
      log.warn("index", { err: String(err) });
    }
  };
  const rt: Runtime = {
    tape,
    consumers,
    async start() {
      void runLive(sql, consumers, clock);
      treasury?.start();
      if (tokens.size) {
        await ensureGenesis(sql, soulFile);
        mcp = await startMcp(new Toolbox({ sql, tape, clock, soulFile }, tokens), Number(env.str("MCP_PORT")));
        log.info("mcp", { url: mcp.url, lanes: tokens.size });
      }
      replies?.start(); // before the feed: its start walks history and can take minutes
      media?.start();
      await feed?.start();
      await chain?.start();
      await scout?.start();
      backfill?.start();
      timers.push(setInterval(() => log.info("stats", rt.stats()), env.int("STATS_EVERY_MS")));
      if (scout) {
        void indexJobs(true);
        timers.push(setInterval(() => void indexJobs(false), env.num("INDEX_REFRESH_MIN") * 60_000));
        timers.push(setInterval(() => void indexJobs(true), env.num("INDEX_SEED_HOURS") * 3_600_000));
      }
    },
    async stop() {
      for (const t of timers) clearInterval(t);
      treasury?.stop();
      await mcp?.close();
      await feed?.stop();
      replies?.stop();
      media?.stop();
      await scout?.stop();
      backfill?.stop();
      await chain?.stop();
      await tape.close();
    },
    stats() {
      const of = (name: string) => (consumers.find((c) => c.name === name) as { stats?: unknown } | undefined)?.stats;
      const m = process.memoryUsage();
      return { mem_mb: { rss: Math.round(m.rss / 1e6), heap: Math.round(m.heapUsed / 1e6) }, tape: { written: tape.written, dropped: tape.dropped }, feed: feed?.stats, chain: chain?.stats, scout: scout?.stats, index: scout?.rollup.stats, backfill: backfill?.stats, replies: replies?.stats, media: media?.stats, rpc: pool.stats, jev: of("reflex.trigger"), desk: of("desk"), publisher: of("publisher"), scorekeeper: of("scorekeeper") };
    },
  };
  return rt;
}
