// The core's tools for thinking agents (docs/SYSTEM.md). Each tool names the capabilities that may call it; a token maps to
// exactly one capability. This file is the only door thinking agents have: reads of the Tape, Board and mind tables,
// and writes of proposal, synthesis, swarm and report events. Nothing here trades, signs, posts or changes limits.
import crypto from "node:crypto";
import { canonical, type Source, SwarmPlatform } from "@asimog/contracts";
import { z } from "zod";
import { liveFor } from "../board/board.ts";
import { publicText } from "../hands/text-checks.ts";
import type { Clock } from "../lib/clock.ts";
import { configValues } from "../lib/config.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { why } from "../lib/why.ts";
import { validate as validateSpec } from "../mind/dsl.ts";
import { scoresAsOf } from "../scorekeeper/scorekeeper.ts";
import { latest as latestSoul, updateSoul } from "../soul/soul.ts";
import type { Tape } from "../tape/tape.ts";

export const CAP = {
  synth: "cap:board.synthesis",
  swarm: "cap:board.swarm",
  propose: "cap:mind.propose",
  jev: "cap:jev.propose",
  ops: "cap:ops.stop",
  report: "cap:report",
  integrity: "cap:integrity.write",
  soul: "cap:soul.update",
  exchange: "cap:report.exchange", // the Slow Bridge (docs/SLOW-MIND.md): escalation triggers in, reports out
  swarmRead: "cap:swarm.read", // the MiroShark worker (docs/SLOW-MIND.md M7, M10): its report agent and caller personas, reads only
  memory: "cap:memory.read", // the Librarian (E5): reads the texts the agents' memory embeds, writes nothing but job events
} as const;
export const ALL_CAPS: string[] = Object.values(CAP);

/** Who a capability's writes are recorded as on the Tape. */
const SOURCE: Record<string, Source> = { [CAP.synth]: "bettafish", [CAP.swarm]: "miroshark", [CAP.soul]: "soul", [CAP.exchange]: "slow-bridge", [CAP.swarmRead]: "miroshark" };
/** Topic prefixes and signal kinds a capability may read through `events_since` and `board_signals`. */
const READ_TOPICS: Record<string, string[]> = { [CAP.propose]: ["position.closed"], [CAP.ops]: ["system.", "kill.", "ops."], [CAP.exchange]: ["jev.escalated"], [CAP.memory]: ["callout.created", "callout.reply", "report.published", "report.drafted", "wiki.page"] };
const READ_KINDS: Record<string, string[]> = { [CAP.integrity]: ["integrity.finding"], [CAP.report]: ["synthesis.", "mood.", "swarm."] };

/** Sources written by thinking lanes and core on their behalf. */
const LANE_SOURCES: Source[] = ["agents", "bettafish", "miroshark", "soul", "slow-bridge"];

export class Refusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface ToolCtx {
  sql: Sql;
  tape: Tape;
  clock: Clock;
  soulFile: string;
  cap: string;
}
export interface Tool {
  name: string;
  caps: string[];
  desc: string;
  input: z.ZodObject;
  run(a: never, c: ToolCtx): Promise<unknown>;
}
/** `strict`: an unknown argument is refused, not dropped (a number core computes must not arrive from an engine). */
const tool = <S extends z.ZodRawShape>(name: string, caps: string[], desc: string, shape: S, run: (a: z.infer<z.ZodObject<S>>, c: ToolCtx) => Promise<unknown>, o: { strict?: boolean } = {}): Tool => ({ name, caps, desc, input: o.strict ? z.strictObject(shape) : z.object(shape), run: run as Tool["run"] });

const ANY_LANE = ALL_CAPS.filter((c) => c !== CAP.swarmRead); // the read-only worker token records nothing
const source = (c: ToolCtx) => SOURCE[c.cap] ?? "agents";
const iso = z.string().datetime({ offset: true });

/** Parse "cap=token,cap=token" (the env var MCP_TOKENS). */
export function parseTokens(s: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of (s ?? "").split(",")) {
    const i = pair.lastIndexOf("=");
    if (i > 0 && i < pair.length - 1) {
      const cap = pair.slice(0, i).trim();
      if (!ALL_CAPS.includes(cap)) throw new Error(`MCP_TOKENS: unknown capability ${cap}`);
      m.set(pair.slice(i + 1).trim(), cap);
    }
  }
  return m;
}

// ---------- citation rule: a claim stands only if every callout it cites exists and was seen inside the run's window ----------
type Window = { from: string; to: string };
/** The run's window: `window_min` before its `as_of` (the Bridge's slot). An `as_of` after now is refused. */
function windowOf(c: ToolCtx, a: { as_of: string; window_min: number }): Window {
  const to = Date.parse(a.as_of);
  if (to > c.clock.now()) throw new Refusal("future_as_of", `as_of ${a.as_of} is after now`);
  return { from: new Date(to - a.window_min * 60_000).toISOString(), to: new Date(to).toISOString() };
}
async function citedCallouts(c: ToolCtx, ids: string[], w: Window): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await c.sql`select callout_id, mint from mem.callouts where callout_id = any(${ids}) and seen_at >= ${w.from} and seen_at <= ${w.to} and seen_at <= ${c.clock.iso()}`;
  return new Map(rows.map((r) => [r.callout_id as string, r.mint as string]));
}

