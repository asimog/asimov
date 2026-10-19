// slow.jobs (docs/SLOW-MIND.md section 5): a job runs once, is idempotent by (engine, kind, subject, slot), and records cost and errors.
// A grant with no room waits as `deferred` (the reason in `error`) until a later schedule tick promotes it or it expires.
import type { Engine, Job, Kind } from "./types.ts";

type Sql = import("postgres").Sql<Record<string, unknown>>;

export async function enqueue(sql: Sql, j: { engine: Engine; kind: Kind; subject: string; preset: string; slot: string; id: string; stage: number | null; usd_cap: number; deferred?: string }): Promise<boolean> {
  const r = await sql`insert into slow.jobs (id, engine, kind, subject, preset, slot, stage, usd_cap, state, error)
    values (${j.id}, ${j.engine}, ${j.kind}, ${j.subject}, ${j.preset}, ${j.slot}, ${j.stage}, ${j.usd_cap}, ${j.deferred ? "deferred" : "queued"}, ${j.deferred ?? null})
    on conflict (engine, kind, subject, slot) do nothing returning id`;
  return r.length > 0;
}

/** The oldest queued job, marked running; null when none. Safe with several Bridge processes (skip locked). */
export async function claim(sql: Sql, at: string): Promise<Job | null> {
  const [r] = await sql`update slow.jobs set state = 'running', started_at = ${at}
    where id = (select id from slow.jobs where state = 'queued' order by slot, id for update skip locked limit 1) returning id, engine, kind, subject, preset, slot, stage, usd_cap`;
  return (r as Job | undefined) ?? null;
}

export async function finish(sql: Sql, id: string, at: string, o: { ok: boolean; cost_usd: number; result?: unknown; error?: string }) {
  await sql`update slow.jobs set state = ${o.ok ? "done" : "failed"}, finished_at = ${at}, cost_usd = ${o.cost_usd},
    result = ${o.result === undefined ? null : sql.json(o.result as never)}, error = ${o.error ?? null} where id = ${id}`;
}

/** Jobs whose engine died mid-run go back to the queue after `staleMs` (restart-safe). */
export async function requeueStale(sql: Sql, before: string) {
  await sql`update slow.jobs set state = 'queued', started_at = null where state = 'running' and started_at < ${before}`;
}

/** Deferred jobs whose slot is older than `before` are worthless now: failed, `expired`. */
export async function expireDeferred(sql: Sql, before: string, at: string) {
  await sql`update slow.jobs set state = 'failed', error = 'expired', finished_at = ${at} where state = 'deferred' and slot < ${before}`;
}

/** Move the `n` oldest deferred jobs of one engine and kind to the queue (the caller checks the day cap first). */
export async function promoteDeferred(sql: Sql, engine: Engine, kind: Kind, n: number) {
  if (n <= 0) return;
  await sql`update slow.jobs set state = 'queued', error = null
    where id in (select id from slow.jobs where state = 'deferred' and engine = ${engine} and kind = ${kind} order by slot, id limit ${n} for update skip locked)`;
}

/** Real spend of one engine on the UTC day of `at`, by when each run finished (or started, while it runs). */
export async function daySpend(sql: Sql, engine: Engine, at: string): Promise<number> {
  const [r] = await sql`select coalesce(sum(cost_usd), 0)::float usd from slow.jobs where engine = ${engine}
    and coalesce(finished_at, started_at) >= ${`${at.slice(0, 10)}T00:00:00Z`} and coalesce(finished_at, started_at) < ${`${at.slice(0, 10)}T00:00:00Z`}::timestamptz + interval '1 day'`;
  return r!.usd as number;
}

/** A claimed job that may not run now goes back to waiting, with the reason. */
export async function defer(sql: Sql, id: string, reason: string) {
  await sql`update slow.jobs set state = 'deferred', error = ${reason}, started_at = null where id = ${id}`;
}
