// Archiver (docs/tasks/B6-archiver.md, docs/OPS.md): a closed inputs_hot partition is exported to a gzipped NDJSON
// file, read back and verified (row count and sha256), recorded in tape.archived, checked against every consumer
// offset, and only then dropped. A failure leaves the partition in place for the next run.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Config } from "../lib/config.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { Tape } from "../tape/tape.ts";

export type Partition = { table: string; token: string; from: string; to: string };
type Row = Record<string, unknown>;

const HOUR = 3_600_000;
const TOKEN = /^events_p_(\d{10})_inputs_hot$/;

export class Archiver {
  private timer: NodeJS.Timeout | null = null;
  stats = { runs: 0, archived: 0, dropped: 0, skipped: 0, bytes: 0 };

  constructor(private tape: Tape, private sql: Sql, private config: Config, private root = env.root) {}

  start() {
    const every = this.config.schedules.archiver_every_min * 60_000;
    this.timer = setInterval(() => void this.runOnce().catch((err) => log.warn("archiver", { err: String(err) })), every);
    void this.runOnce().catch((err) => log.warn("archiver", { err: String(err) }));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Export and drop every closed inputs_hot partition past the hot window. */
  async runOnce() {
    this.stats.runs++;
    const now = this.tape.clock.now();
    const closedBefore = now - this.config.retention.hot_window_hours * HOUR;
    const out = { archived: [] as string[], dropped: [] as string[], skipped: [] as string[] };
    for (const p of await this.partitions()) {
      if (Date.parse(p.to) > closedBefore) continue;
      try {
        const prior = await this.sql`select partition, verified from tape.archived where partition = ${p.table}`;
        if (!prior.length) {
          const rows = await this.rows(p.table);
          const file = `tape-inputs_hot-${p.token}.ndjson.gz`;
          const body = gzip(rows);
          const sha256 = crypto.createHash("sha256").update(body).digest("hex");
          const dir = this.targetDir();
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, file), body);
          const check = verify(path.join(dir, file), rows.length, sha256);
          if (!check.ok) throw new Error(`archive verify failed: ${check.detail}`);
          this.stats.bytes += body.length;
          this.stats.archived++;
          out.archived.push(p.table);
          await this.sql`insert into tape.archived (partition, file, rows, sha256, target, from_time, to_time, verified, at)
            values (${p.table}, ${file}, ${rows.length}, ${sha256}, ${dir}, ${p.from}, ${p.to}, true, ${new Date(now).toISOString()})
            on conflict (partition) do nothing`;
          this.tape.emit("tape.archived", { partition: p.table, file, rows: rows.length, sha256, target: dir, from: p.from, to: p.to, at: new Date(now).toISOString() }, { source: "system", subject: p.table });
          await this.tape.flush();
        }
        await this.sql`select tape.drop_partition(${p.table})`;
        this.stats.dropped++;
        out.dropped.push(p.table);
      } catch (err) {
        this.stats.skipped++;
        out.skipped.push(p.table);
        log.warn("archive skipped", { partition: p.table, err: String(err) });
      }
    }
    return out;
  }

  /** The leaf inputs_hot partitions, parsed from their names (the name is the contract with Tape.ensurePartitions). */
  private async partitions(): Promise<Partition[]> {
    const rows = (await this.sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tape' and c.relkind = 'r' and c.relname ~ '^events_p_[0-9]{10}_inputs_hot$'`) as unknown as { relname: string }[];
    const out: Partition[] = [];
    for (const r of rows) {
      const m = TOKEN.exec(r.relname);
      if (!m) continue;
      const t = m[1]!;
      const start = Date.UTC(Number(t.slice(0, 4)), Number(t.slice(4, 6)) - 1, Number(t.slice(6, 8)), Number(t.slice(8, 10)));
      out.push({ table: `tape.${r.relname}`, token: t, from: new Date(start).toISOString(), to: new Date(start + HOUR).toISOString() });
    }
    return out.sort((a, b) => (a.token < b.token ? -1 : 1));
  }

  private async rows(table: string): Promise<Row[]> {
    return (await this.sql.unsafe(
      `select id, topic, v, class, event_time, seen_time, source, subject, causes, mode, body from ${table} order by seen_time, id`,
    )) as unknown as Row[];
  }

  /** The local target; B6b adds the bucket and git targets. */
  private targetDir(): string {
    const t = this.config.retention.archive_targets[0]!;
    return path.isAbsolute(t.dir) ? t.dir : path.join(this.root, t.dir);
  }
}

export function gzip(rows: Row[]): Buffer {
  return zlib.gzipSync(rows.map((r) => `${JSON.stringify(r)}\n`).join(""), { level: 9 });
}

/** Read the file back: same bytes, same row count, every line parses. */
export function verify(file: string, rows: number, sha256: string): { ok: boolean; detail: string } {
  const body = fs.readFileSync(file);
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  if (sha !== sha256) return { ok: false, detail: `sha256 ${sha} != ${sha256}` };
  let n = 0;
  try {
    for (const line of zlib.gunzipSync(body).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      JSON.parse(line);
      n++;
    }
  } catch (err) {
    return { ok: false, detail: `unreadable: ${String(err)}` };
  }
  return n === rows ? { ok: true, detail: `${n} rows` } : { ok: false, detail: `${n} rows in file, ${rows} written` };
}
