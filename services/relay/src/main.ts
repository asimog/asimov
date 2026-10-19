// relay (docs/SYSTEM.md): the public fan-out. One read-only Postgres connection follows the Tape and serves every viewer
// over SSE, plus cached snapshot reads. Viewers never reach core. No input from visitors is accepted.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import postgres from "postgres";
import { env } from "../../core/src/lib/env.ts";
import { log } from "../../core/src/lib/log.ts";
import { scoresAsOf } from "../../core/src/scorekeeper/scorekeeper.ts";
import { rooms } from "./rooms.ts";
import { rugFeed } from "./rug-feed.ts";
import { slowRooms } from "./slow-rooms.ts";

const sql = postgres(env.str("DATABASE_URL"), { max: env.int("RELAY_DB_POOL"), idle_timeout: 30, onnotice: () => {}, connection: { default_transaction_read_only: true } });
const PORT = env.int("RELAY_PORT");
const MANDATE_SOL = env.num("MANDATE_SOL");

// ---------- names ----------
const symbols = new Map<string, string>();
async function refreshSymbols() {
  for (const r of await sql`select mint, symbol from mem.coins where symbol is not null and last_trade_at > now() - interval '6 hours'`) symbols.set(r.mint as string, r.symbol as string);
}
const sym = (mint?: string | null) => (mint ? `$${symbols.get(mint) ?? mint.slice(0, 4)}` : "");
const familyOf = (sid: string) => sid.replace(/^sr_seed_\d+_/, "").replace(/_(fast|medium|slow)_(tight|loose)$/, "") || sid.slice(0, 10);

// ---------- event -> plain line (terse voice: facts, numbers, no adjectives) ----------
type Row = { id: string; topic: string; seen_time: Date; subject: string | null; body: Record<string, any>; causes: string[] };
export type Line = { id: string; t: number; topic: string; mint: string | null; text: string; v?: number; side?: string; family?: string; who?: string };

function line(r: Row): Line | null {
  const b = r.body;
  const base = { id: r.id, t: r.seen_time.getTime(), topic: r.topic };
  switch (r.topic) {
    case "callout.created":
      if (b.symbol) symbols.set(b.mint, b.symbol);
      if (b.via === "history") return null; // the Index's backfill is memory, not news
      return { ...base, mint: b.mint, text: `callout ${sym(b.mint)} by ${b.author_handle ?? b.author_wallet.slice(0, 4)}${b.mcap_at_call_usd ? ` at $${Math.round(b.mcap_at_call_usd / 1000)}k` : ""}`, v: b.author_followers ?? 0, who: b.author_wallet };
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
    case "coin.watched":
      return { ...base, mint: b.mint, text: `scout watching ${sym(b.mint)}: ${String(b.reason).replace("_", " ")}${b.features?.mcap_usd ? ` at $${Math.round(b.features.mcap_usd / 1000)}k` : ""}, ${b.features?.buyers ?? 0} buyers` };
    case "holders.snapshot":
      return { ...base, mint: b.mint, text: `holders ${sym(b.mint)}: top 10 hold ${(b.top10_share * 100).toFixed(0)}% of supply` };
    case "thesis.formed":
      return { ...base, mint: b.mint, text: `thesis ${sym(b.mint)} (${String(b.kind).replace("_", " ")}): ${b.prediction.what} at ${b.prediction.p.toFixed(2)}`, family: familyOf(b.strategy_id) };
    case "post.queued":
      return { ...base, mint: b.mint, text: `${b.kind} ${sym(b.mint)}: ${String(b.text).replace(/^PAPER\. /, "")}` };
    case "index.refreshed":
      return { ...base, mint: null, text: `index v${b.version}: ${b.wallets} wallets scored, ${b.smart.length} copyable` };
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
  const scores = (await scoresAsOf(sql, new Date(now).toISOString())).map((r) => ({ kind: r.kind, horizon_min: r.horizon_min, n: r.n, brier: r.brier_sum / r.n, base: r.hits / r.n }));
  // the caller network: two coins are linked when the same caller called both in the last 6 hours (the Field's strands)
  const edges = await sql`
    select a.mint a, b.mint b, count(distinct a.wallet)::int n from mem.callouts a join mem.callouts b on b.wallet = a.wallet and b.mint > a.mint
    where a.created_at > ${now}::timestamptz - interval '6 hours' and b.created_at > ${now}::timestamptz - interval '6 hours'
    group by 1, 2 order by 3 desc limit 160`;
  const graduated = (await sql`select distinct subject mint from tape.events where topic = 'trade.amm' and seen_time > ${now}::timestamptz - interval '60 minutes'`).map((r) => r.mint as string);
  const recent = (await sql`select id, topic, seen_time, subject, body, causes from tape.events
    where topic not like 'trade.%' and topic not in ('callout.counts', 'observation.raw', 'coin.seen', 'outcome.measured', 'caller.position', 'callout.updated')
    order by seen_time desc limit 60`) as unknown as Row[];
  const [limits] = await sql`select body from mind.limits order by version desc limit 1`;
  const body = {
    now: now.getTime(),
    mode: env.str("ASIMOG_MODE"),
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
    edges,
    graduated,
    tape: recent.map(line).filter(Boolean).reverse(),
    viewers: clients.size,
  };
  snapCache = { at: Date.now(), body };
  return body;
}

// ---------- rooms (docs/UI.md): small read-only queries, cached a few seconds ----------
const cache = new Map<string, { at: number; body: unknown }>();
const cached = async (key: string, ms: number, fn: () => Promise<unknown>) => {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ms) return c.body;
  const body = await fn();
  cache.set(key, { at: Date.now(), body });
  return body;
};

