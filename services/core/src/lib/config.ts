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
/** An archive or wiki export target (B6b, E3). */
const Target = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("local"), dir: z.string().min(1) }),
  // the endpoint and keys are env (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY), never config
  z.strictObject({ kind: z.literal("s3"), bucket: z.string().min(1), region: z.string().min(1), prefix: z.string().optional() }),
  z.strictObject({ kind: z.literal("git"), dir: z.string().min(1), remote: z.string().optional(), branch: z.string().min(1).default("main") }),
]);
export type TargetConfig = z.infer<typeof Target>;
const unknownRule = z.enum(["pass", "refuse"]);

const SCHEMAS = {
  /** Feed sources the Feed Reader polls (B2); only sources recorded in docs/research/pumpfun-endpoints.md. */
  feeds: z.strictObject({ sources: z.array(z.enum(["recent", "hot", "follow"])).min(1) }),
  filters: z.strictObject({
    /** Callout door (B2): checked before a callout is written. */
    callout: z.strictObject({
      chains: z.array(z.string().min(1)).min(1),
      /** a callout whose source carries no chain (`followingFeed` today): pass, or refuse until we record the chain */
      unknown_chain: unknownRule,
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
  /** The owner's limit defaults (C12, docs/STRATEGY.md section 7): every key the owner has not set with `ctl limits set`. */
  "limits.default": z.strictObject({
    max_order_sol: z.number().positive(),
    probe_order_sol: z.number().positive(),
    max_position_sol: z.number().positive(),
    max_open_coins: posInt,
    min_free_sol: z.number().min(0),
    daily_loss_stop_frac: share,
    max_impact_bps: z.number().min(0),
    min_real_sol: z.number().min(0),
    max_quote_age_ms: posInt,
    max_slippage_bps: z.number().min(0),
    max_bundle_share: share,
    max_top10_share: share,
    max_creator_sold: share,
    /** a buy on a coin with no live `risk.state` is refused (C7); only `true` is accepted, so the floor only gets stricter */
    require_risk_state: z.literal(true),
    /** a creator with more launches than this in 7 days is a mass deployer: the gate refuses the buy (C9) */
    max_creator_launches_7d: posInt,
  }),
  /** Model per thinking agent and the free fallback chain (E4); keys are env (LLM_KEY_<LANE>, LLM_FALLBACK_KEY), never config. */
  models: z.strictObject({
    default: z.string().min(1),
    agents: z.partialRecord(z.enum(["postmortem", "researcher", "ops", "reporter", "integrity", "wiki"]), z.string().min(1)),
    /** tried in order when the primary fails; OpenRouter free models, called with LLM_FALLBACK_KEY */
    fallback: z.array(z.string().min(1)).min(1),
  }),
  retention: z.strictObject({
    /** hours an `inputs_hot` partition stays before the archiver exports and drops it (B6) */
    hot_window_hours: posInt,
    /** hours hourly rollups stay before compaction to wallet x coin and wallet x day (B7) */
    rollup_hourly_hours: posInt,
    /** hours a Board signal row stays after it stopped being valid (the Tape still holds its inputs) */
    board_hours: posInt,
    /** where archive files go (B6); B6b adds the bucket and git kinds */
    archive_targets: z.array(Target).min(1),
    /** where the wiki's markdown export goes (E3): the same kinds, so the owner moves it between a bucket and a git repository */
    wiki_targets: z.array(Target),
  }),
  /** Timers, in minutes, for the jobs of B6 and B7. */
  schedules: z.strictObject({
    archiver_every_min: posInt,
    rollup_compact_every_min: posInt,
    leaderboards_every_min: posInt,
    index_light_every_min: posInt,
    index_full_every_min: posInt,
    index_weekly_every_min: posInt,
    wiki_export_every_min: posInt,
  }),
} satisfies Record<ConfigFile, z.ZodType>;

export type Config = { [F in ConfigFile]: z.infer<(typeof SCHEMAS)[F]> };
type Loaded = { [F in ConfigFile]: { sha256: string; value: Config[F] } };

export const CONFIG_DIR = path.join(env.root, "config");

/** The parsed values only (senses and tests); the hashes stay with loadConfig. */
export function configValues(dir = CONFIG_DIR): Config {
  return values(readConfig(dir));
}

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

/** The ordered model chain for one thinking agent: its model (or the default), then the fallbacks. */
export function modelChain(m: Config["models"], agent: string): string[] {
  return [m.agents[agent as keyof typeof m.agents] ?? m.default, ...m.fallback];
}

const values = (l: Loaded): Config => Object.fromEntries(CONFIG_FILES.map((f) => [f, l[f].value])) as Config;
