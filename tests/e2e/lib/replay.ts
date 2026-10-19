// Replay driver (docs/OPS.md): a recorded tape through the full runtime, in a fresh database, on the replay Clock.
// Inputs (what the world told us, including recorded Jev answers) are loaded; everything else is re-derived.
// The network is cut: any fetch during a replay is counted and fails the run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { replayClock } from "../../../services/core/src/lib/clock.ts";
import { connect, migrate, type Sql } from "../../../services/core/src/lib/db.ts";
import { env } from "../../../services/core/src/lib/env.ts";
import { seedSpecs } from "../../../services/core/src/mind/seeds.ts";
import { buildConsumers } from "../../../services/core/src/runtime.ts";
import { apply, type Consumer, normalize, type Row as TapeRow } from "../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../services/core/src/tape/tape.ts";
import { recordDeposit } from "../../../services/core/src/treasury/books.ts";
import { newKeys } from "./txs.ts";
import { liveLeg, SOL } from "./world.ts";

/** Topics produced by our own deciders. A replay re-derives them, so recorded copies are skipped. */
export const DERIVED = ["precall.detected", "coin.graduated", "intent.", "order.", "markout.", "commit.", "position.", "strategy.", "kernel.", "outcome.", "score.", "thesis.", "post.queued"];
export const isDerived = (topic: string) => DERIVED.some((p) => topic.startsWith(p));

export type Row = { id: string; topic: string; v: number; event_time: string; seen_time: string; source: string; subject: string | null; causes: string[]; mode: string; body: unknown };

export async function readTape(file: string): Promise<Row[]> {
  const rows: Row[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) if (line.trim()) rows.push(JSON.parse(line) as Row);
  return rows;
}

export type ReplayResult = { sql: Sql; db: string; inputs: number; steps: number; ms: number; netCalls: string[]; first: string; last: string; consumers: Record<string, unknown> };

/**
 * Consumers in stages: memory (the inputs' own projection), then the other projections, then the deciders.
 * Projections read only the Tape and memory, and every decision lands 1 ms after its cause, so inside a stage the order
 * does not change what is derived. `reverse` flips the order inside each stage to prove it.
 */
function staged(consumers: Consumer[], reverse = false): Consumer[] {
  const rank = (c: Consumer) => (c.name === "memory" ? 0 : c.projection ? 1 : 2);
  return [0, 1, 2].flatMap((r) => {
    const s = consumers.filter((c) => rank(c) === r);
    return reverse ? s.reverse() : s;
  });
}

/**
 * Lockstep: every consumer reaches each Tape time T before any consumer goes past it. A decision at T is stamped T + 1 ms,
 * so no consumer has already passed it, whatever the order (docs/OPS.md replays).
 * `extra`: input events to add to the tape (for example a recorded gap).
 * `restartAt`: 0..1 of the tape; there every consumer is rebuilt from scratch, as after a crash, and resumes from its offset.
 * `liveLeg`: the seed strategies also trade live, through the real gate, Trader, books and kill on the mock chain (fix plan 1.17).
 */
