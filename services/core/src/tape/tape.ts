// The Tape: append-only typed events (docs/SYSTEM.md). Writer batches inserts; consumers resume from offsets.
//
// Two ways to write, two dedupe rules:
// - `emit` (buffered): an accepted event stays queued until its batch commits. A failed batch goes back to the front of the queue and is
//   retried with backoff, so nothing accepted is dropped; past TAPE_MAX_QUEUED a new event is refused and counted in `dropped`. While it cannot be written `unhealthy` is true (stats) and one `ops.alert` is queued.
//   With `dedupe`, a repeat key is skipped and counted in `deduped`; a retried batch cannot write twice (event ids and dedupe keys are
//   inside the same transaction, so a rolled-back attempt leaves neither).
// - `emitIn` (inside a consumer transaction): it commits or rolls back with the consumer's offset. With `dedupe`, a repeat returns the
//   envelope it would have written and writes nothing.
// A dedupe event's id is derived from its key, so the id a repeat returns is the id on the Tape.
// Read order (docs/SYSTEM.md): a row is stamped before it commits, so a later-stamped row can commit first. Every write still open in
// this process holds the low watermark; live consumers read only below it (`lowWater`), so a late commit is never skipped.
// A listener (`onFlush`) runs after commit; its error is logged and never re-runs or fails the write.
import crypto from "node:crypto";
import { type BodyOf, type Envelope, SCHEMA_VERSION, type Source, TAPE_CLASSES, TOPIC_CLASS, TOPICS, type Topic } from "@asimog/contracts";
import type { Clock } from "../lib/clock.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { Tx } from "./consumer.ts";

export interface EmitOpts {
  source: Source;
  subject?: string | null;
  causes?: string[];
  eventTime?: string;
  /** idempotency key: a second emit with the same key is dropped */
  dedupe?: string;
}

type Pending = { env: Envelope; dedupe?: string };

/** seen_time (ms) of every emitIn transaction still open in this process, with the root Tape (one writer, one Clock) it writes for */
const open = new Map<object, { ms: number; since: number; root: Tape }>();
const OPEN_MAX_MS = 120_000;

function hold(key: object, ms: number, root: Tape) {
  const o = open.get(key);
  if (!o || ms < o.ms) open.set(key, { ms, since: o?.since ?? Date.now(), root });
}

const tracked = new WeakSet<object>();

/** A live consumer transaction (consumer.ts step, the Trader's retry): its emitIn writes hold the low watermark until release(). */
export function track(tx: object) {
  tracked.add(tx);
}

/** The tracked transaction has committed or rolled back. */
export function release(tx: object) {
  tracked.delete(tx);
  open.delete(tx);
}

function lowWaterOf(root: Tape): string | null {
  let low = root.oldestQueued();
  for (const [k, o] of open) {
    if (o.root !== root) continue;
    if (Date.now() - o.since > OPEN_MAX_MS) { // a transaction that never released must not stop every reader
      log.error("tape write open too long; readers pass it", { seen_ms: o.ms });
      open.delete(k);
    } else low = Math.min(low, o.ms);
  }
  return Number.isFinite(low) ? new Date(low - 1).toISOString() : null;
}

