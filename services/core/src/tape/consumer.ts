// Consumers read the Tape in (seen_time, id) order from their own offset. The handler and the offset
// update share one transaction, so a crash never applies a batch twice (docs/SYSTEM.md).
import type { Envelope } from "@asimog/contracts";
import type postgres from "postgres";
import type { Clock } from "../lib/clock.ts";
import type { Sql } from "../lib/db.ts";
import { log } from "../lib/log.ts";

export type Tx = postgres.TransactionSql<Record<string, unknown>>;

export interface Consumer {
  name: string;
  topics: string[];
  batch?: number;
  /** live only: a decider with no offset starts at the Tape head instead of deciding on old history */
  startAtHead?: boolean;
  /** reads the Tape and writes only mem.* or board.signals: `ctl rebuild` clears its output and re-runs it */
  projection?: true;
  /** runs in its own live loop, so a slow consumer (the Trader waiting on a confirm) never delays it or is delayed */
  ownLoop?: true;
  /** called once the batch's transaction has committed: side effects outside the database go here */
  afterCommit?(): void;
  handle(events: Envelope[], tx: Tx): Promise<void>;
}

export type Row = Envelope & { seen_time: Date | string; event_time: Date | string };

export function normalize(r: Row): Envelope {
  const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
  return { ...r, seen_time: iso(r.seen_time), event_time: iso(r.event_time) };
}

/** Process at most one batch. Returns how many events were handled. */
export async function step(sql: Sql, c: Consumer, untilIso?: string): Promise<number> {
  const n = await sql.begin(async (tx) => {
    const [off] = await tx`
      insert into tape.consumer_offsets (consumer) values (${c.name})
      on conflict (consumer) do update set consumer = excluded.consumer
      returning last_seen_time, last_id`;
    const rows = (await tx`
      select id, topic, v, event_time, seen_time, source, subject, causes, mode, body
      from tape.events
      where (seen_time, id) > (${off!.last_seen_time as Date}, ${off!.last_id as string})
        and topic = any(${c.topics})
        ${untilIso ? tx`and seen_time <= ${untilIso}` : tx``}
      order by seen_time, id
      limit ${c.batch ?? 500}`) as unknown as Row[];
    if (!rows.length) return 0;
    const events = rows.map(normalize);
    await apply(tx, c, events);
    return events.length;
  });
  if (n) c.afterCommit?.();
  return n;
}

/** Hand events to a consumer and move its offset past them, inside the caller's transaction. */
export async function apply(tx: Tx, c: Consumer, events: Envelope[]) {
  await c.handle(events, tx);
  const last = events[events.length - 1]!;
  await tx`insert into tape.consumer_offsets (consumer, last_seen_time, last_id) values (${c.name}, ${last.seen_time}, ${last.id})
    on conflict (consumer) do update set last_seen_time = excluded.last_seen_time, last_id = excluded.last_id, updated_at = now()`;
}

/** Drain a consumer to the head (or to untilIso). Used by replay and by live loops. */
export async function drain(sql: Sql, c: Consumer, untilIso?: string) {
  let total = 0;
  for (;;) {
    const n = await step(sql, c, untilIso);
    total += n;
    if (n < (c.batch ?? 500)) return total; // a short batch reached the end
  }
}

/** Live loop: wake on NOTIFY, also poll every pollMs as a safety net. */
export async function runLive(sql: Sql, consumers: Consumer[], _clock: Clock, pollMs = 1000) {
  for (const c of consumers.filter((x) => x.startAtHead))
    await sql`insert into tape.consumer_offsets (consumer, last_seen_time, last_id)
      select ${c.name}, seen_time, id from tape.events order by seen_time desc, id desc limit 1
      on conflict (consumer) do nothing`;
  const loops = [consumers.filter((c) => !c.ownLoop), ...consumers.filter((c) => c.ownLoop).map((c) => [c])];
  // a NOTIFY that lands while a group drains marks it pending, so the group drains again instead of sleeping a poll
  const groups = loops.map((consumers) => ({ consumers, pending: false, wake: null as (() => void) | null }));
  await sql.listen("tape", () => {
    for (const g of groups) {
      if (g.wake) g.wake();
      else g.pending = true;
    }
  });
  await Promise.all(groups.map(async (g) => {
    for (;;) {
      g.pending = false;
      for (const c of g.consumers) {
        try {
          await drain(sql, c);
        } catch (err) {
          log.error("consumer", { consumer: c.name, err: String(err) });
        }
      }
      if (g.pending) continue;
      await new Promise<void>((r) => {
        const t = setTimeout(() => g.wake?.(), pollMs);
        g.wake = () => {
          clearTimeout(t);
          g.wake = null;
          r();
        };
      });
    }
  }));
}