export async function replay(tapeFile: string, opts: { tag: string; seed?: number; extra?: Row[]; restartAt?: number; reverse?: boolean; liveLeg?: boolean }): Promise<ReplayResult> {
  if (opts.liveLeg && opts.restartAt != null) throw new Error("replay: a live leg keeps its chain in memory, so it cannot restart mid-tape");
  const t0 = performance.now();
  const rows = [...(await readTape(tapeFile)), ...(opts.extra ?? [])].filter((r) => !isDerived(r.topic)).sort((a, b) => (a.seen_time < b.seen_time ? -1 : a.seen_time > b.seen_time ? 1 : a.id < b.id ? -1 : 1));
  if (!rows.length) throw new Error(`empty tape ${tapeFile}`);

  // fresh database per run; never touches the working database
  const base = env.str("DATABASE_URL");
  const db = `asimog_e2e_${opts.tag}_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/g, "_");
  const admin = connect(base, 1);
  await admin.unsafe(`create database ${db}`);
  await admin.unsafe(`alter database ${db} set synchronous_commit = off`); // disposable: no commit waits on the disk
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${db}`;
  const sql = connect(url.toString(), 4);
  await migrate(sql);

  // load inputs in chunks
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000).map((r) => ({ ...r, mode: "replay", body: sql.json(r.body as never) }));
    await sql`insert into tape.events ${sql(chunk as never, "id", "topic", "v", "event_time", "seen_time", "source", "subject", "causes", "mode", "body")} on conflict do nothing`;
  }

  // cut the network: replays read recorded answers only
  const netCalls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    netCalls.push(String(input instanceof Request ? input.url : input).replace(/api-key=[^&]+/g, "api-key=***"));
    throw new Error("network is cut during replay");
  }) as typeof fetch;

  const first = rows[0]!.seen_time;
  const last = rows[rows.length - 1]!.seen_time;
  const clock = replayClock(Date.parse(first), opts.seed ?? 42);
  const tape = new Tape(sql, clock);
  const leg = opts.liveLeg
    ? liveLeg(sql, tape, { keys: newKeys(opts.seed ?? 42), dir: fs.mkdtempSync(path.join(os.tmpdir(), `leg-${opts.tag}-`)), strategies: () => new Set(seedSpecs().map((s) => s.id)) })
    : null;
  if (leg) {
    leg.chain.set(leg.wallets.trade, 10 * SOL);
    await recordDeposit(tape, leg.wallets.trade, 10 * SOL, "replay-start");
    await tape.flush();
  }
  const build = () => staged([...buildConsumers(tape), ...(leg?.consumers ?? [])], opts.reverse);
  let consumers = build();
  const topics = [...new Set(consumers.flatMap((c) => c.topics))];
  const endMs = Date.parse(last) + 1000; // decisions caused by the last inputs still land
  const restartMs = opts.restartAt == null ? null : Date.parse(first) + opts.restartAt * (Date.parse(last) - Date.parse(first));
  let restarted = false;
  let steps = 0;
  try {
    // one read and one transaction per Tape time: every consumer gets exactly the events at T it subscribes to
    for (let prev = new Date(0);;) {
      const rows = (await sql`select id, topic, v, event_time, seen_time, source, subject, causes, mode, body from tape.events
        where seen_time = (select min(seen_time) from tape.events where seen_time > ${prev} and topic = any(${topics})) and topic = any(${topics}) order by id`) as unknown as TapeRow[];
      if (!rows.length || new Date(rows[0]!.seen_time).getTime() > endMs) break;
      prev = new Date(rows[0]!.seen_time);
      if (restartMs != null && !restarted && prev.getTime() >= restartMs) {
        consumers = build();
        restarted = true;
      }
      const events = rows.map(normalize);
      if (leg) for (const e of events) if (e.topic.startsWith("trade.") && (e.body as { price_sol?: number }).price_sol) leg.chain.prices.set(e.subject!, (e.body as { price_sol: number }).price_sol);
      const ran: Consumer[] = [];
      await sql.begin(async (tx) => {
        for (const c of consumers) {
          const mine = events.filter((e) => c.topics.includes(e.topic));
          for (let i = 0; i < mine.length; i += c.batch ?? 500) await apply(tx, c, mine.slice(i, i + (c.batch ?? 500)));
          if (mine.length) ran.push(c);
        }
      });
      for (const c of ran) c.afterCommit?.();
      await leg?.trader.retry(); // confirms what the mock chain landed, as the live loop does
      steps++;
    }
    await tape.flush();
  } finally {
    globalThis.fetch = realFetch;
  }
  const consumerStats = Object.fromEntries(consumers.map((c) => [c.name, (c as { stats?: unknown }).stats ?? null]));
  return { sql, db, inputs: rows.length, steps, ms: Math.round(performance.now() - t0), netCalls, first, last, consumers: consumerStats };
}
