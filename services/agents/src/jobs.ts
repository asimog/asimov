// The job queue (docs/generated/tables.md agents.jobs). Triggers are deterministic: a cron slot or a Tape event, each with a dedupe key,
// so a restart or a double tick never queues the same work twice. No agent decides which agent runs.
import crypto from "node:crypto";
import type { Sql } from "./db.ts";
import type { AgentName } from "./lanes.ts";

export type Trigger = { type: "schedule"; slot: string } | { type: "event"; event: Record<string, unknown> };
export type Job = { id: string; agent: AgentName; trigger: Trigger; attempts: number };

/** Queue a job unless its dedupe key exists. Returns the job id, or null if it was already queued. */
export async function enqueue(sql: Sql, agent: AgentName, trigger: Trigger, dedupe: string): Promise<string | null> {
  const id = `jb_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const [r] = await sql`insert into agents.jobs (id, agent, trigger, dedupe) values (${id}, ${agent}, ${sql.json(trigger as never)}, ${dedupe}) on conflict (dedupe) do nothing returning id`;
  return (r?.id as string | undefined) ?? null;
}

/** Take the oldest queued job (FOR UPDATE SKIP LOCKED), mark it running. */
export async function claim(sql: Sql): Promise<Job | null> {
  const [r] = await sql`
    update agents.jobs set state = 'running', started_at = now(), attempts = attempts + 1
    where id = (select id from agents.jobs where state = 'queued' order by created_at, id for update skip locked limit 1)
    returning id, agent, trigger, attempts`;
  return (r as unknown as Job | undefined) ?? null;
}

export async function finish(sql: Sql, id: string, o: { ok: boolean; cost_usd: number; result?: unknown; error?: string }) {
  await sql`update agents.jobs set state = ${o.ok ? "done" : "failed"}, cost_usd = ${o.cost_usd}, result = ${sql.json((o.result ?? null) as never)}, error = ${o.error ?? null}, finished_at = now() where id = ${id}`;
}

export async function getCursor(sql: Sql, agent: string): Promise<{ seen_time: string | null; id: string | null }> {
  const [r] = await sql`select seen_time, id from agents.cursors where agent = ${agent}`;
  return { seen_time: r?.seen_time ? (r.seen_time as Date).toISOString() : null, id: (r?.id as string | undefined) ?? null };
}
export async function setCursor(sql: Sql, agent: string, seenTime: string, id: string) {
  await sql`insert into agents.cursors (agent, seen_time, id) values (${agent}, ${seenTime}, ${id}) on conflict (agent) do update set seen_time = excluded.seen_time, id = excluded.id`;
}