/** Lab: every commit, its thesis when it has one, and its reveal. */
const lab = () => cached("lab", 4000, async () => {
  const rows = await sql`
    select m.commit_id, m.kind, m.sha256, m.made_at, m.revealed_at, m.content,
      (select body from tape.events r where r.topic = 'commit.revealed' and r.subject = m.commit_id limit 1) reveal
    from mind.commits m order by m.made_at desc limit 160`;
  const [c] = await sql`select count(*)::int n, count(revealed_at)::int revealed from mind.commits`;
  return {
    total: c!.n, revealed: c!.revealed,
    items: rows.map((r) => {
      const k = r.content as Record<string, any>;
      return {
        id: r.commit_id, kind: r.kind, sha: r.sha256, made: (r.made_at as Date).getTime(), revealed: r.revealed_at ? (r.revealed_at as Date).getTime() : null,
        matches: (r.reveal as { matches?: boolean } | null)?.matches ?? null,
        sym: sym(k.mint), thesis: k.kind ? { kind: k.kind, what: k.prediction?.what, p: k.prediction?.p, claims: (k.claims ?? []).slice(0, 4), plan: k.plan } : null,
      };
    }),
  };
});

/** Ledger: every paper position, newest first, and the house's posts. */
const ledgerRoom = () => cached("ledger", 4000, async () => {
  const positions = await sql`select id, strategy_id, mint, opened_at, closed_at, cost_sol, proceeds_sol, net_sol, exit_reason, entry_price
    from mind.positions order by opened_at desc limit 300`;
  const posts = await sql`select seen_time, body from tape.events where topic = 'post.queued' order by seen_time desc limit 120`;
  return {
    positions: positions.map((p) => ({ ...p, sym: sym(p.mint as string), family: familyOf(p.strategy_id as string), opened_at: (p.opened_at as Date).getTime(), closed_at: p.closed_at ? (p.closed_at as Date).getTime() : null })),
    posts: posts.map((p) => ({ t: (p.seen_time as Date).getTime(), kind: p.body.kind, sym: sym(p.body.mint), text: p.body.text, house: p.body.house_id })),
  };
});

/** Integrity: the caller ledger at 5 min (ov2 outcomes, denominators), the Index, the risk floor at work. */
const integrity = () => cached("integrity", 8000, async () => {
  const callers = await sql`
    with o as (select distinct on (body->>'callout_id') body from tape.events where topic = 'outcome.measured' and (body->>'horizon_min')::int = 5
      order by body->>'callout_id', seen_time desc, id desc)
    select body->>'author_wallet' wallet, count(*)::int calls, count(*) filter (where body->>'coverage' = 'ok')::int ok,
      count(*) filter (where body->>'coverage' = 'ok' and (body->>'net_multiple')::float > 1)::int wins,
      percentile_cont(0.5) within group (order by (body->>'net_multiple')::float) filter (where body->>'coverage' = 'ok') med_net
    from o group by 1 order by 2 desc limit 40`;
  const handles = new Map((await sql`select wallet, handle from mem.callers where wallet = any(${callers.map((c) => c.wallet as string)})`).map((r) => [r.wallet as string, r.handle as string | null]));
  const smart = await sql`select wallet, n, copy_net, copy_win_lcb, lead_s, archetype from idx.wallet where archetype = 'smart' order by copy_win_lcb desc limit 20`.catch(() => []);
  const arche = await sql`select archetype, count(*)::int n from idx.wallet group by 1 order by 2 desc`.catch(() => []);
  const refused = await sql`select body->>'reason_code' reason, count(*)::int n from tape.events where topic = 'order.rejected' and seen_time > now() - interval '24 hours' group by 1 order by 2 desc`;
  const watched = await sql`select body->>'reason' reason, count(*)::int n from tape.events where topic = 'coin.watched' and seen_time > now() - interval '24 hours' group by 1 order by 2 desc`;
  return {
    callers: callers.map((c) => ({ ...c, who: c.wallet === "house" ? "house" : handles.get(c.wallet as string) ?? `${String(c.wallet).slice(0, 4)}…${String(c.wallet).slice(-4)}` })),
    smart: smart.map((w) => ({ ...w, wallet: `${String(w.wallet).slice(0, 4)}…${String(w.wallet).slice(-4)}` })), archetypes: arche, refused, watched,
  };
});

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
app.get("/v1/lab", async (c) => c.json(await lab()));
app.get("/v1/ledger", async (c) => c.json(await ledgerRoom()));
app.get("/v1/integrity", async (c) => c.json(await integrity()));
const rugs = rugFeed({ sql, cached, sym });
app.get("/v1/rugfeed", async (c) => c.json(await rugs()));
const r = rooms({ sql, cached, sym, line, mandate: MANDATE_SOL });
app.get("/v1/treasury", async (c) => c.json(await r.treasury()));
const slow = slowRooms({ sql, cached, sym });
app.get("/v1/synthesis", async (c) => c.json(await slow.synthesis()));
app.get("/v1/simulations", async (c) => c.json(await slow.simulations()));
app.get("/v1/board", async (c) => c.json(await r.board(c.req.query("at") ? Number(c.req.query("at")) : null)));
app.get("/v1/connectome", async (c) => c.json(await r.connectome()));
app.get("/v1/cards", async (c) => c.json(await r.cardIds()));
app.get("/v1/card/:id", async (c) => {
  const x = await r.card(c.req.param("id"));
  return x ? c.json(x) : c.json({ error: "no such callout" }, 404);
});
app.get("/v1/case/:id", async (c) => {
  const x = await r.caseFile(c.req.param("id"));
  return x ? c.json(x) : c.json({ error: "no such callout" }, 404);
});
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
setInterval(() => void tick(), env.int("RELAY_POLL_MS"));
serve({ fetch: app.fetch, port: PORT });
log.info("relay up", { port: PORT });