export class Tape {
  private buf: Pending[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** flushes run one after another; concurrent writers deadlocked on tape.dedupe */
  private chain: Promise<void> = Promise.resolve();
  private readonly batchMs = env.int("TAPE_BATCH_MS");
  private readonly listeners = new Set<(e: Envelope[]) => void>();
  private ensured = new Set<string>(); // hour partition names this process already created
  written = 0;
  /** repeats skipped because their dedupe key was already used (not losses) */
  deduped = 0;
  /** true while a batch cannot be written; the queue keeps every accepted event */
  unhealthy = false;
  private failures = 0;
  /** events refused because the queue was full (TAPE_MAX_QUEUED); each is counted and alerted, never silent */
  dropped = 0;
  private readonly maxQueued = env.int("TAPE_MAX_QUEUED");
  private inflight: number | null = null;
  private inflightN = 0;

  constructor(
    readonly sql: Sql,
    readonly clock: Clock,
    private readonly root?: Tape,
  ) {}

  /** The newest seen_time a live reader may read: just below the oldest write of this Tape still open, or null when none is open. */
  lowWater(): string | null {
    return lowWaterOf(this.root ?? this);
  }

  /** seen_time (ms) of the oldest accepted event not yet committed */
  oldestQueued(): number {
    const q = this.buf[0] ? Date.parse(this.buf[0].env.seen_time) : Number.POSITIVE_INFINITY;
    return Math.min(q, this.inflight ?? Number.POSITIVE_INFINITY);
  }

  /** A consumer's own view: its decisions take ids from its own clock stream; buffered writes and counts stay on the root. */
  for(clock: Clock): Tape {
    return new Tape(this.sql, clock, this.root ?? this);
  }

  private envelope<T extends Topic>(topic: T, body: BodyOf<T>, o: EmitOpts, now = this.clock.iso()): Envelope<BodyOf<T>> {
    const parsed = TOPICS[topic].safeParse(body);
    if (!parsed.success) {
      log.warn("schema", { topic, issues: parsed.error.issues.slice(0, 3) });
      throw new Error(`invalid body for ${topic}`);
    }
    return {
      id: o.dedupe ? `${this.clock.id("event").split("_")[0]}_${crypto.createHash("sha256").update(o.dedupe).digest("hex").slice(0, 26)}` : this.clock.id("event"),
      topic,
      v: SCHEMA_VERSION[topic],
      event_time: o.eventTime ?? now,
      seen_time: now,
      source: o.source,
      subject: o.subject ?? null,
      causes: o.causes ?? [],
      mode: this.clock.mode,
      body: parsed.data as BodyOf<T>,
    };
  }

  emit<T extends Topic>(topic: T, body: BodyOf<T>, o: EmitOpts): Envelope<BodyOf<T>> {
    if (this.root) return this.root.emit(topic, body, o);
    const e = this.envelope(topic, body, o);
    if (this.buf.length + this.inflightN >= this.maxQueued) {
      if (this.dropped++ % 1000 === 0) log.error("tape queue full; events refused", { topic, queued: this.buf.length, dropped: this.dropped });
      return e;
    }
    this.buf.push({ env: e, dedupe: o.dedupe });
    if (this.buf.length === 500) void this.flush(); // once per 500: past it the pending flush takes the whole queue
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.batchMs);
    return e;
  }

  /**
   * Write inside a consumer's transaction, so a decision and the consumer offset commit together.
   * seen_time is at least 1 ms after the event that caused it, so it sorts after its cause on the Tape.
   * With `dedupe`, a repeat (a rebuilt projection re-running) is not written.
   */
  async emitIn<T extends Topic>(tx: Tx, topic: T, body: BodyOf<T>, o: EmitOpts & { after: string }): Promise<Envelope<BodyOf<T>>> {
    // replay: exactly 1 ms after the cause, which every consumer reaches together (tests/e2e/lib/replay.ts)
    const after = Date.parse(o.after) + 1;
    const now = new Date(this.clock.mode === "replay" ? after : Math.max(this.clock.now(), after)).toISOString();
    const e = this.envelope(topic, body, o, now);
    if (tracked.has(tx)) hold(tx, Date.parse(now), this.root ?? this);
    // a decision's hour partition exists before its row, or the row lands in the default partition and that hour can never be made
    // made inside the transaction and not remembered, since a rollback undoes it; the next flush remembers it
    if (!(this.root ?? this).ensured.has(hourPartition(Date.parse(now)))) await ensureHourPartition(tx, Date.parse(now));
    if (o.dedupe && !(await tx`insert into tape.dedupe (key, event_id) values (${o.dedupe}, ${e.id}) on conflict do nothing returning 1`).length) return e;
    await tx`insert into tape.events ${tx({ ...e, class: TOPIC_CLASS[e.topic as Topic], body: tx.json(e.body as never) } as never, "id", "topic", "v", "class", "event_time", "seen_time", "source", "subject", "causes", "mode", "body")}`;
    await tx`select pg_notify('tape', ${e.seen_time})`;
    (this.root ?? this).written++;
    return e;
  }