// ---------- one public-text check (publicText) on every text field of every write ----------
/** The claim with its text fields cleaned, or null when one is refused (the claim is dropped and counted). */
function passClaim<T extends Record<string, unknown>>(x: T, fields: (keyof T & string)[]): T | null {
  const out: Record<string, unknown> = { ...x };
  for (const f of fields) {
    const v = x[f];
    if (typeof v !== "string") continue;
    const r = publicText(v);
    if (r.failed.length) return null;
    out[f] = r.text;
  }
  return out as T;
}
/** A field whose refusal refuses the whole call. */
function requireText(what: string, text: string): string {
  const r = publicText(text);
  if (r.failed.length) throw new Refusal("guard", `${what} refused: ${r.failed.join(", ")}`);
  return r.text;
}
const passClaims = <T extends Record<string, unknown>>(xs: T[], fields: (keyof T & string)[], ok: (x: T) => boolean) =>
  xs.flatMap((x) => {
    const t = passClaim(x, fields);
    return t && ok(x) ? [t] : [];
  });
const cited = (found: Map<string, string>, cites: string[], mint?: string) => cites.length > 0 && cites.every((id) => found.has(id) && (!mint || found.get(id) === mint));

const Cites = z.array(z.string()).max(12);
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
/** A swarm sample is a wave when this many distinct simulated callers call (the Scorekeeper's hit uses the same setting). */
const WAVE_CALLERS = env.int("SWARM_WAVE_CALLERS");
/** Mood past a third of the way to either end gets its label. */
const MOOD_BAND = 1 / 3;

/** Feed mood from counts (D6): distinct callouts cited by kept bullish stances against those cited by bearish or avoid ones. */
function moodOf(stances: { stance: string; cites: string[] }[]) {
  const ids = (k: string[]) => new Set(stances.filter((s) => k.includes(s.stance)).flatMap((s) => s.cites));
  const [bull, bear] = [ids(["bullish"]).size, ids(["bearish", "avoid"]).size];
  const n = bull + bear;
  const mood = n ? (bull - bear) / n : 0;
  return { n_callouts: n, n_bullish: bull, n_bearish: bear, bull_share: n ? bull / n : 0.5, mood, label: mood <= -MOOD_BAND ? ("fearful" as const) : mood >= MOOD_BAND ? ("greedy" as const) : ("calm" as const) };
}
const Stance = z.enum(["bullish", "bearish", "neutral", "avoid"]);

