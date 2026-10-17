// The runtime: one place that wires parts together. main.ts runs it live; the replay driver runs the same consumers.
import type { Clock } from "./lib/clock.ts";
import type { Sql } from "./lib/db.ts";
import { env } from "./lib/env.ts";
import { log } from "./lib/log.ts";
import { cheapAnalyzers } from "./analyzers/cheap.ts";
import { memory } from "./memory/projections.ts";
import { desk } from "./mind/desk.ts";
import { reflexSignals, reflexTrigger } from "./reflex/reflex.ts";
import { scorekeeper } from "./scorekeeper/scorekeeper.ts";
import { ChainReader } from "./senses/chain-reader.ts";
import { FeedReader } from "./senses/feed-reader.ts";
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
  return [memory, cheapAnalyzers(tape.clock), reflexTrigger(tape, tape.clock), reflexSignals(tape.clock), desk(tape, tape.clock), scorekeeper(tape, tape.clock)];
}

export async function runtime({ sql, clock }: { sql: Sql; clock: Clock }): Promise<Runtime> {
  const tape = new Tape(sql, clock);
  const consumers = buildConsumers(tape);
  const feed = env.bool("SENSE_FEED", true) ? new FeedReader(tape) : null;
  const chain = env.bool("SENSE_CHAIN", true) ? new ChainReader(tape, sql) : null;
  let statsTimer: NodeJS.Timeout | null = null;
  const rt: Runtime = {
    tape,
    consumers,
    async start() {
      void runLive(sql, consumers, clock);
      await feed?.start();
      await chain?.start();
      statsTimer = setInterval(() => log.info("stats", rt.stats()), env.int("STATS_EVERY_MS", 30_000));
    },
    async stop() {
      if (statsTimer) clearInterval(statsTimer);
      await feed?.stop();
      await chain?.stop();
      await tape.close();
    },
    stats() {
      const of = (name: string) => (consumers.find((c) => c.name === name) as { stats?: unknown } | undefined)?.stats;
      return { tape: { written: tape.written, dropped: tape.dropped }, feed: feed?.stats, chain: chain?.stats, jev: of("reflex.trigger"), desk: of("desk"), scorekeeper: of("scorekeeper") };
    },
  };
  return rt;
}
