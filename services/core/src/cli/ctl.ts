// ctl: one command surface for humans and agents (docs/SYSTEM.md). Every command prints JSON with --json.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { buildCase, renderCase } from "../hunt/case.ts";
import { liveClock } from "../lib/clock.ts";
import { configValues } from "../lib/config.ts";
import { connect, migrate, resetProjections } from "../lib/db.ts";
import { env, redact } from "../lib/env.ts";
import { RpcPool } from "../lib/rpc.ts";
import { why } from "../lib/why.ts";
import { loadList, setLimit, showLimits } from "../mind/owner.ts";
import { buildConsumers } from "../runtime.ts";
import { coverage, ledger } from "../scorekeeper/ledger.ts";
import { slowScores } from "../scorekeeper/slow-scores.ts";
import { ensureGenesis, verifyChain, versions } from "../soul/soul.ts";
import { hotPartitions, ndjsonLine, TAPE_COLUMNS } from "../tape/archiver.ts";
import { Tape } from "../tape/tape.ts";
import { buildTargets } from "../tape/targets.ts";
import { balances, nav, recordDeposit } from "../treasury/books.ts";
import { killState, ownerKill, resume } from "../treasury/kill.ts";
import { verifyProofs } from "../treasury/proofs.ts";
import { exportWiki, rebuildCheck } from "../wiki/wiki.ts";

const [cmd = "help", ...args] = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = (o: unknown) => console.log(flag("json") ? JSON.stringify(o) : JSON.stringify(o, null, 2));

const sql = connect(undefined, 2);

async function state() {
  const [tape] = await sql`select count(*)::int events, max(seen_time) head from tape.events`;
  const topics = await sql`select topic, count(*)::int n from tape.events where seen_time > now() - interval '1 hour' group by 1 order by 2 desc`;
  const [mem] = await sql`select (select count(*)::int from mem.coins) coins, (select count(*)::int from mem.callers) callers,
                                 (select count(*)::int from mem.callouts) callouts, (select count(*)::int from board.signals) signals`;
  const hot = await sql`select c.mint, c.symbol, c.callout_count, round(c.last_mcap_usd::numeric) mcap, c.first_callout_at
                        from mem.coins c where c.first_callout_at > now() - interval '1 hour' order by c.callout_count desc limit 8`;
  const lag = await sql`select consumer, last_seen_time from tape.consumer_offsets order by consumer`;
  return { mode: env.opt("ASIMOG_MODE"), tape, last_hour: topics, memory: mem, hot_coins: hot, consumers: lag };
}

