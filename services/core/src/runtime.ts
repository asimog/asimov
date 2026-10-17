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
import { Scout } from "./senses/scout.ts";
import { type Consumer, runLive } from "./tape/consumer.ts";
import { Tape } from "./tape/tape.ts";

export interface Runtime {
  tape: Tape;
  consumers: Consumer[];
  start(): Promise<void>;
  stop(): Promise<void>;
  stats(): Record<string, unknown>;
}

/** Consumers in dependency order. Analyzers and mind add themselves here as they are built. */
export function buildConsumers(tape: Tape): Consumer[] {
  return [
    memory, cheapAnalyzers(tape.clock), precallAnalyzers(tape.clock), indexSignals(tape.clock), reflexTrigger(tape, tape.clock), reflexSignals(tape.clock),
    desk(tape, tape.clock), publisher(tape, tape.clock), replies(tape, tape.clock), scorekeeper(tape, tape.clock),
  ];
}

export async function runtime({ sql, clock }: { sql: Sql; clock: Clock }): Promise<Runtime> {
  const tape = new Tape(sql, clock);
  const consumers = buildConsumers(tape);
  const feed = env.bool("SENSE_FEED", true) ? new FeedReader(tape) : null;
  const pool = new RpcPool();
  const backfill = env.bool("SENSE_BACKFILL", true) && pool.size ? new Backfill(tape, sql, pool) : null;
  const chain = env.bool("SENSE_CHAIN", true) ? new ChainReader(tape, sql, (mint) => backfill?.enqueue(mint)) : null;
  const scout = chain && env.bool("SCOUT", true)
    ? new Scout(tape, sql, (mint) => chain.isWatched(mint), (mint, curveAccount, eventId) => {
        chain.watchNow(mint); // subscribes and queues the Backfill
        // a coin seconds old may be unknown to the RPC yet: snapshot after HOLDERS_DELAY_S, retry once
        const snap = (tries: number) => void snapshotHolders(pool, tape, mint, curveAccount, [eventId]).catch((err) =>
          tries > 0 ? setTimeout(() => snap(tries - 1), 30_000) : log.warn("holders", { mint, err: String(err).slice(0, 120) }));
        if (pool.size) setTimeout(() => snap(1), env.int("HOLDERS_DELAY_S", 15) * 1000);
      })
    : null;
  const timers: NodeJS.Timeout[] = [];
  // the Index (docs/23): seed lists every INDEX_SEED_HOURS, a new score version every INDEX_REFRESH_MIN
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
      await feed?.start();
      await chain?.start();
      await scout?.start();
      backfill?.start();
      timers.push(setInterval(() => log.info("stats", rt.stats()), env.int("STATS_EVERY_MS", 30_000)));
      if (scout) {
        void indexJobs(true);
        timers.push(setInterval(() => void indexJobs(false), env.num("INDEX_REFRESH_MIN", 60) * 60_000));
        timers.push(setInterval(() => void indexJobs(true), env.num("INDEX_SEED_HOURS", 6) * 3_600_000));
      }
    },
    async stop() {
      for (const t of timers) clearInterval(t);
      await feed?.stop();
      await scout?.stop();
      backfill?.stop();
      await chain?.stop();
      await tape.close();
    },
    stats() {
      const of = (name: string) => (consumers.find((c) => c.name === name) as { stats?: unknown } | undefined)?.stats;
      return { tape: { written: tape.written, dropped: tape.dropped }, feed: feed?.stats, chain: chain?.stats, scout: scout?.stats, index: scout?.rollup.stats, backfill: backfill?.stats, rpc: pool.stats, jev: of("reflex.trigger"), desk: of("desk"), publisher: of("publisher"), scorekeeper: of("scorekeeper") };
    },
  };
  return rt;
}
