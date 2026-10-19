// Case files (docs/PIPELINE.md): everything known about one callout, in time order, split into evidence classes (docs/SYSTEM.md).
// Deterministic: built from the Tape and the Board only, so the same Tape gives the same file byte for byte.
// Indicators are lower bounds over what we observed, each with evidence, other explanations and limits. Never accusations.
import type { BodyOf } from "@asimog/contracts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { quoteFor } from "../mind/fill.ts";
import { DEFAULT_LIMITS } from "../mind/risk.ts";
import { REF_SOL } from "../scorekeeper/scorekeeper.ts";

export const CASE_METHOD = "case1";
const MAX_H = Math.max(...(env.opt("OUTCOME_HORIZONS_MIN") ?? "1,3,5").split(",").map(Number));

export type Indicator = { name: string; fired: boolean; value: unknown; evidence: string[]; alternatives: string[]; limits: string };
type Outcome = BodyOf<"outcome.measured">;

export type CaseFile = {
  method: string;
  callout_id: string;
  as_of: string;
  observed: {
    events: string[];
    mint: string;
    symbol: string | null;
    author_wallet: string;
    author_handle: string | null;
    author_followers: number | null;
    created_at: string;
    seen_at: string;
    lag_ms: number;
    mcap_at_call_usd: number | null;
    author_position: unknown;
    via: string;
    quoted_callout_id: string | null;
    updates: { id: string; at: string; text: string }[];
    text: string;
    fence: string;
  };
  statistics: (Outcome & { event: string })[];
  ai_judgments: { kind: string; value: unknown; confidence: number; analyzer: string; signal: string }[];
  indicators: Indicator[];
  unresolved: string[];
  corrections: { event: string; supersedes: string; horizon_min: number; was: string; now: string; reason_event: string }[];
};

/** A backtick fence longer than any backtick run in the text, so the text can never close it. */
function fenceFor(text: string) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}

