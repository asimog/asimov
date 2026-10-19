// Archiver (docs/tasks/B6-archiver.md, docs/OPS.md): a closed inputs_hot partition is exported to a gzipped NDJSON
// file, read back and verified (row count and sha256), recorded in tape.archived, checked against every consumer
// offset, and only then dropped. A failure leaves the partition in place for the next run.
import crypto from "node:crypto";
import zlib from "node:zlib";
import type { Config } from "../lib/config.ts";
import type { Sql } from "../lib/db.ts";
import { log } from "../lib/log.ts";
import type { Tape } from "../tape/tape.ts";
import { type ArchiveTarget, targetsFromConfig } from "./targets.ts";

export type Partition = { table: string; token: string; from: string; to: string };
type Row = Record<string, unknown>;

const HOUR = 3_600_000;
const TOKEN = /^events_p_(\d{10})_inputs_hot$/;

export class Archiver {
  private timer: NodeJS.Timeout | null = null;
  stats = { runs: 0, archived: 0, dropped: 0, skipped: 0, bytes: 0, last_error: "" };

  private readonly targets: ArchiveTarget[];
  /** `consumers`: every consumer the runtime runs; one with no bookmark yet counts as behind, so its hours stay. */
  constructor(private tape: Tape, private sql: Sql, private config: Config, targets?: ArchiveTarget[], private consumers: string[] = []) {
    this.targets = targets ?? targetsFromConfig(config);
  }

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
    for (const p of await hotPartitions(this.sql)) {
      if (Date.parse(p.to) > closedBefore) continue;
      try {
        // an unverified record (a crash mid-run, an older build) is exported again, never trusted
        const prior = await this.sql`select 1 from tape.archived where partition = ${p.table} and verified`;
        if (!prior.length) {
          const rows = await this.rows(p.table);
          const file = `tape-inputs_hot-${p.token}.ndjson.gz`;
          const body = gzip(rows);
          const sha256 = crypto.createHash("sha256").update(body).digest("hex");
          // every target must take the same bytes and give them back; one failure leaves the partition in place
          const verified: string[] = [];
          for (const target of this.targets) {
            await target.put(file, body);
            const check = verify(await target.get(file), rows.length, sha256);
            if (!check.ok) throw new Error(`${target.name}: ${check.detail}`);
            verified.push(`${target.name}=${sha256}`);
          }
          this.stats.bytes += body.length;
          this.stats.archived++;
          out.archived.push(p.table);
          const targets = verified.join("\n");
          await this.sql`insert into tape.archived (partition, file, rows, sha256, target, from_time, to_time, verified, at)
            values (${p.table}, ${file}, ${rows.length}, ${sha256}, ${targets}, ${p.from}, ${p.to}, true, ${new Date(now).toISOString()})
            on conflict (partition) do update set file = excluded.file, rows = excluded.rows, sha256 = excluded.sha256,
              target = excluded.target, verified = true, at = excluded.at`;
          this.tape.emit("tape.archived", { partition: p.table, file, rows: rows.length, sha256, target: targets, from: p.from, to: p.to, at: new Date(now).toISOString() }, { source: "system", subject: p.table });
          await this.tape.flush();
        }
        const unread = await this.sql`select n.consumer from unnest(${this.consumers}::text[]) n(consumer)
          left join tape.consumer_offsets o using (consumer) where o.consumer is null`;
        if (unread.length) throw new Error(`no bookmark yet for ${unread.map((r) => r.consumer).join(", ")}`);
        await this.sql`select tape.drop_partition(${p.table})`;
        this.stats.dropped++;
        out.dropped.push(p.table);
      } catch (err) {
        this.stats.skipped++;
        this.stats.last_error = `${p.table}: ${String(err)}`;
        out.skipped.push(p.table);
        log.warn("archive skipped", { partition: p.table, err: String(err) });
        this.tape.emit("ops.alert", { severity: "warn", text: `Archive kept ${p.table}: ${String(err)}`, finding: "archive.failed" }, { source: "system", subject: p.table });
      }
    }
    return out;
  }

  private async rows(table: string): Promise<Row[]> {
    return (await this.sql.unsafe(`select ${TAPE_COLUMNS} from ${table} order by seen_time, id`)) as unknown as Row[];
  }
}

/** The columns every Tape export carries: the archive and `ctl export` write the same file shape. */
export const TAPE_COLUMNS = "id, topic, v, class, event_time, seen_time, source, subject, causes, mode, body";

/** One NDJSON line for a Tape row; dates serialise as ISO strings. */
export const ndjsonLine = (r: Row) => `${JSON.stringify(r)}\n`;

/** The leaf inputs_hot partitions, parsed from their names (the name is the contract with ensureHourPartition). */
export async function hotPartitions(sql: Sql): Promise<Partition[]> {
  const rows = (await sql`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'tape' and c.relkind = 'r' and c.relname ~ '^events_p_[0-9]{10}_inputs_hot$'`) as unknown as { relname: string }[];
  const out: Partition[] = [];
  for (const r of rows) {
    const t = TOKEN.exec(r.relname)?.[1];
    if (!t) continue;
    const start = Date.UTC(Number(t.slice(0, 4)), Number(t.slice(4, 6)) - 1, Number(t.slice(6, 8)), Number(t.slice(8, 10)));
    out.push({ table: `tape.${r.relname}`, token: t, from: new Date(start).toISOString(), to: new Date(start + HOUR).toISOString() });
  }
  return out.sort((a, b) => (a.token < b.token ? -1 : 1));
}

export function gzip(rows: Row[]): Buffer {
  return zlib.gzipSync(rows.map(ndjsonLine).join(""), { level: 9 });
}

/** Read the bytes back: same checksum, same row count, every line parses. */
export function verify(body: Buffer, rows: number, sha256: string): { ok: boolean; detail: string } {
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