export const TOOLS: Tool[] = [
  // ----- reads -----
  tool("callouts_window", [CAP.synth, CAP.swarm, CAP.swarmRead], "Callouts seen in the last N minutes, hottest first.", { since_min: z.number().min(1).max(1440).default(60), limit: z.number().int().min(1).max(300).default(120) }, async (a, c) => {
    const w = { like: env.num("W_LIKE"), comment: env.num("W_COMMENT"), share: env.num("W_SHARE") };
    const now = c.clock.now();
    const rows = await c.sql`
      select c.callout_id, c.mint, k.symbol, c.wallet, c.text, c.created_at, c.likes, c.replies, c.reposts, c.quotes,
             c.likes * ${w.like} + c.replies * ${w.comment} + (c.reposts + c.quotes) * ${w.share} hot
      from mem.callouts c left join mem.coins k using (mint)
      where c.seen_at <= ${new Date(now).toISOString()} and c.created_at > ${new Date(now - a.since_min * 60_000).toISOString()}
      order by hot desc, c.created_at desc limit ${a.limit}`;
    return { callouts: rows };
  }),

  tool("coin_dossier", [CAP.synth, CAP.swarm, CAP.swarmRead], "One coin: record, last price, live signals, recent callouts, the most active callers with their DNA, and the coins that share its callers.", { mint: z.string().min(32).max(44) }, async (a, c) => {
    const at = c.clock.iso();
    const [coin] = await c.sql`select mint, symbol, name, first_seen, last_mcap_usd, callout_count, first_callout_at from mem.coins where mint = ${a.mint}`;
    if (!coin) throw new Refusal("not_found", `no coin ${a.mint}`);
    const [px] = await c.sql`select (body->>'price_sol')::float price_sol, seen_time from tape.events
      where topic = 'trade.curve' and subject = ${a.mint} and seen_time <= ${at} order by seen_time desc, id desc limit 1`;
    const callouts = await c.sql`select callout_id, wallet, text, created_at, likes, replies from mem.callouts where mint = ${a.mint} and seen_at <= ${at} order by created_at desc limit 20`;
    const callers = await c.sql`select wallet, handle, followers, calls_seen from mem.callers order by calls_seen desc limit 40`;
    const dna = await Promise.all(callers.map(async (k) => ({ ...k, dna: (await liveFor(c.sql, k.wallet as string, at))["caller.dna"]?.value ?? null })));
    const live = await liveFor(c.sql, a.mint, at);
    const shared = await c.sql`select o.mint, k.symbol, count(distinct o.wallet)::int shared from mem.callouts o left join mem.coins k using (mint)
      where o.wallet in (select wallet from mem.callouts where mint = ${a.mint} and seen_at <= ${at}) and o.mint <> ${a.mint} and o.seen_at <= ${at}
        and o.created_at > ${new Date(c.clock.now() - 30 * 86_400_000).toISOString()}
      group by o.mint, k.symbol order by shared desc, o.mint limit 5`;
    return { coin, last_price_sol: (px?.price_sol as number | undefined) ?? null, signals: Object.fromEntries(Object.entries(live).map(([k, v]) => [k, { value: v.value, confidence: v.confidence }])), callouts, callers: dna, shared_callers: shared };
  }),

  tool("coin_flow_since", [CAP.synth, CAP.swarm, CAP.swarmRead], "Real flow on one coin since a time (minute bars and callouts seen before now): buys, sells, net SOL, distinct callers calling.", { mint: z.string().min(32).max(44), since: iso }, async (a, c) => {
    const at = c.clock.iso();
    const [b] = await c.sql`select count(*)::int minutes, coalesce(sum(buys), 0)::int buys, coalesce(sum(sells), 0)::int sells, coalesce(sum(net_flow_sol), 0)::float net_flow_sol,
        coalesce(sum(volume_sol), 0)::float volume_sol, (array_agg(c order by minute desc))[1]::float last_close
      from mem.bars_1m where mint = ${a.mint} and minute >= ${a.since} and minute < ${at}`;
    const [k] = await c.sql`select count(*)::int callouts, count(distinct wallet)::int distinct_callers from mem.callouts where mint = ${a.mint} and created_at >= ${a.since} and seen_at <= ${at}`;
    return { mint: a.mint, since: a.since, as_of: at, ...b, ...k };
  }),

  tool("events_since", [CAP.propose, CAP.ops, CAP.exchange, CAP.memory], "Events of allowed topics after a cursor (seen_time, id), oldest first. The trigger feed for agents.", { topics: z.array(z.string()).min(1).max(8), after_seen_time: iso.optional(), after_id: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) }, async (a, c) => {
    const allowed = READ_TOPICS[c.cap] ?? [];
    for (const t of a.topics) if (!allowed.some((p) => t.startsWith(p))) throw new Refusal("out_of_lane", `topic ${t} is not readable with ${c.cap}`);
    const rows = await c.sql`select id, topic, seen_time, subject, body from tape.events
      where topic = any(${a.topics}) and seen_time <= ${c.clock.iso()}
        and (seen_time, id) > (${a.after_seen_time ?? "1970-01-01T00:00:00Z"}::timestamptz, ${a.after_id ?? ""})
      order by seen_time, id limit ${a.limit}`;
    return { events: rows };
  }),

  tool("board_signals", [CAP.integrity, CAP.report], "Live Board signals of one allowed kind at or above a confidence.", { kind: z.string(), min_confidence: z.number().min(0).max(1).default(0), limit: z.number().int().min(1).max(100).default(50) }, async (a, c) => {
    if (!(READ_KINDS[c.cap] ?? []).some((p) => a.kind.startsWith(p))) throw new Refusal("out_of_lane", `kind ${a.kind} is not readable with ${c.cap}`);
    const at = c.clock.iso();
    const rows = await c.sql`select id, kind, subject, value, confidence, produced_at, inputs from board.signals
      where kind = ${a.kind} and confidence >= ${a.min_confidence} and produced_at <= ${at} and valid_until > ${at} order by produced_at desc limit ${a.limit}`;
    return { signals: rows };
  }),

  tool("missed_waves", [CAP.propose], "Measured callouts that ran (net multiple at or above a bar at a horizon, coverage ok) on coins no strategy traded, after a cursor.", { min_net_multiple: z.number().min(1).default(env.num("POSTMORTEM_MISSED_MULT")), horizon_min: z.number().int().default(5), after_seen_time: iso.optional(), after_id: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) }, async (a, c) => ({
    events: await c.sql`select e.id, e.seen_time, e.subject, e.body from tape.events e
      where e.topic = 'outcome.measured' and e.seen_time <= ${c.clock.iso()} and (e.seen_time, e.id) > (${a.after_seen_time ?? "1970-01-01T00:00:00Z"}::timestamptz, ${a.after_id ?? ""})
        and (e.body->>'horizon_min')::int = ${a.horizon_min} and e.body->>'coverage' = 'ok' and (e.body->>'net_multiple')::float >= ${a.min_net_multiple}
        and not exists (select 1 from mind.positions p where p.mint = e.body->>'mint')
      order by e.seen_time, e.id limit ${a.limit}`,
  })),

  tool("why", [CAP.propose], "The why-chain of an event or signal id.", { id: z.string() }, async (a, c) => ({ chain: await why(c.sql, a.id) })),

  tool("worst_cases", [CAP.propose, CAP.jev], "The closed positions with the lowest net SOL, with strategy family and exit reason.", { n: z.number().int().min(1).max(60).default(20) }, async (a, c) => ({
    cases: await c.sql`select p.id position_id, p.strategy_id, s.family, p.mint, k.symbol, p.callout_id, p.net_sol, p.exit_reason, p.opened_at, p.closed_at
      from mind.positions p left join mind.strategies s on s.id = p.strategy_id left join mem.coins k on k.mint = p.mint
      where p.closed_at is not null order by p.net_sol asc nulls last limit ${a.n}`,
  })),

  tool("strategies_list", [CAP.propose], "Live strategies (id, family, horizon, origin) and two example specs to change.", {}, async (_a, c) => ({
    strategies: await c.sql`select id, family, horizon, origin, born_at from mind.strategies where retired_at is null order by born_at desc limit 100`,
    examples: (await c.sql`select spec from mind.strategies where retired_at is null order by born_at desc limit 2`).map((r) => r.spec),
  })),

  tool("scores", [CAP.jev, CAP.report], "Brier scores per probability signal and horizon.", {}, async (_a, c) => ({
    scores: (await scoresAsOf(c.sql, c.clock.iso())).map((r) => ({ kind: r.kind, horizon_min: r.horizon_min, n: r.n, brier: r.brier_sum / r.n, hit_rate: r.hits / r.n })),
  })),

  tool("state", [CAP.ops, CAP.report], "Tape head, event counts in the last hour and consumer offsets.", {}, async (_a, c) => {
    const [tape] = await c.sql`select count(*)::int events, max(seen_time) head from tape.events`;
    const topics = await c.sql`select topic, count(*)::int n from tape.events where seen_time > ${new Date(c.clock.now() - 3_600_000).toISOString()} group by 1 order by 2 desc limit 30`;
    const consumers = await c.sql`select consumer, last_seen_time from tape.consumer_offsets order by consumer`;
    return { mode: c.clock.mode, tape, last_hour: topics, consumers };
  }),

  tool("doctor", [CAP.ops], "Findings: a stalled tape head, lagging consumers, recent gaps. Each has a code, severity and scope.", {}, async (_a, c) => {
    const now = c.clock.now();
    const findings: { code: string; severity: "info" | "warn" | "page"; scope: string; detail: string }[] = [];
    // the head is the last event from the world or the desk: thinking lanes write job events all the time and must not hide a stall
    const [h] = await c.sql`select max(seen_time) head from tape.events where source <> all(${LANE_SOURCES})`;
    const headAge = h?.head ? (now - (h.head as Date).getTime()) / 1000 : null;
    if (headAge === null || headAge > env.num("DOCTOR_HEAD_STALL_S")) findings.push({ code: "tape_stalled", severity: "page", scope: "tape", detail: headAge === null ? "tape is empty" : `no event for ${Math.round(headAge)} s` });
    for (const r of await c.sql`select consumer, last_seen_time from tape.consumer_offsets`) {
      const lag = headAge === null || !h?.head ? 0 : ((h.head as Date).getTime() - (r.last_seen_time as Date).getTime()) / 1000;
      if (lag > env.num("DOCTOR_CONSUMER_LAG_S")) findings.push({ code: "consumer_lag", severity: "warn", scope: r.consumer as string, detail: `${Math.round(lag)} s behind the head` });
    }
    const gaps = await c.sql`select body->>'source' source, count(*)::int n from tape.events where topic = 'system.gap' and seen_time > ${new Date(now - 900_000).toISOString()} group by 1`;
    for (const g of gaps) findings.push({ code: "data_gap", severity: "warn", scope: g.source as string, detail: `${g.n} gaps in 15 min` });
    // B8: an archive that is more than one hour past the oldest hot partition's window
    const windowHours = configValues().retention.hot_window_hours;
    const parts = (await c.sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tape' and c.relkind = 'r' and c.relname ~ '^events_p_[0-9]{10}_inputs_hot$'`) as unknown as { relname: string }[];
    let oldest = Number.POSITIVE_INFINITY;
    for (const p of parts) {
      const t = /events_p_(\d{10})_inputs_hot/.exec(p.relname)?.[1];
      if (!t) continue;
      oldest = Math.min(oldest, Date.UTC(Number(t.slice(0, 4)), Number(t.slice(4, 6)) - 1, Number(t.slice(6, 8)), Number(t.slice(8, 10)) + 1));
    }
    if (Number.isFinite(oldest)) {
      const lag = Math.max(0, Math.round((now - (oldest + windowHours * 3_600_000)) / 1000));
      if (lag > 3600) findings.push({ code: "archive_lag", severity: "warn", scope: "archive", detail: `${Math.round(lag / 60)} min past the hot window` });
    }
    return { at: c.clock.iso(), findings };
  }),

  tool("ledger_summary", [CAP.report], "Closed positions and paper posts over the last day.", {}, async (_a, c) => {
    const since = new Date(c.clock.now() - 86_400_000).toISOString();
    const [p] = await c.sql`select count(*)::int closed, count(*) filter (where net_sol > 0)::int wins, coalesce(sum(net_sol), 0)::float net_sol from mind.positions where closed_at >= ${since}`;
    const [o] = await c.sql`select count(*)::int open from mind.positions where closed_at is null`;
    const [q] = await c.sql`select count(*)::int posts from tape.events where topic = 'post.queued' and seen_time >= ${since}`;
    return { since, ...p, ...o, ...q };
  }),

  tool("integrity_evidence", [CAP.integrity], "A live integrity finding with the events it rests on.", { finding_id: z.string() }, async (a, c) => {
    const [s] = await c.sql`select id, kind, subject, value, confidence, inputs from board.signals where id = ${a.finding_id} and kind = 'integrity.finding'`;
    if (!s) throw new Refusal("not_found", `no finding ${a.finding_id}`);
    const evidence = await c.sql`select id, topic, seen_time, subject, left(body::text, 600) body from tape.events where id = any(${s.inputs as string[]}) order by seen_time limit 20`;
    return { finding: s, evidence };
  }),

  tool("soul_read", [CAP.soul, CAP.report], "The current soul: version, hash and text.", {}, async (_a, c) => {
    const r = await latestSoul(c.sql);
    return { version: r.version, sha256: r.sha256, chain_sha256: r.chain_sha256, body: r.body };
  }),

  // ----- writes: synthesis and swarm -----
  tool("emit_synthesis_feed", [CAP.synth], "Write a feed synthesis. Claims that cite nothing, cite a callout outside the run's window, or fail the text check are dropped.", {
    synthesis_id: z.string(), as_of: iso, window_min: z.number().min(1).max(1440), preset: z.string(), dropped_before: z.number().int().min(0).default(0),
    narratives: z.array(z.object({ title: z.string().max(120), summary: z.string().max(600), cites: Cites })).max(12),
    coin_stances: z.array(z.object({ mint: z.string(), symbol: z.string().nullable(), stance: Stance, why: z.string().max(400), cites: Cites })).max(30),
    suspicious: z.array(z.object({ pattern: z.string().max(40), text: z.string().max(400), cites: Cites })).max(12),
  }, async (a, c) => {
    const found = await citedCallouts(c, [...a.narratives, ...a.coin_stances, ...a.suspicious].flatMap((x) => x.cites), windowOf(c, a));
    const narratives = passClaims(a.narratives, ["title", "summary"], (x) => cited(found, x.cites));
    const coin_stances = passClaims(a.coin_stances, ["symbol", "why"], (x) => cited(found, x.cites, x.mint));
    const suspicious = passClaims(a.suspicious, ["pattern", "text"], (x) => cited(found, x.cites));
    const kept = narratives.length + coin_stances.length + suspicious.length;
    const total = a.narratives.length + a.coin_stances.length + a.suspicious.length + a.dropped_before;
    c.tape.emit("synthesis.feed", { synthesis_id: a.synthesis_id, window_min: a.window_min, preset: a.preset, narratives, coin_stances, suspicious, claims_total: total, claims_dropped: total - kept }, { source: source(c), subject: "global", dedupe: `synthesis.feed:${a.synthesis_id}` });
    const mood = moodOf(coin_stances);
    if (mood.n_callouts) c.tape.emit("mood.feed", { synthesis_id: a.synthesis_id, ...mood }, { source: source(c), subject: "global", dedupe: `mood.feed:${a.synthesis_id}` });
    await c.tape.flush();
    return { claims_kept: kept, claims_dropped: total - kept, mood: mood.n_callouts ? mood : null };
  }),

  tool("emit_synthesis_coin", [CAP.synth], "Write a coin synthesis. Claims must cite callouts on that coin seen inside the run's window and pass the text check.", {
    synthesis_id: z.string(), mint: z.string(), as_of: iso, window_min: z.number().min(1).max(1440), stance: Stance, narrative: z.string().max(600), preset: z.string(), dropped_before: z.number().int().min(0).default(0),
    claims: z.array(z.object({ text: z.string().max(400), cites: Cites })).max(20),
  }, async (a, c) => {
    const narrative = requireText("narrative", a.narrative);
    const found = await citedCallouts(c, a.claims.flatMap((x) => x.cites), windowOf(c, a));
    const claims = passClaims(a.claims, ["text"], (x) => cited(found, x.cites, a.mint));
    const total = a.claims.length + a.dropped_before;
    c.tape.emit("synthesis.coin", { synthesis_id: a.synthesis_id, mint: a.mint, stance: a.stance, narrative, claims, claims_total: total, claims_dropped: total - claims.length, preset: a.preset }, { source: source(c), subject: a.mint, dedupe: `synthesis.coin:${a.synthesis_id}` });
    await c.tape.flush();
    return { claims_kept: claims.length, claims_dropped: total - claims.length };
  }),

  tool("emit_forum_line", [CAP.synth], "Write one forum line (the live debate shown on /synthesis).", { synthesis_id: z.string(), as_of: iso, window_min: z.number().min(1).max(1440), round: z.number().int(), agent: z.enum(["insight", "query", "media", "host"]), text: z.string().max(600), cites: Cites }, async (a, c) => {
    const text = requireText("forum line", a.text);
    const found = await citedCallouts(c, a.cites, windowOf(c, a));
    c.tape.emit("synthesis.forum_line", { ...a, text, cites: a.cites.filter((id) => found.has(id)) }, { source: source(c), subject: a.synthesis_id });
    await c.tape.flush();
    return { ok: true };
  }),

  tool("emit_swarm_result", [CAP.swarm], "Write a swarm run from its raw per-sample counts; core computes the wave probability and impact over full samples. SIMULATED.", {
    swarm_id: z.string(), mint: z.string(), preset: z.string(), usd: z.number().min(0),
    samples: z.array(z.strictObject({ branch: z.enum(["A", "B"]), callers: z.number().int().min(0), actions: z.number().int().min(0), net_lamports: z.number(), truncated: z.boolean() })).min(1).max(50),
    posts: z.array(z.object({ branch: z.enum(["A", "B"]), platform: SwarmPlatform, round: z.number().int(), agent: z.string().max(60), archetype: z.string().max(40), text: z.string().max(280) })).max(400),
  }, async (a, c) => {
    const subject = a.mint;
    // D6: every number from the raw counts, over full samples only (a sample cut short saw fewer rounds)
    const full = a.samples.filter((s) => !s.truncated);
    const [A, B] = [full.filter((s) => s.branch === "A"), full.filter((s) => s.branch === "B")];
    if (!A.length) throw new Refusal("no_full_samples", "no full branch A sample: no wave probability");
    const wave_p = A.filter((s) => s.callers >= WAVE_CALLERS).length / A.length;
    const impact = B.length ? { d_callers: mean(B.map((s) => s.callers)) - mean(A.map((s) => s.callers)), d_net_sol: (mean(B.map((s) => s.net_lamports)) - mean(A.map((s) => s.net_lamports))) / 1e9 } : null; // no full B sample: no impact
    const truncated = full.length < a.samples.length;
    c.tape.emit("swarm.wave_p", { swarm_id: a.swarm_id, mint: a.mint, wave_p, samples: A.length, preset: a.preset, usd: a.usd, truncated }, { source: source(c), subject, dedupe: `swarm.wave_p:${a.swarm_id}` });
    if (impact) c.tape.emit("swarm.impact", { swarm_id: a.swarm_id, mint: a.mint, ...impact, samples: A.length, truncated }, { source: source(c), subject, dedupe: `swarm.impact:${a.swarm_id}` });
    let refused = 0;
    a.posts.forEach((p, i) => {
      const kept = passClaim(p, ["agent", "archetype", "text"]);
      if (!kept) {
        refused++;
        return;
      }
      c.tape.emit("swarm.post", { swarm_id: a.swarm_id, mint: a.mint, ...kept, simulated: true }, { source: source(c), subject, dedupe: `swarm.post:${a.swarm_id}:${i}` });
    });
    await c.tape.flush();
    return { wave_p, ...impact, samples: A.length, truncated, posts_written: a.posts.length - refused, posts_refused: refused };
  }, { strict: true }),

  tool("emit_swarm_beliefs", [CAP.swarm], "Write a swarm run's belief drift: mean stance per archetype per round, per branch and sample. SIMULATED.", {
    swarm_id: z.string(), mint: z.string(), topic: z.string().max(40),
    branches: z.record(z.string(), z.array(z.array(z.object({ round: z.number().int(), stance: z.record(z.string(), z.number().min(-1).max(1)) })).max(50)).max(10)),
  }, async (a, c) => {
    c.tape.emit("swarm.beliefs", { ...a, topic: requireText("topic", a.topic), simulated: true }, { source: source(c), subject: a.mint, dedupe: `swarm.beliefs:${a.swarm_id}` });
    await c.tape.flush();
    return { ok: true };
  }),

  // ----- writes: proposals, alerts, drafts -----
  tool("propose_strategy", [CAP.propose], "Propose a strategy spec. Core validates it; a valid proposal is only a record.", { spec: z.record(z.string(), z.unknown()), why: z.array(z.string().max(300)).min(1).max(8), because: z.array(z.string()).max(12).default([]) }, async (a, c) => {
    const v = validateSpec(a.spec);
    if (!v.ok) throw new Refusal("bad_spec", v.reasons.join("; "));
    const why = a.why.map((w) => requireText("why", w));
    const proposal_id = c.clock.id("strategy");
    c.tape.emit("proposal.strategy", { proposal_id, by: source(c), spec: v.spec as unknown as Record<string, unknown>, why, because: a.because }, { source: source(c), subject: proposal_id, causes: a.because });
    await c.tape.flush();
    return { proposal_id };
  }),

  tool("propose_question", [CAP.jev], "Propose a Jev question; it starts in shadow.", { pack: z.enum(["callout", "coin", "callers", "entry", "exit", "reply", "link"]), text: z.string().min(10).max(200), type: z.enum(["yes_no", "probability"]) }, async (a, c) => {
    const text = requireText("question", a.text);
    if (!text.trim().endsWith("?")) throw new Refusal("guard", "question refused: not_a_question");
    const question_id = c.clock.id("task");
    c.tape.emit("jevq.proposed", { question_id, pack: a.pack, text, type: a.type, by: source(c) }, { source: source(c), subject: question_id });
    await c.tape.flush();
    return { question_id };
  }),

  tool("ops_alert", [CAP.ops], "Alert the owner.", { severity: z.enum(["info", "warn", "page"]), text: z.string().min(5).max(500), finding: z.string().max(120) }, async (a, c) => {
    const b = { ...a, text: requireText("alert", a.text), finding: requireText("finding", a.finding) };
    c.tape.emit("ops.alert", b, { source: source(c), subject: b.finding });
    await c.tape.flush();
    return { ok: true };
  }),

  tool("ops_stop", [CAP.ops], "Ask for a pause or a kill. Stopping only; nothing here can start anything.", { action: z.enum(["pause", "kill"]), scope: z.string().max(60), reason: z.string().min(5).max(300) }, async (a, c) => {
    const b = { ...a, scope: requireText("scope", a.scope), reason: requireText("reason", a.reason) };
    c.tape.emit("ops.stop_requested", b, { source: source(c), subject: b.scope });
    await c.tape.flush();
    return { ok: true };
  }),

  tool("ops_restart_request", [CAP.ops], "Ask the owner to restart one consumer or sense. A request only: nothing here restarts anything.", { scope: z.string().max(60), reason: z.string().min(5).max(300) }, async (a, c) => {
    const b = { scope: requireText("scope", a.scope), reason: requireText("reason", a.reason) };
    c.tape.emit("ops.restart_requested", b, { source: source(c), subject: b.scope });
    await c.tape.flush();
    return { ok: true };
  }),

  tool("draft_report", [CAP.report], "Store the daily report draft after the prose Guard.", { day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), text: z.string().min(20).max(4000) }, async (a, c) => {
    const text = requireText("report", a.text);
    const report_id = c.clock.id("task");
    c.tape.emit("report.drafted", { report_id, day: a.day, text, checks: ["length", "no_emoji", "no_dash", "no_promise", "no_person"] }, { source: source(c), subject: report_id, dedupe: `report:${a.day}` });
    await c.tape.flush();
    return { report_id };
  }),

  tool("write_integrity_text", [CAP.integrity], "Store prose for a live integrity finding at confidence 0.85 or more. States data; names no person.", { finding_id: z.string(), text: z.string().min(20).max(1200) }, async (a, c) => {
    const [s] = await c.sql`select confidence from board.signals where id = ${a.finding_id} and kind = 'integrity.finding'`;
    if (!s) throw new Refusal("not_found", `no finding ${a.finding_id}`);
    if ((s.confidence as number) < 0.85) throw new Refusal("below_threshold", "findings under 0.85 are not written up");
    const text = requireText("text", a.text);
    c.tape.emit("integrity.text", { finding_id: a.finding_id, text, checks: ["length", "no_emoji", "no_dash", "no_promise", "no_person"] }, { source: source(c), subject: a.finding_id, dedupe: `integrity.text:${a.finding_id}` });
    await c.tape.flush();
    return { ok: true };
  }),

  // ----- report exchange (docs/SLOW-MIND.md section 6): one envelope on the Tape, the body in slow.reports -----
  tool("report_publish", [CAP.exchange], "Publish a finished BettaFish or MiroShark report. Cites must be callouts or events seen already; the summary passes the prose Guard.", {
    report_id: z.string().min(4).max(80), producer: z.enum(["bettafish.insight", "bettafish.query", "bettafish.media", "bettafish.report", "miroshark.report", "miroshark.signal"]),
    kind: z.enum(["feed", "coin", "swarm"]), subject: z.string().min(1).max(64), window_from: iso.nullable().default(null), window_to: iso.nullable().default(null), preset: z.string().max(20),
    summary: z.string().min(10).max(600), cites: z.array(z.string()).max(200).default([]), parent_reports: z.array(z.string()).max(20).default([]),
    ir: z.record(z.string(), z.unknown()).nullable().default(null), markdown: z.string().max(400_000).nullable().default(null), simulated: z.boolean().default(false),
  }, async (a, c) => {
    const summary = requireText("summary", a.summary);
    const markdown = a.markdown === null ? null : requireText("markdown", a.markdown);
    const now = c.clock.iso();
    const callouts = a.cites.length ? new Set((await c.sql`select callout_id from mem.callouts where callout_id = any(${a.cites}) and seen_at <= ${now}
      and (${a.window_from}::timestamptz is null or seen_at >= ${a.window_from}) and (${a.window_to}::timestamptz is null or seen_at <= ${a.window_to})`).map((r) => r.callout_id as string)) : new Set<string>();
    const events = a.cites.length ? new Set((await c.sql`select id from tape.events where id = any(${a.cites}) and seen_time <= ${now}`).map((r) => r.id as string)) : new Set<string>();
    const cites = a.cites.filter((x) => callouts.has(x) || events.has(x));
    const parents = a.parent_reports.length ? (await c.sql`select report_id from slow.reports where report_id = any(${a.parent_reports}) and published_at <= ${now}`).map((r) => r.report_id as string) : [];
    if (parents.length !== a.parent_reports.length) throw new Refusal("bad_parent", "a parent report is unknown or newer than now");
    const body = { ir: a.ir, markdown };
    const sha256 = (await import("node:crypto")).createHash("sha256").update(canonical(body)).digest("hex");
    await c.sql`insert into slow.reports (report_id, producer, kind, subject, window_from, window_to, preset, sha256, summary, cites, parent_reports, ir, markdown, published_at)
      values (${a.report_id}, ${a.producer}, ${a.kind}, ${a.subject}, ${a.window_from}, ${a.window_to}, ${a.preset}, ${sha256}, ${summary}, ${cites}, ${parents}, ${a.ir ? c.sql.json(a.ir as never) : null}, ${markdown}, ${now})
      on conflict (report_id) do nothing`;
    c.tape.emit("report.published", { report_id: a.report_id, producer: a.producer, kind: a.kind, subject: a.subject, window_from: a.window_from, window_to: a.window_to, preset: a.preset, sha256, summary, cites, parent_reports: parents, simulated: a.simulated, cites_dropped: a.cites.length - cites.length }, { source: source(c), subject: a.subject, dedupe: `report:${a.report_id}` });
    await c.tape.flush();
    return { report_id: a.report_id, sha256, cites_kept: cites.length, cites_dropped: a.cites.length - cites.length };
  }),

  tool("reports_for", [CAP.synth, CAP.swarm, CAP.swarmRead, CAP.exchange, CAP.report], "The newest published reports for a subject (a mint or global), optionally from one producer family.", { subject: z.string(), producer_prefix: z.string().max(20).optional(), limit: z.number().int().min(1).max(10).default(3) }, async (a, c) => ({
    reports: await c.sql`select report_id, producer, kind, subject, preset, sha256, summary, cites, parent_reports, ir, markdown, published_at from slow.reports
      where subject = ${a.subject} and published_at <= ${c.clock.iso()} and (${a.producer_prefix ?? ""} = '' or producer like ${`${a.producer_prefix ?? ""}%`})
      order by published_at desc limit ${a.limit}`,
  })),

  tool("soul_update", [CAP.soul], "Replace SOUL.md with a new version. Validated, hashed and chained.", { text: z.string().min(200), reason: z.string().min(5).max(300) }, async (a, c) => {
    const r = await updateSoul(c.sql, c.tape, c.soulFile, { text: a.text, reason: a.reason, by: "agent" });
    if (!r.ok) throw new Refusal("invalid_soul", r.reasons.join("; "));
    return r;
  }),

  tool("job_event", ANY_LANE, "Record that a job was queued, started or done.", { kind: z.enum(["queued", "started", "done"]), job_id: z.string(), agent: z.string().max(40), trigger_event: z.string().nullable().default(null), cost_usd: z.number().min(0).optional(), error: z.string().max(300).optional() }, async (a, c) => {
    const { kind, ...rest } = a;
    const body = { ...rest, agent: requireText("agent", rest.agent), ...(rest.error === undefined ? {} : { error: requireText("error", rest.error) }) };
    c.tape.emit(`job.${kind}`, body, { source: source(c), subject: a.job_id });
    await c.tape.flush();
    return { ok: true };
  }),
];

