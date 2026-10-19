// Pipeline config (docs/OPS.md section 1): config/*.json, each checked by a strict zod schema at boot. A missing file, bad JSON
// or bad field stops boot with `config/<file>: <path.to.field>: <message>`; code carries no fallback. Boot writes one
// `config.loaded` per file (name, sha256, parsed value), and a replay reads those from the Tape, never from disk.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILES, type ConfigFile } from "@asimog/contracts";
import { z } from "zod";
import type { Tape } from "../tape/tape.ts";
import type { Sql } from "./db.ts";
import { env } from "./env.ts";

const share = z.number().min(0).max(1);
const posInt = z.number().int().positive();
const unknownRule = z.enum(["pass", "refuse"]);

const SCHEMAS = {
  /** Feed sources the Feed Reader polls (B2); only sources recorded in docs/research/pumpfun-endpoints.md. */
  feeds: z.strictObject({ sources: z.array(z.enum(["recent", "hot", "follow"])).min(1) }),
  filters: z.strictObject({
    /** Callout door (B2): checked before a callout is written. */
    callout: z.strictObject({
      chains: z.array(z.string().min(1)).min(1),
      min_position_usd: z.number().min(0),
      min_mcap_usd: z.number().min(0),
      max_mcap_usd: z.number().positive().nullable(),
    }),
    /** Launch door (B3): checked before `coin.watched`; `on_unknown` decides a fact no source answered, per watch reason. */
    launch: z.strictObject({
      max_dev_buy_sol: z.number().min(0),
      max_block0_sniper_share: share,
      max_bundle_share: share,
      on_unknown: z.strictObject({ caller_buy: unknownRule, smart_buy: unknownRule, follow: unknownRule, heat: unknownRule, metrics: unknownRule }),
    }),
  }),
  retention: z.strictObject({
    /** hours an `inputs_hot` partition stays before the archiver exports and drops it (B6) */
    hot_window_hours: posInt,
    /** hours hourly rollups stay before compaction to wallet x coin and wallet x day (B7) */
    rollup_hourly_hours: posInt,
    /** where archive files go (B6); B6b adds the bucket and git kinds */
    archive_targets: z.array(z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("local"), dir: z.string().min(1) })])).min(1),
  }),
  /** Timers, in minutes, for the jobs of B6 and B7. */
  schedules: z.strictObject({
    archiver_every_min: posInt,
    rollup_compact_every_min: posInt,
    leaderboards_every_min: posInt,
    index_light_every_min: posInt,
    index_full_every_min: posInt,
    index_weekly_every_min: posInt,
  }),
} satisfies Record<ConfigFile, z.ZodType>;

export type Config = { [F in ConfigFile]: z.infer<(typeof SCHEMAS)[F]> };
type Loaded = { [F in ConfigFile]: { sha256: string; value: Config[F] } };

export const CONFIG_DIR = path.join(env.root, "config");

/** Reads and checks every file; the first failure throws with the file and the field path. Touches no database. */
export function readConfig(dir = CONFIG_DIR): Loaded {
  const out = {} as Record<ConfigFile, { sha256: string; value: unknown }>;
  for (const file of CONFIG_FILES) {
    const where = `config/${file}.json`;
    const p = path.join(dir, `${file}.json`);
    if (!fs.existsSync(p)) throw new Error(`${where}: (file): missing`);
    const raw = fs.readFileSync(p);
    let json: unknown;
    try {
      json = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      throw new Error(`${where}: (file): bad JSON: ${(err as Error).message}`);
    }
    out[file] = { sha256: crypto.createHash("sha256").update(raw).digest("hex"), value: check(file, json) };
  }
  return out as Loaded;
}

/** Boot: read and check every file, then write one `config.loaded` per file. */
export async function loadConfig(tape: Tape, dir = CONFIG_DIR): Promise<Config> {
  const loaded = readConfig(dir);
  for (const file of CONFIG_FILES) tape.emit("config.loaded", { file, ...loaded[file] }, { source: "system", subject: file });
  await tape.flush();
  return values(loaded);
}

/** Replay: the config as of `at`, from the last `config.loaded` per file on the Tape. A file never loaded stops the replay. */
export async function configFromTape(sql: Sql, at: string): Promise<Config> {
  const rows = await sql<{ file: ConfigFile; body: { sha256: string; value: unknown } }[]>`
    select distinct on (body->>'file') body->>'file' as file, body from tape.events
    where topic = 'config.loaded' and seen_time <= ${at} order by body->>'file', seen_time desc, id desc`;
  const out = {} as Record<ConfigFile, unknown>;
  for (const file of CONFIG_FILES) {
    const r = rows.find((x) => x.file === file);
    if (!r) throw new Error(`config/${file}.json: (file): no config.loaded on the tape before ${at}`);
    out[file] = check(file, r.body.value);
  }
  return out as Config;
}

function check(file: ConfigFile, json: unknown): unknown {
  const r = SCHEMAS[file].safeParse(json);
  if (r.success) return r.data;
  const i = r.error.issues[0]!;
  throw new Error(`config/${file}.json: ${i.path.length ? i.path.join(".") : "(file)"}: ${i.message}`);
}

const values = (l: Loaded): Config => Object.fromEntries(CONFIG_FILES.map((f) => [f, l[f].value])) as Config;
