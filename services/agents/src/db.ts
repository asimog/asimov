// The agents schema (docs/generated/tables.md): jobs, trigger cursors, per-lane spend and the embedded memory (E5). Own schema, own role in production.
import type { SpendStore } from "@asimog/lane";
import postgres from "postgres";

export type Sql = postgres.Sql<Record<string, unknown>>;

export function connect(url: string, max = 4): Sql {
  return postgres(url, { max, idle_timeout: 30, onnotice: () => {} }) as unknown as Sql;
}

export async function migrate(sql: Sql) {
  await sql.unsafe(`
    create schema if not exists agents;
    create table if not exists agents.jobs (
      id text primary key,
      agent text not null,
      trigger jsonb not null,
      dedupe text not null unique,
      state text not null default 'queued' check (state in ('queued','running','done','failed')),
      attempts int not null default 0,
      cost_usd double precision not null default 0,
      result jsonb,
      error text,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz
    );
    create index if not exists jobs_queued on agents.jobs (created_at) where state = 'queued';
    create table if not exists agents.cursors (agent text primary key, seen_time timestamptz, id text);
    create table if not exists agents.spend (lane text not null, hour timestamptz not null, usd double precision not null default 0, primary key (lane, hour));
    create extension if not exists vector;
    create table if not exists agents.memory (
      id text primary key,
      kind text not null check (kind in ('callout','reply','report','wiki')),
      ref text not null,
      mint text,
      text text not null,
      model text not null,
      embedding vector not null,
      seen_at timestamptz not null,
      copy_of text
    );
    create index if not exists memory_kind_seen on agents.memory (model, kind, seen_at);
  `);
}

export class PgSpend implements SpendStore {
  constructor(private sql: Sql) {}
  async get(lane: string, hour: string) {
    const [r] = await this.sql`select usd from agents.spend where lane = ${lane} and hour = ${hour}`;
    return (r?.usd as number | undefined) ?? 0;
  }
  async add(lane: string, hour: string, usd: number) {
    await this.sql`insert into agents.spend (lane, hour, usd) values (${lane}, ${hour}, ${usd}) on conflict (lane, hour) do update set usd = agents.spend.usd + excluded.usd`;
  }
}
