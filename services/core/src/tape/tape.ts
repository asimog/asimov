// The Tape: append-only typed events (docs/SYSTEM.md). Writer batches inserts; consumers resume from offsets.
//
// Two ways to write, two dedupe rules:
// - `emit` (buffered): an accepted event stays queued until its batch commits. A failed batch goes back to the front of the queue and is
//   retried with backoff, so nothing is dropped; while it cannot be written `unhealthy` is true (stats) and one `ops.alert` is queued.
//   With `dedupe`, a repeat key is skipped and counted in `deduped`; a retried batch cannot write twice (event ids and dedupe keys are
//   inside the same transaction, so a rolled-back attempt leaves neither).
// - `emitIn` (inside a consumer transaction): it commits or rolls back with the consumer's offset. With `dedupe`, a repeat returns the
//   envelope it would have written and writes nothing.
// A listener (`onFlush`) runs after commit; its error is logged and never re-runs or fails the write.
import crypto from "node:crypto";
import { type BodyOf, type Envelope, SCHEMA_VERSION, type Source, TOPICS, type Topic } from "@asimog/contracts";
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

export class Tape {
  private buf: Pending[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** flushes run one after another; concurrent writers deadlocked on tape.dedupe */
  private chain: Promise<void> = Promise.resolve();
  private readonly batchMs = env.int("TAPE_BATCH_MS");
  private readonly listeners = new Set<(e: Envelope[]) => void>();
  written = 0;
  /** repeats skipped because their dedupe key was already used (not losses) */
  deduped = 0;
  /** true while a batch cannot be written; the queue keeps every accepted event */
  unhealthy = false;
  private failures = 0;

  constructor(
    readonly sql: Sql,
    readonly clock: Clock,
    private readonly root?: Tape,
  ) {}

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
      id: this.clock.id("event"),
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
    this.buf.push({ env: e, dedupe: o.dedupe });
    if (this.buf.length >= 500) void this.flush();
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
    if (o.dedupe && !(await tx`insert into tape.dedupe (key, event_id) values (${o.dedupe}, ${e.id}) on conflict do nothing returning 1`).length) return e;
    await tx`insert into tape.events ${tx({ ...e, body: tx.json(e.body as never) } as never, "id", "topic", "v", "event_time", "seen_time", "source", "subject", "causes", "mode", "body")}`;
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
      try {
        await this.write(batch);
        this.failures = 0;
        this.unhealthy = false;
      } catch (err) {
        this.buf.unshift(...batch);
        this.failures++;
        log.error("tape write failed, will retry", { queued: this.buf.length, failures: this.failures, err: String(err) });
        this.timer = setTimeout(() => void this.flush(), Math.min(200 * 2 ** this.failures, 5000));
        if (!this.unhealthy) {
          this.unhealthy = true;
          this.buf.push({ env: this.envelope("ops.alert", { severity: "page", text: "The Tape cannot write; accepted events are queued in memory", finding: "tape.unhealthy" }, { source: "system", subject: "tape.unhealthy" }) });
        }
      }
    });
    return this.chain;
  }

  private async write(batch: Pending[]) {
    const keyed = batch.filter((p) => p.dedupe).sort((a, b) => (a.dedupe! < b.dedupe! ? -1 : 1));
    let allowed = new Set(batch.filter((p) => !p.dedupe).map((p) => p.env.id));
    await this.sql.begin(async (tx) => {
      if (keyed.length) {
        const rows = await tx`
          insert into tape.dedupe (key, event_id)
          select * from unnest(${keyed.map((k) => k.dedupe!)}::text[], ${keyed.map((k) => k.env.id)}::text[])
          on conflict do nothing returning event_id`;
        for (const r of rows) allowed.add(r.event_id as string);
      }
      const rows = batch.filter((p) => allowed.has(p.env.id)).map((p) => p.env);
      this.deduped += batch.length - rows.length;
      if (!rows.length) return;
      await tx`insert into tape.events ${tx(
        rows.map((e) => ({ ...e, body: tx.json(e.body as never) })) as never,
        "id", "topic", "v", "event_time", "seen_time", "source", "subject", "causes", "mode", "body",
      )} on conflict do nothing`;
      await tx`select pg_notify('tape', ${rows[rows.length - 1]!.seen_time})`;
      this.written += rows.length;
      allowed = new Set(rows.map((r) => r.id));
    });
    const out = batch.filter((p) => allowed.has(p.env.id)).map((p) => p.env);
    if (out.length)
      for (const fn of this.listeners) {
        try {
          fn(out);
        } catch (err) {
          log.error("tape listener failed", { err: String(err) });
        }
      }
  }

  async close() {
    await this.flush();
  }
}

export async function putBlob(sql: Sql, kind: string, url: string, body: Buffer | string) {
  const buf = typeof body === "string" ? Buffer.from(body) : body;
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  await sql`insert into tape.blobs (sha256, bytes, kind, url, body) values (${sha256}, ${buf.length}, ${kind}, ${url}, ${buf})
            on conflict do nothing`;
  return { sha256, bytes: buf.length };
}
