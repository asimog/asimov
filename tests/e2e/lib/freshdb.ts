// A fresh database for suites that need Postgres but no tape (the slow-mind suites). Dropped by `done()`.
import { connect, migrate, type Sql } from "../../../services/core/src/lib/db.ts";
import { env } from "../../../services/core/src/lib/env.ts";

export async function freshDb(tag: string): Promise<{ sql: Sql; url: string; done(): Promise<void> }> {
  const base = env.str("DATABASE_URL");
  const db = `asimog_e2e_${tag}_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/g, "_");
  const admin = connect(base, 1);
  await admin.unsafe(`create database ${db}`);
  const url = new URL(base);
  url.pathname = `/${db}`;
  const sql = connect(url.toString(), 4);
  await migrate(sql);
  return {
    sql,
    url: url.toString(),
    async done() {
      await sql.end({ timeout: 2 });
      await admin.unsafe(`drop database if exists ${db} with (force)`);
      await admin.end();
    },
  };
}
