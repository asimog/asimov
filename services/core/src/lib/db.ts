import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { env } from "./env.ts";

export type Sql = postgres.Sql<Record<string, unknown>>;

export function connect(url = env.str("DATABASE_URL"), max = env.int("DB_POOL", 8)): Sql {
  return postgres(url, {
    max,
    idle_timeout: 30,
    onnotice: () => {},
    types: { bigint: postgres.BigInt },
  }) as unknown as Sql;
}

export async function migrate(sql: Sql) {
  const ddl = fs.readFileSync(path.join(import.meta.dirname, "../sql/schema.sql"), "utf8");
  await sql.unsafe(ddl);
}

/** Projections (consumers flagged `projection`) only read the Tape and write mem or board; they are cleared and rebuilt.
 * Deciders (desk, scorekeeper, reflex trigger) write events, so they are never re-run over old Tape:
 * their exact rebuild is a replay into a fresh database (docs/14). The tape is untouched. */
export async function resetProjections(sql: Sql, consumers: { name: string; projection?: true }[]) {
  await sql.unsafe(`
    truncate mem.coins, mem.callers, mem.callouts, mem.callout_updates, mem.callout_replies, mem.bars_1m, mem.bar_buyers, board.signals;`);
  await sql`delete from tape.consumer_offsets where consumer = any(${consumers.filter((c) => c.projection).map((c) => c.name)})`;
}
