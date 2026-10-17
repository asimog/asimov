// ctl: one command surface for humans and agents (docs/03). Every command prints JSON with --json.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { connect, migrate, resetProjections } from "../lib/db.ts";
import { env, redact } from "../lib/env.ts";

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

async function why(id: string, depth = 0, seen = new Set<string>()): Promise<unknown> {
  if (seen.has(id) || depth > 12) return { id, cycle: true };
  seen.add(id);
  const [e] = await sql`select id, topic, source, subject, seen_time, causes, body from tape.events where id = ${id} limit 1`;
  if (!e) {
    const [s] = await sql`select id, kind, subject, value, inputs, analyzer from board.signals where id = ${id}`;
    if (!s) return { id, missing: true };
    return { ...s, inputs: await Promise.all((s.inputs as string[]).map((c) => why(c, depth + 1, seen))) };
  }
  const causes = e.causes as string[];
  return { id: e.id, topic: e.topic, source: e.source, subject: e.subject, seen_time: e.seen_time, causes: await Promise.all(causes.map((c) => why(c, depth + 1, seen))) };
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
  if (env.opt("RPC_URL")) await probe("rpc", env.str("RPC_URL"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }) });
  if (env.opt("OPENROUTER_API_KEY")) await probe("openrouter", `${env.str("LLM_BASE_URL", "https://openrouter.ai/api/v1")}/models?limit=1`);
  checks.jev_key = env.opt("TYPESAFE_API_KEY") ? "set" : "missing";
  checks.config = redact();
  return checks;
}

const commands: Record<string, () => Promise<unknown>> = {
  state,
  why: () => why(args[0]!),
  tail: () => tail(args.filter((a) => !a.startsWith("--"))),
  doctor,
  migrate: async () => (await migrate(sql), { ok: true }),
  rebuild: async () => (await resetProjections(sql), { ok: true, note: "projections cleared; restart core to rebuild from the tape" }),
  export: () => exportTape(opt("out") ?? `data/tapes/tape-${Date.now()}.ndjson.gz`, opt("from"), opt("to")),
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