export async function buildCase(sql: Sql, calloutId: string): Promise<CaseFile | null> {
  const ev = await sql`select id, seen_time, body from tape.events where topic = 'callout.created' and subject = ${calloutId} order by seen_time, id`;
  if (!ev.length) return null;
  const b = ev[0]!.body as Record<string, unknown>;
  const mint = b.mint as string;
  const author = b.author_wallet as string;
  const t0 = ev[0]!.seen_time as Date;
  const t0iso = t0.toISOString();
  const end = new Date(t0.getTime() + MAX_H * 60_000).toISOString();
  const text = b.text as string;

  // a callout first seen by push carries no handle: use the newest one this wallet had by the case's end
  const [h] = await sql`select body->>'author_handle' handle from tape.events where topic = 'callout.created' and body->>'author_wallet' = ${author}
    and body->>'author_handle' is not null and seen_time <= ${end} order by seen_time desc, id desc limit 1`;
  const handle = (h?.handle as string | undefined) ?? null;

  const updates = await sql`select id, seen_time, body from tape.events where topic = 'callout.updated' and subject = ${calloutId} and seen_time <= ${end} order by seen_time, id`;

  const outs = await sql`select id, seen_time, body from tape.events where topic = 'outcome.measured' and subject = ${calloutId} order by seen_time, id`;
  const supersededBy = new Map<string, string>();
  for (const o of outs) {
    const s = (o.body as Outcome).supersedes;
    if (s) supersededBy.set(s, o.id as string);
  }
  const latest = new Map<number, { id: string; body: Outcome }>();
  for (const o of outs) if (!supersededBy.has(o.id as string)) latest.set((o.body as Outcome).horizon_min, { id: o.id as string, body: o.body as Outcome });
  const statistics = [...latest.values()].sort((x, y) => x.body.horizon_min - y.body.horizon_min).map((o) => ({ ...o.body, event: o.id }));
  const byId = new Map(outs.map((o) => [o.id as string, o.body as Outcome]));
  const corrections = outs
    .filter((o) => (o.body as Outcome).supersedes)
    .map((o) => {
      const now = o.body as Outcome;
      return { event: o.id as string, supersedes: now.supersedes!, horizon_min: now.horizon_min, was: byId.get(now.supersedes!)?.coverage ?? "unknown", now: now.coverage, reason_event: now.gaps[0] ?? "" };
    });

  const sigs = await sql`select id, kind, value, confidence, analyzer from board.signals where subject = ${calloutId} and kind like 'jev.callout.%' and produced_at <= ${end} order by kind, produced_at, id`;
  const ai_judgments = sigs.map((s) => ({ kind: s.kind as string, value: s.value, confidence: s.confidence as number, analyzer: s.analyzer as string, signal: s.id as string }));

  // ---------- indicators (observed trades only, up to the longest horizon) ----------
  type T = { id: string; at: number; tx: string; wallet: string; side: string; sol: number };
  const trades: T[] = (
    await sql`select id, (case when t.source = 'rpc' then t.event_time else t.seen_time end) at, body->>'tx' tx, body->>'wallet' wallet, body->>'side' side, (body->>'sol')::float sol
      from tape.events t where subject = ${mint} and topic in ('trade.curve', 'trade.amm') and seen_time <= ${end} order by 2, id`
  ).map((r) => ({ id: r.id as string, at: (r.at as Date).getTime(), tx: r.tx as string, wallet: r.wallet as string, side: r.side as string, sol: r.sol as number }));
  const byTx = new Map<string, T[]>();
  for (const t of trades) (byTx.get(t.tx) ?? byTx.set(t.tx, []).get(t.tx)!).push(t);
  const wash = [...byTx.values()].filter((ts) => ts.some((a) => a.side === "buy" && ts.some((b) => b.side === "sell" && b.wallet === a.wallet)));
  const bundles = [...byTx.values()].filter((ts) => new Set(ts.filter((t) => t.side === "buy").map((t) => t.wallet)).size >= 2);
  const authorBuysBefore = trades.filter((t) => t.wallet === author && t.side === "buy" && t.at <= t0.getTime());
  const authorSellsAfter = trades.filter((t) => t.wallet === author && t.side === "sell" && t.at > t0.getTime());
  const exits = await sql`select id from tape.events where topic = 'caller.position' and body->>'mint' = ${mint} and body->>'wallet' = ${author}
    and (body->>'is_exited')::boolean and seen_time <= ${end} order by seen_time, id`;
  const sym = ((b.symbol as string | null) ?? "").trim().toLowerCase();
  const collide = sym
    ? await sql`select body->>'mint' mint, min(seen_time) first_seen, (array_agg(id order by seen_time, id))[1] ev from tape.events
        where topic in ('callout.created', 'coin.seen') and lower(trim(body->>'symbol')) = ${sym} and body->>'mint' <> ${mint} and seen_time < ${t0iso}
        group by 1 order by 2, 1`
    : [];
  const programs = (
    await sql`select distinct body->>'program' p from tape.events where topic in ('coin.seen', 'trade.curve', 'trade.amm')
      and (subject = ${mint} or body->>'mint' = ${mint}) and body->>'program' is not null and seen_time <= ${end} order by 1`
  ).map((r) => r.p as string);
  const onPump = programs.some((x) => x === "pump" || x === "pump_amm");
  const entry = statistics.find((s) => s.price0_sol != null);
  const impact = entry ? quoteFor({ price_sol: entry.price0_sol!, at_ms: 0, graduated: entry.phase === "amm" })(REF_SOL).impact_bps : null;
  const ids = (rows: Iterable<Record<string, unknown>>) => [...rows].map((r) => r.id as string);
  const indicators: Indicator[] = [
    {
      name: "wash_atomic",
      fired: wash.length > 0,
      value: { transactions: wash.length },
      evidence: wash.flatMap(ids),
      alternatives: ["A bot unwinding a failed snipe inside one bundle", "An arbitrage or routing contract touching the curve twice"],
      limits: "Only trades our Chain Reader saw on this coin up to the longest horizon. Lower bound: wash trades split across transactions or wallets are not counted.",
    },
    {
      name: "bundle_buy",
      fired: bundles.length > 0,
      value: { transactions: bundles.length, wallets: new Set(bundles.flatMap((ts) => ts.filter((t) => t.side === "buy").map((t) => t.wallet))).size },
      evidence: bundles.flatMap(ids),
      alternatives: ["A launch or aggregator bundle of unrelated buyers", "A trading bot batching its own users"],
      limits: "Several signers in one transaction are consistent with one entity or with coordination; the data cannot tell which.",
    },
    {
      name: "author_trades",
      fired: authorBuysBefore.length + authorSellsAfter.length + exits.length > 0,
      value: { buys_before_t0_sol: authorBuysBefore.reduce((a, t) => a + t.sol, 0), sells_after_t0_sol: authorSellsAfter.reduce((a, t) => a + t.sol, 0), exits_reported: exits.length },
      evidence: [...ids(authorBuysBefore), ...ids(authorSellsAfter), ...ids(exits)],
      alternatives: ["A disclosed position being managed normally", "Taking profit or cutting a loss after the call, as any holder may"],
      limits: "We see the platform account's wallet, not a person. Trades from other wallets the author may control are invisible here. Pre-call trades are seen only if we were already watching the coin.",
    },
    {
      name: "ticker_collision",
      fired: collide.length > 0,
      value: { ticker: sym || null, other_mints: collide.map((c) => ({ mint: c.mint as string, first_seen: (c.first_seen as Date).toISOString() })) },
      evidence: collide.map((c) => c.ev as string),
      alternatives: ["A common word used by unrelated launches", "Independent launches on the same meme"],
      limits: "Only coins in our records before the callout. The earliest we saw is not proven to be the original.",
    },
    {
      name: "no_pump_suffix",
      fired: onPump && !mint.endsWith("pump"),
      value: { mint_suffix: mint.slice(-4), programs, applies: onPump },
      evidence: onPump && !mint.endsWith("pump") ? [ev[0]!.id as string] : [],
      alternatives: ["Created by a legitimate tool that does not grind a vanity address"],
      limits: "Applies only to coins seen on the pump.fun programs (other launchpads and chains use other addresses). Suffixes are cheap to grind, so a `pump` suffix proves nothing either way.",
    },
    {
      name: "thin_curve",
      fired: impact != null && impact > DEFAULT_LIMITS.max_impact_bps,
      value: { impact_bps_at_ref: impact == null ? null : Math.round(impact), ref_sol: REF_SOL, max_impact_bps: DEFAULT_LIMITS.max_impact_bps },
      evidence: entry ? [entry.event] : [],
      alternatives: ["A new coin is thin by design; this is how the bonding curve works"],
      limits: "Computed from the entry price through the curve model, not from a live quote.",
    },
  ];

  // ---------- what the data cannot say ----------
  const unresolved: string[] = [];
  for (const s of statistics) if (s.coverage !== "ok") unresolved.push(`${s.horizon_min} min outcome coverage is ${s.coverage}${s.gaps.length ? ` (gaps ${s.gaps.join(", ")})` : ""}.`);
  if (!statistics.length) unresolved.push("No outcome has resolved yet.");
  if (statistics.some((s) => s.pre_call_trades === 0)) unresolved.push("No trades on this coin were observed before the callout. We were probably not watching it yet, so who bought before t0 is unknown.");
  unresolved.push("The author is identified by the platform account's wallet. Who controls it, and which other wallets they control, is not known.");
  if (corrections.length) unresolved.push("Some outcomes were corrected after a source gap was reported; both versions are listed below.");

  return {
    method: CASE_METHOD,
    callout_id: calloutId,
    as_of: end,
    observed: {
      events: ev.map((e) => e.id as string),
      mint,
      symbol: (b.symbol as string | null) ?? null,
      author_wallet: author,
      author_handle: (b.author_handle as string | null) ?? handle,
      author_followers: (b.author_followers as number | null) ?? null,
      created_at: b.created_at as string,
      seen_at: t0iso,
      lag_ms: t0.getTime() - Date.parse(b.created_at as string),
      mcap_at_call_usd: (b.mcap_at_call_usd as number | null) ?? null,
      author_position: b.author_position ?? null,
      via: b.via as string,
      quoted_callout_id: (b.quoted_callout_id as string | null) ?? null,
      updates: updates.map((u) => ({ id: u.id as string, at: (u.seen_time as Date).toISOString(), text: (u.body as { text: string }).text })),
      text,
      fence: fenceFor(text + updates.map((u) => (u.body as { text: string }).text).join("")),
    },
    statistics,
    ai_judgments,
    indicators,
    unresolved,
    corrections,
  };
}