async function tail(topics: string[]) {
  let last = new Date(Date.now() - 5000);
  for (;;) {
    const rows = await sql`select seen_time, topic, subject, source, body from tape.events
      where seen_time > ${last} ${topics.length ? sql`and topic = any(${topics})` : sql``} order by seen_time limit 200`;
    for (const r of rows) {
      last = r.seen_time as Date;
      console.log(JSON.stringify({ t: r.seen_time, topic: r.topic, subject: r.subject, body: r.body }).slice(0, 400));
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Export a tape window as gzipped NDJSON (a fixture or an archive). */
async function exportTape(file: string, from?: string, to?: string) {
  const gz = zlib.createGzip();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ws = fs.createWriteStream(file);
  gz.pipe(ws);
  let n = 0;
  const cursor = sql`select ${sql.unsafe(TAPE_COLUMNS)} from tape.events
    where seen_time >= ${from ?? "1970-01-01T00:00:00Z"} and seen_time <= ${to ?? "9999-12-31T00:00:00Z"} order by seen_time, id`.cursor(2000);
  for await (const rows of cursor)
    for (const r of rows) {
      gz.write(ndjsonLine(r));
      n++;
    }
  gz.end();
  await new Promise((r) => ws.on("close", r));
  return { file, events: n, bytes: fs.statSync(file).size };
}

const TIER_NAMES: Record<number, string> = { 1: "Hot", 2: "Warm", 3: "Indexes", 4: "Record", 5: "Archive", 6: "Knowledge" };

/** Which OPS tier a table belongs to (docs/OPS.md section 2). 0 means not counted. */
function tierOf(schema: string, name: string): number {
  if (schema === "tape" && /^events_(p_|default_)/.test(name)) return name.endsWith("_inputs_hot") ? 1 : 4;
  if (schema === "tape" && name === "blobs") return 1;
  if (schema === "board") return 2;
  if (schema === "mem") return name === "bars_1m" || name === "callout_updates" ? 2 : 4;
  if (schema === "idx") return 3;
  if (schema === "mind" || schema === "hands" || schema === "books") return 4;
  if (schema === "slow") return 4;
  return 0;
}

/** Oldest inputs_hot partition and how long it has sat past its window. Read-only. */
async function archiveLag(windowHours: number) {
  const now = Date.now();
  // sorted oldest first, so the first partition is the one that lags most
  const first = (await hotPartitions(sql))[0];
  const oldest = first ? { part: first.table.slice("tape.".length), to: Date.parse(first.to) } : null;
  const lag = oldest ? Math.max(0, Math.floor((now - (oldest.to + windowHours * 3_600_000)) / 1000)) : 0;
  return { lag_s: lag, oldest_partition: oldest?.part ?? null, oldest_to: oldest ? new Date(oldest.to).toISOString() : null };
}

/** `ctl stats` (docs/OPS.md section 2): exact rows and total bytes per tier, plus the archive lag. Read-only. */
async function stats() {
  const windowHours = configValues().retention.hot_window_hours;
  const tables = (await sql`select n.nspname schema, c.relname name, c.oid, pg_total_relation_size(c.oid)::bigint bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('tape', 'idx', 'mem', 'board', 'mind', 'hands', 'books', 'slow') order by 1, 2`) as unknown as {
    schema: string; name: string; oid: number; bytes: string;
  }[];
  const tiers = new Map<number, { tier: number; name: string; rows: number; bytes: number; tables: { table: string; rows: number; bytes: number }[] }>();
  for (const t of tables) {
    const tier = tierOf(t.schema, t.name);
    if (!tier) continue;
    const [r] = (await sql.unsafe(`select count(*)::int n from "${t.schema}"."${t.name}"`)) as unknown as [{ n: number }];
    const g = tiers.get(tier) ?? { tier, name: TIER_NAMES[tier]!, rows: 0, bytes: 0, tables: [] };
    g.rows += r.n;
    g.bytes += Number(t.bytes);
    g.tables.push({ table: `${t.schema}.${t.name}`, rows: r.n, bytes: Number(t.bytes) });
    tiers.set(tier, g);
  }
  // tier 5: archive files we can size (a local target); a remote target's bytes live in the provider
  const archived = (await sql`select file, target from tape.archived`) as unknown as { file: string; target: string }[];
  let archiveBytes = 0;
  for (const a of archived)
    for (const line of String(a.target).split("\n")) {
      if (!line.startsWith("local:")) continue;
      const dir = line.slice(6).split("=")[0]!;
      try {
        archiveBytes += fs.statSync(path.join(dir, a.file)).size;
      } catch {
        // a file moved by hand: the archive row is still the record
      }
    }
  const archive = { tier: 5, name: TIER_NAMES[5]!, rows: archived.length, bytes: archiveBytes, tables: [] as { table: string; rows: number; bytes: number }[] };
  const report = {
    at: new Date().toISOString(),
    tiers: [1, 2, 3, 4, 5, 6].map((n) => (n === 5 ? archive : tiers.get(n) ?? { tier: n, name: TIER_NAMES[n]!, rows: 0, bytes: 0, tables: [] })),
    archive: await archiveLag(windowHours),
  };
  return report;
}

async function doctor() {
  const checks: Record<string, unknown> = {};
  try {
    await sql`select 1`;
    checks.postgres = "ok";
  } catch (e) {
    checks.postgres = String(e);
  }
  const probe = async (name: string, url: string, init?: RequestInit) => {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      checks[name] = r.status;
    } catch (e) {
      checks[name] = String(e);
    }
  };
  await probe("pump_feed", `${env.str("PUMP_API_URL")}/home-feed/new?pageSize=1&chain=all&platform=WEB`, {});
  const rpc = new RpcPool();
  const rpcUsage = rpc.usage();
  for (const [name, health] of Object.entries(await rpc.health())) checks[`rpc:${name}`] = `${health}, units this month ${rpcUsage[name]}`; // names only: URLs hold keys
  if (env.opt("OPENROUTER_API_KEY")) await probe("openrouter", `${env.str("LLM_BASE_URL")}/models?limit=1`);
  checks.jev_key = env.opt("TYPESAFE_API_KEY") ? "set" : "missing";
  checks.config = redact();
  return checks;
}

const commands: Record<string, () => Promise<unknown>> = {
  state,
  why: () => why(sql, args[0]!),
  tail: () => tail(args.filter((a) => !a.startsWith("--"))),
  doctor,
  migrate: async () => (await migrate(sql), { ok: true }),
  rebuild: async () => (await resetProjections(sql, buildConsumers(new Tape(sql, liveClock("live")))), { ok: true, note: "projections cleared; restart core to rebuild from the tape" }),
  export: () => exportTape(opt("out") ?? `data/tapes/tape-${Date.now()}.ndjson.gz`, opt("from"), opt("to")),
  stats: async () => {
    const r = await stats();
    if (flag("json")) return r;
    for (const t of r.tiers) console.log(`${t.tier} ${t.name}: ${t.rows} rows, ${t.bytes} bytes`);
    console.log(`archive lag: ${r.archive.lag_s} s (oldest ${r.archive.oldest_partition ?? "none"})`);
    return undefined;
  },
  case: async () => {
    const c = await buildCase(sql, args[0] ?? "");
    if (!c) throw new Error(`no callout ${args[0]}`);
    if (!flag("md")) return c;
    console.log(renderCase(c));
  },
  // the wiki (E3): `ctl wiki` lists pages, `ctl wiki check <slug> <version>` re-renders one, `ctl wiki export` writes the targets
  wiki: async () => {
    if (args[0] === "check") return rebuildCheck(sql, args[1]!, Number(args[2]));
    if (args[0] === "export") return exportWiki(sql, buildTargets(configValues().retention.wiki_targets));
    return sql`select slug, max(version)::int version, max(as_of) as_of from wiki.pages group by slug order by slug`;
  },
  callers: () => ledger(sql, { horizon: Number(opt("h") ?? 5), at: opt("at") }),
  coverage: () => coverage(sql),
  // the Index (docs/PIPELINE.md): size, latest version, archetypes, the strongest copyable wallets, recent promotions
  index: async () => {
    const [size] = await sql`select (select count(*)::int from idx.wallet_coin) wallet_coins, (select count(*)::int from idx.coin) coins,
      (select count(*)::int from idx.seed) seeds, (select max(version) from idx.wallet) version`;
    const archetypes = await sql`select archetype, count(*)::int n from idx.wallet group by 1 order by 2 desc`;
    const top = await sql`select wallet, n, round(copy_net::numeric, 3)::float copy_net, round(copy_win_lcb::numeric, 3)::float copy_win_lcb, lead_s, seed
      from idx.wallet where archetype = 'smart' order by copy_win_lcb desc limit ${Number(opt("n") ?? 10)}`;
    const promotions = await sql`select body->>'reason' reason, count(*)::int n from tape.events where topic = 'coin.watched' group by 1 order by 2 desc`;
    return { ...size, archetypes, smart_top: top, promotions };
  },
  // the house as a caller (docs/EXECUTION.md): its ledger row next to the crowd baseline, and its latest paper posts
  house: async () => {
    const L = await ledger(sql, { horizon: Number(opt("h") ?? 5) });
    const posts = await sql`select seen_time, body->>'kind' kind, body->>'house_id' house_id, body->>'text' text from tape.events
      where topic = 'post.queued' order by seen_time desc, id desc limit ${Number(opt("n") ?? 20)}`;
    return { method: L.method, horizon_min: L.horizon_min, house: L.rows.find((r) => r.wallet === "house") ?? null, crowd: L.all, posts };
  },
  // soul versions on their hash chain (docs/SYSTEM.md); `soul` lists them and recomputes the chain
  soul: async () => {
    await ensureGenesis(sql, path.join(env.root, "SOUL.md"));
    return { chain: await verifyChain(sql), versions: await versions(sql) };
  },
  // S6.7: the owner's switch (docs/OPS.md). kill writes the Tape; the kill consumer and the Signer do the rest.
  kill: async () => {
    const tape = new Tape(sql, liveClock("live"));
    ownerKill(tape, args.filter((a) => !a.startsWith("--")).join(" ") || "owner", path.join(env.root, "artifacts", "KILL"));
    await tape.close();
    return { ok: true, note: "halted: artifacts/KILL written, so the Signer refuses every request even if core is down; kill.changed is on the Tape" };
  },
  resume: async () => {
    const tape = new Tape(sql, liveClock("live"));
    resume(tape, opt("token"), undefined, path.join(env.root, "artifacts", "KILL"));
    await tape.close();
    return { ok: true };
  },
  // S6.4: the books (docs/EXECUTION.md)
  // fix plan 2.3 and 2.4: the owner's limits and lists. `ctl limits set max_order_sol 0.01 --token T`,
  // `ctl limits show`, `ctl lists load blocked_creators file.txt --token T` (one base58 address per line)
  limits: async () => {
    const [sub, key, value] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--token");
    if (sub === "show" || !sub) return showLimits(sql);
    if (sub !== "set" || !key || value === undefined) throw new Error("usage: ctl limits show | ctl limits set <key> <value> --token <admin>");
    const tape = new Tape(sql, liveClock("live"));
    try {
      return await setLimit(sql, tape, opt("token"), key, value);
    } finally {
      await tape.close();
    }
  },
  lists: async () => {
    const [sub, kind, file] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--token");
    if (sub !== "load" || !kind || !file) throw new Error("usage: ctl lists load <kind> <file> --token <admin>");
    const tape = new Tape(sql, liveClock("live"));
    try {
      return await loadList(sql, tape, opt("token"), kind, fs.readFileSync(file, "utf8"));
    } finally {
      await tape.close();
    }
  },
  books: async () => ({ kill: await killState(sql), balances: await balances(sql), nav: await nav(sql, {}), proofs: await verifyProofs(sql) }),
  deposit: async () => {
    const tape = new Tape(sql, liveClock("live"));
    await recordDeposit(tape, opt("wallet")!, Number(opt("lamports")), opt("sig")!);
    await tape.close();
    return { ok: true };
  },
  // docs/SLOW-MIND.md: the slow mind at a glance: jobs, spend per lane against its hourly cap, engine health, last reports, scores
  slow: async () => {
    const at = new Date().toISOString();
    const jobs = await sql`select engine, kind, state, count(*)::int n from slow.jobs where slot > ${new Date(Date.now() - 86_400_000).toISOString()} group by 1, 2, 3 order by 1, 2, 3`;
    const recent = await sql`select id, engine, kind, subject, state, started_at, finished_at, cost_usd, error from slow.jobs order by slot desc, id desc limit ${Number(opt("n") ?? 10)}`;
    const spend = await sql`select engine, coalesce(sum(cost_usd), 0)::float last_hour from slow.jobs where finished_at > now() - interval '1 hour' group by 1`;
    // D2: today's real spend (UTC, by the job's slot) per engine and stage, against SLOW_USD_PER_DAY per engine
    const today = await sql`select engine, coalesce(stage::text, 'feed') stage, coalesce(sum(cost_usd), 0)::float usd, count(*) filter (where error = 'day_cap')::int day_capped
      from slow.jobs where left(slot, 10) = ${at.slice(0, 10)} group by 1, 2 order by 1, 2`;
    const ENGINES = [{ engine: "bettafish", lane: "SYNTH", url: "BETTAFISH_URL" }, { engine: "miroshark", lane: "SWARM", url: "MIROSHARK_URL" }];
    const lanes = await Promise.all(ENGINES.map(async (e) => {
      const url = env.opt(e.url);
      const ok = url ? await fetch(`${url}/asimog/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false) : false;
      return { engine: e.engine, lane: e.lane, health: url ? (ok ? "up" : "down") : "unset", usd_last_hour: spend.find((s) => s.engine === e.engine)?.last_hour ?? 0, usd_cap_hour: env.numOpt(`LLM_USD_HOUR_${e.lane}`) ?? null };
    }));
    const reports = await sql`select report_id, producer, kind, subject, published_at, left(summary, 160) summary from slow.reports order by published_at desc limit 5`;
    return { lanes, today: { usd_cap_day: env.num("SLOW_USD_PER_DAY"), by_engine_stage: today }, jobs_24h: jobs, recent, reports, scores: await slowScores(sql, at) };
  },
  help: async () => ({ commands: Object.keys(commands) }),
};

const fn = commands[cmd];
if (!fn) {
  console.error(`unknown command ${cmd}; try: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
fn()
  .then((r) => r !== undefined && out(r))
  .catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 2 }));
