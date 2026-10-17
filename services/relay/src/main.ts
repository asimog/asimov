// relay (docs/02): the public fan-out. One read-only Postgres connection follows the Tape and serves every viewer
// over SSE, plus cached snapshot reads. Viewers never reach core. No input from visitors is accepted.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import postgres from "postgres";
import { env } from "../../core/src/lib/env.ts";
import { log } from "../../core/src/lib/log.ts";

const sql = postgres(env.str("DATABASE_URL"), { max: env.int("RELAY_DB_POOL", 3), idle_timeout: 30, onnotice: () => {}, connection: { default_transaction_read_only: true } });
const PORT = env.int("RELAY_PORT", 7401);
const MANDATE_SOL = env.num("MANDATE_SOL", 0.2);

// ---------- names ----------
const symbols = new Map<string, string>();
async function refreshSymbols() {
  for (const r of await sql`select mint, symbol from mem.coins where symbol is not null and last_trade_at > now() - interval '6 hours'`) symbols.set(r.mint as string, r.symbol as string);
}
const sym = (mint?: string | null) => (mint ? `$${symbols.get(mint) ?? mint.slice(0, 4)}` : "");
const familyOf = (sid: string) => sid.replace(/^sr_seed_\d+_/, "").replace(/_(fast|medium|slow)_(tight|loose)$/, "") || sid.slice(0, 10);

// ---------- event -> plain line (terse voice: facts, numbers, no adjectives) ----------
type Row = { id: string; topic: string; seen_time: Date; subject: string | null; body: Record<string, any>; causes: string[] };
export type Line = { id: string; t: number; topic: string; mint: string | null; text: string; v?: number; side?: string; family?: string };

function line(r: Row): Line | null {
  const b = r.body;
  const base = { id: r.id, t: r.seen_time.getTime(), topic: r.topic };
  switch (r.topic) {
    case "callout.created":
      if (b.symbol) symbols.set(b.mint, b.symbol);
      return { ...base, mint: b.mint, text: `callout ${sym(b.mint)} by ${b.author_handle ?? b.author_wallet.slice(0, 4)}${b.mcap_at_call_usd ? ` at $${Math.round(b.mcap_at_call_usd / 1000)}k` : ""}`, v: b.author_followers ?? 0 };
    case "trade.curve":
    case "trade.amm":
      return { ...base, mint: b.mint, text: `${b.side} ${b.sol.toFixed(3)} SOL ${sym(b.mint)}`, v: b.sol, side: b.side };
    case "jev.answer": {
      const kind = b.answers?.kind;
      return { ...base, mint: null, text: `jev read callout: ${kind?.choice ?? "?"} ${kind?.confidence != null ? kind.confidence.toFixed(2) : ""} in ${b.latency_ms} ms`, v: b.latency_ms };
    }
    case "intent.created":
      return { ...base, mint: b.mint, text: `${familyOf(b.strategy_id)} wants to ${b.side} ${sym(b.mint)}${b.size_sol ? ` ${b.size_sol.toFixed(3)} SOL` : ""}`, side: b.side, family: familyOf(b.strategy_id) };
    case "order.rejected":
      return { ...base, mint: null, text: `risk gate refused: ${b.reason_code.replaceAll("_", " ")}` };
    case "intent.ghost_filled":
      return { ...base, mint: b.mint, text: `paper ${b.side} ${sym(b.mint)} ${b.sol.toFixed(4)} SOL, slippage ${b.slippage_bps.toFixed(0)} bps`, v: b.sol, side: b.side, family: familyOf(b.strategy_id) };
    case "position.closed":
      return { ...base, mint: b.mint, text: `closed ${sym(b.mint)} ${b.net_sol >= 0 ? "+" : ""}${b.net_sol.toFixed(4)} SOL after ${(b.held_ms / 60000).toFixed(1)} min (${b.exit_reason.split(":").pop()})`, v: b.net_sol, family: familyOf(b.strategy_id) };
    case "markout.measured":
      return { ...base, mint: b.mint, text: `markout ${sym(b.mint)} 60 s ${b.h60s == null ? "n/a" : `${b.h60s > 0 ? "+" : ""}${(b.h60s / 100).toFixed(1)}%`}`, v: b.h60s ?? 0 };
    case "commit.made":
      return { ...base, mint: null, text: `committed ${b.kind} ${b.sha256.slice(0, 12)}` };
    case "commit.revealed":
      return { ...base, mint: null, text: `revealed ${String(b.commit_id).slice(-8)}: ${b.matches ? "hash matches" : "HASH MISMATCH"}` };
    case "strategy.born":
      return { ...base, mint: null, text: `strategy born: ${b.family} ${b.horizon} (${b.origin})`, family: b.family };
    case "strategy.retired":
      return { ...base, mint: null, text: `strategy retired: ${b.reason.replaceAll("_", " ")} after ${b.trades} trades` };
    case "kernel.allocation":
      return { ...base, mint: null, text: `allocation round ${b.round}: ${b.shares.filter((s: { share: number }) => s.share > 0).length} strategies earn capital` };
    case "outcome.measured":
      return null;
    case "score.updated":
      return { ...base, mint: null, text: `${b.kind} ${b.horizon_min} min: brier ${b.brier.toFixed(3)} over ${b.n}` };
    default:
      return null;
  }
}

