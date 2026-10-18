// The Tape: append-only typed events (docs/03). Writer batches inserts; consumers resume from offsets.
import crypto from "node:crypto";
import { SCHEMA_VERSION, TOPICS, type BodyOf, type Envelope, type Source, type Topic } from "@asimog/contracts";
import type { Clock } from "../lib/clock.ts";
import type { Sql } from "../lib/db.ts";
import type { Tx } from "./consumer.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";

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
  dropped = 0;

  constructor(
    readonly sql: Sql,
    readonly clock: Clock,
  ) {}

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
    const e = this.envelope(topic, body, o);
    this.buf.push({ env: e, dedupe: o.dedupe });
    if (this.buf.length >= 500) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.batchMs);
    return e;
  }

  /**
   * Write inside a consumer's transaction, so a decision and the consumer offset commit together.
   * seen_time is at least 1 ms after the event that caused it, so it sorts after its cause on the Tape.
   */
  async emitIn<T extends Topic>(tx: Tx, topic: T, body: BodyOf<T>, o: EmitOpts & { after: string }): Promise<Envelope<BodyOf<T>>> {
    // replay: exactly 1 ms after the cause (the shared replay clock may already sit at the window end)
    const after = Date.parse(o.after) + 1;
    const now = new Date(this.clock.mode === "replay" ? after : Math.max(this.clock.now(), after)).toISOString();
    const e = this.envelope(topic, body, o, now);
    await tx`insert into tape.events ${tx({ ...e, body: tx.json(e.body as never) } as never, "id", "topic", "v", "event_time", "seen_time", "source", "subject", "causes", "mode", "body")}`;
    await tx`select pg_notify('tape', ${e.seen_time})`;
    this.written++;
    return e;
  }

  /** see every flushed batch in-process (used by the relay bridge and the replay driver) */
  onFlush(fn: (e: Envelope[]) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.chain = this.chain.then(async () => {
      if (this.buf.length === 0) return;
      const batch = this.buf.splice(0, this.buf.length);
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.write(batch);
        } catch (err) {
          if (attempt >= 3) {
            this.dropped += batch.length;
            return log.error("tape write failed", { events: batch.length, err: String(err) });
          }
          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
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
      this.dropped += batch.length - rows.length;
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
    if (out.length) for (const fn of this.listeners) fn(out);
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
