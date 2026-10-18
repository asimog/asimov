// ctl: one command surface for humans and agents (docs/03). Every command prints JSON with --json.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { connect, migrate, resetProjections } from "../lib/db.ts";
import { buildCase, renderCase } from "../hunt/case.ts";
import { env, redact } from "../lib/env.ts";
import { RpcPool } from "../lib/rpc.ts";
import { ensureGenesis, verifyChain, versions } from "../soul/soul.ts";
import { why } from "../lib/why.ts";
import { coverage, ledger } from "../scorekeeper/ledger.ts";
import { slowScores } from "../scorekeeper/slow-scores.ts";
import { liveClock } from "../lib/clock.ts";
import { Tape } from "../tape/tape.ts";
import { buildConsumers } from "../runtime.ts";
import { balances, nav, recordDeposit } from "../treasury/books.ts";
import { killState, ownerKill, resume } from "../treasury/kill.ts";
import { verifyProofs } from "../treasury/proofs.ts";

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
  const cursor = sql`select id, topic, v, event_time, seen_time, source, subject, causes, mode, body from tape.events
    where seen_time >= ${from ?? "epoch"} and seen_time <= ${to ?? "infinity"} order by seen_time, id`.cursor(2000);
  for await (const rows of cursor)
    for (const r of rows) {
      gz.write(`${JSON.stringify({ ...r, event_time: new Date(r.event_time as string).toISOString(), seen_time: new Date(r.seen_time as string).toISOString() })}\n`);
      n++;
    }
  gz.end();
  await new Promise((r) => ws.on("close", r));
  return { file, events: n, bytes: fs.statSync(file).size };
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
  await probe("pump_feed", "https://frontend-api-v3.pump.fun/home-feed/new?pageSize=1&chain=all&platform=WEB", { headers: { Origin: "https://pump.fun" } });
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
  case: async () => {
    const c = await buildCase(sql, args[0] ?? "");
    if (!c) throw new Error(`no callout ${args[0]}`);
    if (!flag("md")) return c;
    console.log(renderCase(c));
  },
  callers: () => ledger(sql, { horizon: Number(opt("h") ?? 5) }),
  coverage: () => coverage(sql),
  // the Index (docs/23): size, latest version, archetypes, the strongest copyable wallets, recent promotions
  index: async () => {
    const [size] = await sql`select (select count(*)::int from idx.wallet_coin) wallet_coins, (select count(*)::int from idx.coin) coins,
      (select count(*)::int from idx.seed) seeds, (select max(version) from idx.wallet) version`;
    const archetypes = await sql`select archetype, count(*)::int n from idx.wallet group by 1 order by 2 desc`;
    const top = await sql`select wallet, n, round(copy_net::numeric, 3)::float copy_net, round(copy_win_lcb::numeric, 3)::float copy_win_lcb, lead_s, seed
      from idx.wallet where archetype = 'smart' order by copy_win_lcb desc limit ${Number(opt("n") ?? 10)}`;
    const promotions = await sql`select body->>'reason' reason, count(*)::int n from tape.events where topic = 'coin.watched' group by 1 order by 2 desc`;
    return { ...size, archetypes, smart_top: top, promotions };
  },
  // the house as a caller (docs/09): its ledger row next to the crowd baseline, and its latest paper posts
  house: async () => {
    const L = await ledger(sql, { horizon: Number(opt("h") ?? 5) });
    const posts = await sql`select seen_time, body->>'kind' kind, body->>'house_id' house_id, body->>'text' text from tape.events
      where topic = 'post.queued' order by seen_time desc, id desc limit ${Number(opt("n") ?? 20)}`;
    return { method: L.method, horizon_min: L.horizon_min, house: L.rows.find((r) => r.wallet === "house") ?? null, crowd: L.all, posts };
  },
  // soul versions on their hash chain (docs/22); `soul` lists them and recomputes the chain
  soul: async () => {
    await ensureGenesis(sql, path.join(env.root, "SOUL.md"));
    return { chain: await verifyChain(sql), versions: await versions(sql) };
  },
  // S6.7: the owner's switch (docs/15). kill writes the Tape; the kill consumer and the Signer do the rest.
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
  // S6.4: the books (docs/10)
  books: async () => ({ kill: await killState(sql), balances: await balances(sql), nav: await nav(sql, {}), proofs: await verifyProofs(sql) }),
  deposit: async () => {
    const tape = new Tape(sql, liveClock("live"));
    await recordDeposit(tape, opt("wallet")!, Number(opt("lamports")), opt("sig")!);
    await tape.close();
    return { ok: true };
  },
  // docs/24: the slow mind at a glance: jobs, spend per lane against its hourly cap, engine health, last reports, scores
  slow: async () => {
    const at = new Date().toISOString();
    const jobs = await sql`select engine, kind, state, count(*)::int n from slow.jobs where slot > ${new Date(Date.now() - 86_400_000).toISOString()} group by 1, 2, 3 order by 1, 2, 3`;
    const recent = await sql`select id, engine, kind, subject, state, started_at, finished_at, cost_usd, error from slow.jobs order by slot desc, id desc limit ${Number(opt("n") ?? 10)}`;
    const spend = await sql`select engine, coalesce(sum(cost_usd), 0)::float last_hour from slow.jobs where finished_at > now() - interval '1 hour' group by 1`;
    const ENGINES = [{ engine: "bettafish", lane: "SYNTH", url: "BETTAFISH_URL" }, { engine: "miroshark", lane: "SWARM", url: "MIROSHARK_URL" }];
    const lanes = await Promise.all(ENGINES.map(async (e) => {
      const url = env.opt(e.url);
      const ok = url ? await fetch(`${url}/asimog/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false) : false;
      return { engine: e.engine, lane: e.lane, health: url ? (ok ? "up" : "down") : "unset", usd_last_hour: spend.find((s) => s.engine === e.engine)?.last_hour ?? 0, usd_cap_hour: env.num(`LLM_USD_HOUR_${e.lane}`, 0) };
    }));
    const reports = await sql`select report_id, producer, kind, subject, published_at, left(summary, 160) summary from slow.reports order by published_at desc limit 5`;
    return { lanes, jobs_24h: jobs, recent, reports, scores: await slowScores(sql, at) };
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