// ---------- snapshot ----------
let snapCache: { at: number; body: unknown } | null = null;
async function snapshot() {
  if (snapCache && Date.now() - snapCache.at < 2000) return snapCache.body;
  const [head] = await sql`select max(seen_time) head from tape.events`;
  const now = (head?.head as Date | null) ?? new Date();
  const coins = await sql`
    select c.mint, c.symbol, c.callout_count, c.last_mcap_usd mcap, c.first_callout_at, c.last_trade_at,
      (select (value->>'progress')::float from board.signals s where s.kind = 'curve.progress' and s.subject = c.mint order by produced_at desc limit 1) progress,
      (select (value->>'p')::float from board.signals s where s.kind = 'hawkes.wave_p' and s.subject = c.mint order by produced_at desc limit 1) wave_p
    from mem.coins c where c.first_callout_at > ${now}::timestamptz - interval '60 minutes'
    order by c.callout_count desc, c.last_trade_at desc nulls last limit 72`;
  const positions = await sql`
    select p.id, p.strategy_id, p.mint, p.cost_sol, p.entry_price, p.opened_at, p.tokens_left / nullif(p.tokens, 0) left_frac
    from mind.positions p where p.closed_at is null order by p.opened_at desc limit 200`;
  const [pool] = await sql`
    select (select count(*)::int from mind.strategies where retired_at is null) alive,
      (select count(*)::int from mind.strategies) born,
      (select count(*)::int from mind.positions where closed_at is not null) closed,
      (select coalesce(sum(net_sol), 0)::float from mind.positions where closed_at is not null) net,
      (select count(*)::int from mind.positions where closed_at is null) open,
      (select count(*)::int from mind.commits) commits,
      (select count(*)::int from mind.commits where revealed_at is not null) reveals`;
  const equity = await sql`
    select seen_time t, sum((body->>'net_sol')::float) over (order by seen_time, id) eq
    from tape.events where topic = 'position.closed' order by seen_time desc limit 400`;
  const [rates] = await sql`
    select count(*) filter (where topic = 'callout.created')::int callouts, count(*) filter (where topic = 'jev.answer')::int jev,
      count(*) filter (where topic like 'trade.%')::int trades, count(*) filter (where topic = 'intent.created')::int intents,
      count(*) filter (where topic = 'order.rejected')::int refused
    from tape.events where seen_time > ${now}::timestamptz - interval '10 minutes'`;
  const markouts = await sql`select (body->>'h60s')::float h60, body->>'side' side from tape.events where topic = 'markout.measured' and body->>'h60s' is not null order by seen_time desc limit 120`;
  const families = await sql`
    select s.family, count(*) filter (where s.retired_at is null)::int alive, coalesce(sum(st.trades), 0)::int trades, coalesce(sum(st.equity), 0)::float net
    from mind.strategies s left join mind.stats st on st.strategy_id = s.id group by 1 order by 1`;
  const scores = await sql`select kind, horizon_min, n, brier_sum / nullif(n, 0) brier, hits::float / nullif(n, 0) base from mind.scores order by kind`;
  const recent = (await sql`select id, topic, seen_time, subject, body, causes from tape.events
    where topic not like 'trade.%' and topic not in ('callout.counts', 'observation.raw', 'coin.seen', 'outcome.measured', 'caller.position', 'callout.updated')
    order by seen_time desc limit 60`) as unknown as Row[];
  const [limits] = await sql`select body from mind.limits order by version desc limit 1`;
  const body = {
    now: now.getTime(),
    mode: env.str("ASIMOG_MODE", "paper"),
    mandate_sol: MANDATE_SOL,
    floor_frac: (limits?.body as { daily_loss_stop_frac?: number } | undefined)?.daily_loss_stop_frac ?? 0.25,
    milestone: "START",
    counsel_queue: 0,
    coins: coins.map((c) => ({ ...c, sym: c.symbol ?? (c.mint as string).slice(0, 4) })),
    positions: positions.map((p) => ({ ...p, family: familyOf(p.strategy_id as string) })),
    pool,
    equity: equity.reverse().map((e) => [(e.t as Date).getTime(), e.eq as number]),
    rates,
    markouts,
    families,
    scores,
    tape: recent.map(line).filter(Boolean).reverse(),
    viewers: clients.size,
  };
  snapCache = { at: Date.now(), body };
  return body;
}