export type CallResult = { ok: true; value: unknown } | { ok: false; code: string; message: string };

export class Toolbox {
  constructor(readonly ctx: Omit<ToolCtx, "cap">, readonly tokens: Map<string, string>) {}

  capOf(token: string | null | undefined): string | null {
    if (!token) return null;
    const digest = (x: string) => crypto.createHash("sha256").update(x).digest();
    const want = digest(token);
    for (const [t, cap] of this.tokens) if (crypto.timingSafeEqual(digest(t), want)) return cap;
    return null;
  }

  list(cap: string): Tool[] {
    return TOOLS.filter((t) => t.caps.includes(cap));
  }

  async call(token: string | null | undefined, name: string, args: unknown): Promise<CallResult> {
    const cap = this.capOf(token);
    if (!cap) return { ok: false, code: "unauthorized", message: "unknown token" };
    const t = TOOLS.find((x) => x.name === name);
    if (!t) return { ok: false, code: "unknown_tool", message: `no tool ${name}` };
    if (!t.caps.includes(cap)) {
      this.ctx.tape.emit("system.note", { kind: "mcp.refused", detail: { cap, tool: name } }, { source: SOURCE[cap] ?? "agents", subject: cap });
      return { ok: false, code: "out_of_lane", message: `${name} is not available to ${cap}` };
    }
    const parsed = t.input.safeParse(args ?? {});
    if (!parsed.success) return { ok: false, code: "bad_args", message: parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    try {
      return { ok: true, value: await t.run(parsed.data as never, { ...this.ctx, cap }) };
    } catch (err) {
      if (err instanceof Refusal) return { ok: false, code: err.code, message: err.message };
      return { ok: false, code: "internal", message: String(err).slice(0, 300) };
    }
  }
}
