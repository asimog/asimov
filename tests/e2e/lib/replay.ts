// Replay driver (docs/14): a recorded tape through the full runtime, in a fresh database, on the replay Clock.
// Inputs (what the world told us, including recorded Jev answers) are loaded; everything else is re-derived.
// The network is cut: any fetch during a replay is counted and fails the run.
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import { replayClock } from "../../../services/core/src/lib/clock.ts";
import { connect, migrate, type Sql } from "../../../services/core/src/lib/db.ts";
import { env } from "../../../services/core/src/lib/env.ts";
import { buildConsumers } from "../../../services/core/src/runtime.ts";
import { drain } from "../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../services/core/src/tape/tape.ts";

/** Topics produced by our own deciders. A replay re-derives them, so recorded copies are skipped. */
export const DERIVED = ["intent.", "order.", "markout.", "commit.", "position.", "strategy.", "kernel.", "outcome.", "score.", "thesis.", "post.queued"];
export const isDerived = (topic: string) => DERIVED.some((p) => topic.startsWith(p));

export type Row = { id: string; topic: string; v: number; event_time: string; seen_time: string; source: string; subject: string | null; causes: string[]; mode: string; body: unknown };

export async function readTape(file: string): Promise<Row[]> {
  const rows: Row[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) if (line.trim()) rows.push(JSON.parse(line) as Row);
  return rows;
}

export type ReplayResult = { sql: Sql; db: string; inputs: number; windows: number; ms: number; netCalls: string[]; first: string; last: string; consumers: Record<string, unknown> };

/**
 * `extra`: input events to add to the tape (for example a recorded gap).
 * `restartAt`: 0..1 of the tape; there every consumer is rebuilt from scratch, as after a crash, and resumes from its offset.
 */
export async function replay(tapeFile: string, opts: { tag: string; seed?: number; stepMs?: number; extra?: Row[]; restartAt?: number }): Promise<ReplayResult> {
  const t0 = performance.now();
  const rows = [...(await readTape(tapeFile)), ...(opts.extra ?? [])].filter((r) => !isDerived(r.topic)).sort((a, b) => (a.seen_time < b.seen_time ? -1 : a.seen_time > b.seen_time ? 1 : a.id < b.id ? -1 : 1));
  if (!rows.length) throw new Error(`empty tape ${tapeFile}`);

  // fresh database per run; never touches the working database
  const base = env.str("DATABASE_URL");
  const db = `asimog_e2e_${opts.tag}_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/g, "_");
  const admin = connect(base, 1);
  await admin.unsafe(`create database ${db}`);
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
  let consumers = buildConsumers(tape);
  const step = opts.stepMs ?? 1000;
  const restartMs = opts.restartAt == null ? null : Date.parse(first) + opts.restartAt * (Date.parse(last) - Date.parse(first));
  let windows = 0;
  try {
    for (let t = Date.parse(first); t <= Date.parse(last) + step; t += step) {
      if (restartMs != null && t >= restartMs && t - step < restartMs) consumers = buildConsumers(tape);
      const until = new Date(t).toISOString();
      for (const c of consumers) await drain(sql, c, until);
      windows++;
    }
    await tape.flush();
  } finally {
    globalThis.fetch = realFetch;
  }
  const consumerStats = Object.fromEntries(consumers.map((c) => [c.name, (c as { stats?: unknown }).stats ?? null]));
  return { sql, db, inputs: rows.length, windows, ms: Math.round(performance.now() - t0), netCalls, first, last, consumers: consumerStats };
}