// ---------- live fan-out ----------
type Client = { send: (lines: Line[]) => Promise<void> };
const clients = new Set<Client>();
let cursor: { t: Date; id: string } | null = null;

async function follow() {
  if (!cursor) {
    const [h] = await sql`select seen_time, id from tape.events order by seen_time desc, id desc limit 1`;
    cursor = h ? { t: h.seen_time as Date, id: h.id as string } : { t: new Date(0), id: "" };
  }
  const rows = (await sql`select id, topic, seen_time, subject, body, causes from tape.events
    where (seen_time, id) > (${cursor.t}, ${cursor.id}) and topic not in ('callout.counts', 'observation.raw', 'coin.seen', 'outcome.measured')
    order by seen_time, id limit 2000`) as unknown as Row[];
  if (!rows.length) return;
  cursor = { t: rows[rows.length - 1]!.seen_time, id: rows[rows.length - 1]!.id };
  const lines = rows.map(line).filter((x): x is Line => x !== null);
  if (lines.length) await Promise.all([...clients].map((c) => c.send(lines).catch(() => clients.delete(c))));
}

let busy = false;
const tick = async () => {
  if (busy) return;
  busy = true;
  try {
    await follow();
  } catch (err) {
    log.warn("relay follow", { err: String(err) });
  } finally {
    busy = false;
  }
};

// ---------- http ----------
const app = new Hono();
app.use("/v1/*", cors({ origin: (o) => o, allowMethods: ["GET"] }));
app.get("/v1/snapshot", async (c) => c.json(await snapshot()));
app.get("/v1/stream", (c) =>
  streamSSE(c, async (stream) => {
    const client: Client = { send: (lines) => stream.writeSSE({ event: "lines", data: JSON.stringify(lines) }) };
    clients.add(client);
    stream.onAbort(() => void clients.delete(client));
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ viewers: clients.size }) });
    while (!stream.aborted) {
      await stream.sleep(15_000);
      await stream.writeSSE({ event: "ping", data: String(clients.size) });
    }
  }),
);
app.get("/health", (c) => c.json({ ok: true, viewers: clients.size }));

await refreshSymbols();
setInterval(() => void refreshSymbols().catch(() => {}), 10_000);
await sql.listen("tape", () => void tick()).catch((err) => log.info("relay listen off; polling", { err: String(err) }));
setInterval(() => void tick(), env.int("RELAY_POLL_MS", 400));
serve({ fetch: app.fetch, port: PORT });
log.info("relay up", { port: PORT });
