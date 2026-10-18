// slow.jobs (docs/SLOW-MIND.md section 5): a job runs once, is idempotent by (engine, kind, subject, slot), and records cost and errors.
import type { Engine, Job, Kind } from "./types.ts";

type Sql = import("postgres").Sql<Record<string, unknown>>;

export async function enqueue(sql: Sql, j: { engine: Engine; kind: Kind; subject: string; preset: string; slot: string; id: string }): Promise<boolean> {
  const r = await sql`insert into slow.jobs (id, engine, kind, subject, preset, slot) values (${j.id}, ${j.engine}, ${j.kind}, ${j.subject}, ${j.preset}, ${j.slot})
    on conflict (engine, kind, subject, slot) do nothing returning id`;
  return r.length > 0;
}

/** The oldest queued job, marked running; null when none. Safe with several Bridge processes (skip locked). */
export async function claim(sql: Sql, at: string): Promise<Job | null> {
  const [r] = await sql`update slow.jobs set state = 'running', started_at = ${at}
    where id = (select id from slow.jobs where state = 'queued' order by slot, id for update skip locked limit 1) returning id, engine, kind, subject, preset, slot`;
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