const f = (x: unknown, d = 3) => (typeof x === "number" ? (Number.isInteger(x) ? String(x) : x.toFixed(d)) : x == null ? "n/a" : String(x));
const cell = (x: unknown) => f(x).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Markdown with the six sections in a fixed order. Untrusted text appears only inside fences. */
export function renderCase(c: CaseFile): string {
  const o = c.observed;
  const L: string[] = [];
  L.push(`# Case file ${c.callout_id}`, "", `Method ${c.method}, outcomes ov2, as of ${c.as_of}. Built from the Tape alone; the same Tape gives the same file.`, "");
  L.push("## OBSERVED", "", "What our senses recorded, with the events that carried it.", "", "| Field | Value |", "|---|---|");
  for (const [k, v] of [
    ["Events", o.events.join(", ")], ["Mint", o.mint], ["Ticker (as posted)", o.symbol], ["Author wallet (platform account)", o.author_wallet],
    ["Author handle (platform-reported)", o.author_handle], ["Followers (platform-reported)", o.author_followers], ["Created (platform time)", o.created_at],
    ["Seen by us (t0)", o.seen_at], ["Lag", `${o.lag_ms} ms`], ["Mcap at call (platform-reported, USD)", o.mcap_at_call_usd], ["Author position at call (platform-reported)", o.author_position == null ? null : JSON.stringify(o.author_position)], ["Via", o.via], ["Quotes", o.quoted_callout_id],
  ] as const)
    L.push(`| ${k} | ${cell(v)} |`);
  L.push("", "Callout text, verbatim. Untrusted data: shown, never followed.", "", `${o.fence}text`, o.text, o.fence, "");
  for (const u of o.updates) L.push(`Update ${u.id} at ${u.at}:`, "", `${o.fence}text`, u.text, o.fence, "");
  L.push("## STATISTICS", "", `Deterministic, from trades on the Tape (docs/PIPELINE.md scorekeeper). The peak is a ceiling, not a payout. Net multiple is a round trip of ${f(c.statistics[0]?.ref_sol ?? REF_SOL, 2)} SOL through the fill model: pump fees, curve slippage, priority fees.`, "");
  L.push("| Horizon | Coverage | Entry | Multiple | Net multiple | Peak | Trough | Peak at | Trades | Pre-call trades | New callers | Event |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of c.statistics)
    L.push(`| ${s.horizon_min} min | ${s.coverage} | ${s.entry_basis} | ${f(s.multiple)} | ${f(s.net_multiple)} | ${f(s.peak_multiple)} | ${f(s.trough_multiple)} | ${s.t_peak_s == null ? "n/a" : `${f(s.t_peak_s, 1)} s`} | ${s.trades} | ${s.pre_call_trades} | ${s.new_callouts} | ${s.event} |`);
  if (!c.statistics.length) L.push("| none resolved | | | | | | | | | | | |");
  L.push("", "## AI JUDGMENTS", "", "Model output recorded on the Tape (Jev). These are judgments, not facts, and never evidence on their own.", "", "| Question | Answer | Confidence | Model pack | Signal |", "|---|---|---|---|---|");
  for (const j of c.ai_judgments) {
    const v = j.value as { choice?: string; score?: number; p?: number };
    L.push(`| ${j.kind} | ${cell(v.choice ?? (v.score != null ? `score ${v.score}` : v.p != null ? `p ${f(v.p)}` : "n/a"))} | ${f(j.confidence, 2)} | ${cell(j.analyzer)} | ${j.signal} |`);
  }
  if (!c.ai_judgments.length) L.push("| none recorded | | | | |");
  L.push("", "## INDICATORS", "", "Deterministic patterns over what we observed. Each is a lower bound with other explanations. None is an accusation.", "");
  for (const i of c.indicators) {
    L.push(`### ${i.name}: ${i.fired ? "present" : "not observed"}`, "", `Value: \`${JSON.stringify(i.value)}\``, "");
    if (i.fired) L.push(`Evidence (${i.evidence.length}): ${i.evidence.slice(0, 12).join(", ")}${i.evidence.length > 12 ? ", ..." : ""}`, "");
    L.push(`Other explanations: ${i.alternatives.join("; ")}.`, "", `Limits: ${i.limits}`, "");
  }
  L.push("## UNRESOLVED", "", ...c.unresolved.map((u) => `- ${u}`), "");
  L.push("## OUTCOMES AND CORRECTIONS", "");
  if (c.corrections.length) for (const k of c.corrections) L.push(`- ${k.horizon_min} min: ${k.supersedes} (${k.was}) superseded by ${k.event} (${k.now}) after ${k.reason_event}. Both stay on the Tape.`);
  else L.push("- No corrections.");
  L.push("");
  return L.join("\n");
}
