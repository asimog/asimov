// The runtime: one place that wires parts together. main.ts runs it live; the replay driver runs the same consumers.

import { cheapAnalyzers } from "./analyzers/cheap.ts";
import { indexSignals } from "./analyzers/index-signals.ts";
import { precallAnalyzers } from "./analyzers/precall.ts";
import { slowSignals } from "./analyzers/slow-signals.ts";
import { publisher } from "./hands/publisher.ts";
import { buildLeaderboards, compact } from "./index/compact.ts";
import { linkFunders } from "./index/funders.ts";
import { snapshotHolders } from "./index/holders.ts";
import { refresh, seed } from "./index/refresh.ts";
import type { Clock } from "./lib/clock.ts";
import { configValues } from "./lib/config.ts";
import type { Sql } from "./lib/db.ts";
import { env } from "./lib/env.ts";
import { log } from "./lib/log.ts";
import { RpcPool } from "./lib/rpc.ts";
import { startMcp } from "./mcp/server.ts";
import { parseTokens, Toolbox } from "./mcp/toolbox.ts";
import { memory } from "./memory/projections.ts";
import { desk } from "./mind/desk.ts";
import { escalationGate } from "./mind/escalate.ts";
import { reflexSignals, reflexTrigger } from "./reflex/reflex.ts";
import { scorekeeper } from "./scorekeeper/scorekeeper.ts";
import { Backfill } from "./senses/backfill.ts";
import { ChainReader } from "./senses/chain-reader.ts";
import { FeedReader } from "./senses/feed-reader.ts";
import { LaunchFacts } from "./senses/launch-facts.ts";
import { MediaCache } from "./senses/media-cache.ts";
import { ReplyReader } from "./senses/reply-reader.ts";
import { Scout } from "./senses/scout.ts";
import { ensureGenesis } from "./soul/soul.ts";
import { Archiver } from "./tape/archiver.ts";
import { type Consumer, runLive } from "./tape/consumer.ts";
import { Tape } from "./tape/tape.ts";
import { buildTargets } from "./tape/targets.ts";
import { treasuryWiring } from "./treasury/wire.ts";
import { exportWiki, wikiBuilder } from "./wiki/wiki.ts";

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
  const t = Object.fromEntries(["analyzers.cheap", "analyzers.precall", "analyzers.index", "analyzers.slow", "reflex.trigger", "reflex.signals", "desk", "attention", "publisher", "scorekeeper", "wiki"].map((n) => [n, own(n)]));
  const at = (n: string) => [t[n]!, t[n]!.clock] as const;
  return [
    memory, cheapAnalyzers(t["analyzers.cheap"]!.clock), precallAnalyzers(...at("analyzers.precall")), indexSignals(t["analyzers.index"]!.clock), slowSignals(t["analyzers.slow"]!.clock),
    reflexTrigger(...at("reflex.trigger")), reflexSignals(t["reflex.signals"]!.clock),
    desk(...at("desk")), escalationGate(...at("attention")), publisher(...at("publisher")), scorekeeper(...at("scorekeeper")), wikiBuilder(...at("wiki")),
  ];
}