  /** see every flushed batch in-process (used by the relay bridge and the replay driver) */
  onFlush(fn: (e: Envelope[]) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** events accepted and not yet committed */
  get queued(): number {
    return this.buf.length;
  }

  /** One attempt per call. A failed batch is put back in front and retried by a timer, so this never rejects and never loses events. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.chain = this.chain.then(async () => {
      if (this.buf.length === 0) return;
      const batch = this.buf.splice(0, this.buf.length);
      this.inflightN = batch.length;
      this.inflight = batch.reduce((m, p) => Math.min(m, Date.parse(p.env.seen_time)), Number.POSITIVE_INFINITY);
      try {
        await this.ensurePartitions(batch.map((p) => p.env.seen_time));
        await this.write(batch);
        this.failures = 0;
        this.unhealthy = false;
      } catch (err) {
        this.buf = batch.concat(this.buf); // not unshift(...batch): a long outage queue overflows the call stack
        this.failures++;
        log.error("tape write failed, will retry", { queued: this.buf.length, failures: this.failures, err: String(err) });
        this.timer = setTimeout(() => void this.flush(), Math.min(200 * 2 ** this.failures, 5000));
        if (!this.unhealthy) {
          this.unhealthy = true;
          this.buf.push({ env: this.envelope("ops.alert", { severity: "page", text: "The Tape cannot write; accepted events are queued in memory", finding: "tape.unhealthy" }, { source: "system", subject: "tape.unhealthy" }) });
        }
      } finally {
        this.inflight = null;
        this.inflightN = 0;
      }
    });
    return this.chain;
  }

  private async write(batch: Pending[]) {
    const keyed = batch.filter((p) => p.dedupe).sort((a, b) => (a.dedupe! < b.dedupe! ? -1 : 1));
    const allowed = new Set(batch.filter((p) => !p.dedupe).map((p) => p.env.id));
    let out: Envelope[] = [];
    await this.sql.begin(async (tx) => {
      if (keyed.length) {
        const rows = await tx`
          insert into tape.dedupe (key, event_id)
          select * from unnest(${keyed.map((k) => k.dedupe!)}::text[], ${keyed.map((k) => k.env.id)}::text[])
          on conflict do nothing returning event_id`;
        for (const r of rows) allowed.add(r.event_id as string);
      }
      // a repeat in the same batch has the same id (it comes from the key): only its first copy is written
      const taken = new Set<string>();
      const rows = batch.filter((p) => allowed.has(p.env.id) && !taken.has(p.env.id) && taken.add(p.env.id)).map((p) => p.env);
      out = rows;
      if (!rows.length) return;
      await tx`insert into tape.events ${tx(
        rows.map((e) => ({ ...e, class: TOPIC_CLASS[e.topic as Topic], body: tx.json(e.body as never) })) as never,
        "id", "topic", "v", "class", "event_time", "seen_time", "source", "subject", "causes", "mode", "body",
      )} on conflict do nothing`;
      await tx`select pg_notify('tape', ${rows[rows.length - 1]!.seen_time})`;
    });
    // counted once the batch commits: a rolled-back attempt counts nothing
    this.written += out.length;
    this.deduped += batch.length - out.length;
    if (out.length)
      for (const fn of this.listeners) {
        try {
          fn(out);
        } catch (err) {
          log.error("tape listener failed", { err: String(err) });
        }
      }
  }

  /**
   * Hour partitions, then a list partition per class (docs/tasks/B6-partitions.md). The hour of the event and the
   * two hours ahead of the Clock exist for every event in a batch, so a live write never lands in the default partition.
   */
  async ensurePartitions(seenIsos: string[] = []) {
    const hour = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000;
    // every hour in the batch: a batch that crosses an hour must not put rows in the default partition
    for (const h of new Set(seenIsos.map((s) => hour(Date.parse(s))))) await ensureHourPartition(this.sql, h, this.ensured);
    const now = hour(this.clock.now());
    for (let h = now; h <= now + 2 * 3_600_000; h += 3_600_000) await ensureHourPartition(this.sql, h, this.ensured);
  }

  async close() {
    await this.flush();
  }
}

const hourPartition = (ms: number) => `tape.events_p_${new Date(ms).toISOString().slice(0, 13).replace(/[-T]/g, "")}`;

/** Create one hour partition and its class list partitions. Idempotent; the name is built from the hour only. */
export async function ensureHourPartition(sql: Sql | Tx, ms: number, seen = new Set<string>()) {
  const h = Math.floor(ms / 3_600_000) * 3_600_000;
  const name = hourPartition(h);
  if (seen.has(name)) return name;
  const from = new Date(h).toISOString();
  const to = new Date(h + 3_600_000).toISOString();
  await sql.unsafe(`create table if not exists ${name} partition of tape.events for values from ('${from}') to ('${to}') partition by list (class)`);
  for (const c of TAPE_CLASSES) await sql.unsafe(`create table if not exists ${name}_${c} partition of ${name} for values in ('${c}')`);
  seen.add(name);
  return name;
}

export async function putBlob(sql: Sql, kind: string, url: string, body: Buffer | string) {
  const buf = typeof body === "string" ? Buffer.from(body) : body;
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  await sql`insert into tape.blobs (sha256, bytes, kind, url, body) values (${sha256}, ${buf.length}, ${kind}, ${url}, ${buf})
            on conflict do nothing`;
  return { sha256, bytes: buf.length };
}
