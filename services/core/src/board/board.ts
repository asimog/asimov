// The Board (docs/SYSTEM.md): latest live signal per (kind, subject). Signals are written inside the producing
// consumer's transaction, so a replay writes exactly the same signals. A signal past valid_until is absent.
import type { Clock } from "../lib/clock.ts";
import type { Sql } from "../lib/db.ts";
import type { Tx } from "../tape/consumer.ts";

export interface SignalIn {
  kind: string;
  subject: string;
  value: unknown;
  confidence: number;
  validMs: number;
  inputs: string[];
  analyzer: string;
  /** signal time; defaults to the clock (in replay: the event's seen_time) */
  at?: string;
}

export type SignalRow = { id: string; kind: string; subject: string; value: unknown; confidence: number; produced_at: Date; valid_until: Date; analyzer: string };

export async function putSignal(tx: Tx, clock: Clock, s: SignalIn): Promise<string> {
  const at = s.at ?? clock.iso();
  const id = clock.id("signal");
  await tx`
    insert into board.signals (id, kind, subject, value, confidence, produced_at, valid_until, inputs, analyzer)
    values (${id}, ${s.kind}, ${s.subject}, ${tx.json(s.value as never)}, ${Math.max(0, Math.min(1, s.confidence))},
            ${at}, ${new Date(Date.parse(at) + s.validMs).toISOString()}, ${s.inputs}, ${s.analyzer})`;
  return id;
}

/** Live signals for a subject at time `at` (the Clock's now in replay). */
export async function liveFor(sql: Sql | Tx, subject: string, at: string): Promise<Record<string, SignalRow>> {
  const rows = (await sql`
    select distinct on (kind) id, kind, subject, value, confidence, produced_at, valid_until, analyzer
    from board.signals
    where subject = ${subject} and produced_at <= ${at} and valid_until > ${at}
    order by kind, produced_at desc, id desc`) as unknown as SignalRow[]; // id breaks ties, so a replay picks the same signal
  return Object.fromEntries(rows.map((r) => [r.kind, r]));
}

/** The whole Board at time `at`: the latest signal per (kind, subject) live at `at` (docs/SYSTEM.md time travel, Rewind). */
/** Rows that stopped being valid more than `hours` ago leave the Board (docs/OPS.md section 2); a rebuild from the Tape restores them. */
export async function pruneBoard(sql: Sql, now: string, hours: number) {
  return (await sql`delete from board.signals where valid_until < ${now}::timestamptz - make_interval(hours => ${hours}) returning 1`).length;
}

export async function boardAt(sql: Sql | Tx, at: string): Promise<SignalRow[]> {
  return (await sql`
    select distinct on (kind, subject) id, kind, subject, value, confidence, produced_at, valid_until, analyzer
    from board.signals
    where produced_at <= ${at} and valid_until > ${at}
    order by kind, subject, produced_at desc, id desc`) as unknown as SignalRow[];
}