export async function runtime({ sql, clock }: { sql: Sql; clock: Clock }): Promise<Runtime> {
  const tape = new Tape(sql, clock);
  const treasury = treasuryWiring(sql, tape, clock); // null without keys: paper runs as before
  const consumers = [...buildConsumers(tape), ...(treasury?.consumers ?? [])];
  const config = configValues(); // main.ts already validated it; the senses read the same values
  const archiver = env.bool("ARCHIVER") ? new Archiver(tape, sql, config, undefined, consumers.map((c) => c.name)) : null;
  const feed = env.bool("SENSE_FEED") ? new FeedReader(tape, config) : null;
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
      }, env.int("SCOUT_HOT_WALLETS"), { config, facts: new LaunchFacts(pool.size ? pool : null), onDemote: (mint) => chain.unwatch(mint) })
    : null;
  // Backfill's read is the chain's own answer: the Scout re-checks the launch facts against it (B3)
  if (backfill && scout) backfill.onRead = (mint, trades) => scout.recheck(mint, trades);
  const timers: NodeJS.Timeout[] = [];
  // the door for thinking agents (docs/SYSTEM.md): off unless MCP_TOKENS names at least one lane
  const tokens = parseTokens(env.opt("MCP_TOKENS"));
  const soulFile = `${env.root}/SOUL.md`;
  let mcp: Awaited<ReturnType<typeof startMcp>> | null = null;
  // the Index (docs/PIPELINE.md): seed lists every INDEX_SEED_HOURS, a new score version every INDEX_REFRESH_MIN
  const indexJobs = async (seedToo: boolean) => {
    try {
      if (seedToo) await seed(sql, clock.iso());
      await linkFunders(sql, pool, clock.iso());
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
      const every = env.int("TAPE_TICK_MS"); // time on the Tape: Clock work in a quiet period, the same in replay
      timers.push(setInterval(() => tape.emit("clock.tick", { every_ms: every }, { source: "system" }), every));
      treasury?.start();
      await ensureGenesis(sql, soulFile); // the soul chain exists whether or not any agent lane is configured
      if (tokens.size) {
        mcp = await startMcp(new Toolbox({ sql, tape, clock, soulFile }, tokens), Number(env.str("MCP_PORT")));
        log.info("mcp", { url: mcp.url, lanes: tokens.size });
      }
      replies?.start(); // before the feed: its start walks history and can take minutes
      media?.start();
      await feed?.start();
      await chain?.start();
      await scout?.start();
      backfill?.start();
      archiver?.start();
      timers.push(setInterval(() => log.info("stats", rt.stats()), env.int("STATS_EVERY_MS")));
      // E3: the wiki's markdown export to the owner's targets (a folder, a bucket or a git repository)
      const wikiTargets = buildTargets(config.retention.wiki_targets);
      if (wikiTargets.length) timers.push(setInterval(() => void exportWiki(sql, wikiTargets).catch((err) => log.warn("wiki export", { err: String(err) })), config.schedules.wiki_export_every_min * 60_000));
      if (scout) {
        void indexJobs(true);
        timers.push(setInterval(() => void indexJobs(false), env.num("INDEX_REFRESH_MIN") * 60_000));
        timers.push(setInterval(() => void indexJobs(true), env.num("INDEX_SEED_HOURS") * 3_600_000));
        // B7 schedules: compact hourly, leaderboards hourly, light 12 h, full 48 h, weekly reference
        const s = config.schedules;
        // every index job runs on one chain, so overlapping timers never run compaction or a rebuild at the same time
        let chain = Promise.resolve();
        const serial = (what: string, job: () => Promise<unknown>) => {
          chain = chain.then(job).then(() => undefined, (err) => log.warn(what, { err: String(err) }));
        };
        const maintain = () => {
          serial("compact", () => compact(sql, clock.iso(), config.retention.rollup_hourly_hours));
          serial("leaderboards", () => buildLeaderboards(sql, clock.iso()));
        };
        maintain();
        timers.push(setInterval(() => serial("compact", () => compact(sql, clock.iso(), config.retention.rollup_hourly_hours)), s.rollup_compact_every_min * 60_000));
        timers.push(setInterval(() => serial("leaderboards", () => buildLeaderboards(sql, clock.iso())), s.leaderboards_every_min * 60_000));
        timers.push(setInterval(() => serial("leaderboards", () => buildLeaderboards(sql, clock.iso())), s.index_light_every_min * 60_000));
        const full = () =>
          serial("index full rebuild", async () => {
            await indexJobs(false);
            await compact(sql, clock.iso(), config.retention.rollup_hourly_hours);
            await buildLeaderboards(sql, clock.iso(), { newVersion: true });
          });
        timers.push(setInterval(full, s.index_full_every_min * 60_000));
        timers.push(setInterval(full, s.index_weekly_every_min * 60_000));
      }
    },
    async stop() {
      for (const t of timers) clearInterval(t);
      archiver?.stop();
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
      return { mem_mb: { rss: Math.round(m.rss / 1e6), heap: Math.round(m.heapUsed / 1e6) }, tape: { written: tape.written, deduped: tape.deduped, queued: tape.queued, unhealthy: tape.unhealthy }, feed: feed?.stats, chain: chain?.stats, scout: scout?.stats, index: scout?.rollup.stats, backfill: backfill?.stats, archive: archiver?.stats, replies: replies?.stats, media: media?.stats, rpc: pool.stats, jev: of("reflex.trigger"), desk: of("desk"), attention: of("attention"), publisher: of("publisher"), scorekeeper: of("scorekeeper"), wiki: of("wiki") };
    },
  };
  return rt;
}
