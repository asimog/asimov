// Scorekeeper (docs/07): what happened after each callout, at compressed horizons, by methodology ov2, and how well
// the probability signals predicted it (Brier). Every number is computed from the Tape alone, bounded by seen_time,
// only after the horizon has passed on the Clock: no lookahead. A late system.gap supersedes outcomes; it never edits them.
import type { BodyOf, Envelope } from "@asimog/contracts";
import { liveFor } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import { fillBuy, fillSell } from "../mind/fill.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";

const HORIZONS = (env.opt("OUTCOME_HORIZONS_MIN") ?? "1,3,5").split(",").map(Number);
const SCORE_EVERY_MS = env.int("SCORE_EVERY_S", 60) * 1000;
const STALE_MS = env.int("ENTRY_STALE_S", 60) * 1000;
const GRACE_MS = env.int("OUTCOME_GRACE_S", 60) * 1000;
export const REF_SOL = env.num("OUTCOME_REF_SOL", 0.02);
const PROB_KINDS = ["hawkes.wave_p", "callers.wave_p"];
const PRECALL = "precall.callout_p";

type Prob = { kind: string; p: number; n: number; horizon_min: number };
type Watch = { callout_id: string; event_id: string; mint: string; author: string | null; created_ms: number; t0_ms: number; probs: Prob[]; done: number[] };
type Outcome = BodyOf<"outcome.measured">;
type Pt = { id: string; at: number; p: number; amm: boolean };
type Pre = { signal_id: string; mint: string; at_ms: number; p: number; horizon_min: number };

const iso = (ms: number) => new Date(ms).toISOString();

/** Gaps known at `nowIso` that overlap [fromMs, toMs] for this coin. */
/** Trade gaps only (a callout-feed gap does not hide trades). A gap reported again with a `to` closes the open one. */
async function gapsFor(tx: Tx, mint: string, fromMs: number, toMs: number, nowIso: string): Promise<string[]> {
  const rows = await tx`select id from (
      select distinct on (coalesce(body->>'scope', ''), body->>'from') id, body, seen_time from tape.events
      where topic = 'system.gap' and seen_time <= ${nowIso} and body->>'source' in ('trades', 'rpc')
        and (body->>'scope' is null or body->>'scope' = ${mint})
      order by coalesce(body->>'scope', ''), body->>'from', seen_time desc, id desc) g
    where (body->>'from')::timestamptz <= ${iso(toMs)} and coalesce((body->>'to')::timestamptz, 'infinity') >= ${iso(fromMs)}
    order by seen_time, id`;
  return rows.map((r) => r.id as string);
}

/** Methodology ov2 (docs/07 scorekeeper). */
async function measure(tx: Tx, w: Watch, h: number, nowIso: string): Promise<Outcome> {
  const end = w.t0_ms + h * 60_000;
  // a backfilled (rpc) trade sits at its event_time; it counts once it was seen, which is before this resolution
  const at = tx`case when source = 'rpc' then event_time else seen_time end`;
  const rows = await tx`select id, topic, ${at} at, (body->>'price_sol')::float p from tape.events
    where subject = ${w.mint} and topic in ('trade.curve', 'trade.amm') and seen_time <= ${nowIso} and ${at} > ${iso(w.t0_ms - STALE_MS)} and ${at} <= ${iso(end)}
      and (body->>'price_sol')::float > 0 order by 3, id`; // a zero price is a feed glitch, never an entry
  const pts: Pt[] = rows.map((r) => ({ id: r.id as string, at: (r.at as Date).getTime(), p: r.p as number, amm: r.topic === "trade.amm" }));
  const [pre] = await tx`select count(*)::int n from tape.events where subject = ${w.mint} and topic in ('trade.curve', 'trade.amm') and seen_time <= ${nowIso} and ${at} < ${iso(w.t0_ms)}`;
  const [nc] = await tx`select count(distinct body->>'author_wallet')::int n from tape.events where topic = 'callout.created'
    and seen_time > ${iso(w.t0_ms)} and seen_time <= ${iso(end)} and body->>'mint' = ${w.mint} and body->>'callout_id' <> ${w.callout_id}`;
  const before = pts.filter((x) => x.at <= w.t0_ms);
  let entry = before.at(-1) ?? null;
  const basis: Outcome["entry_basis"] = entry ? "last_before" : pts.length ? "first_after" : "none";
  if (!entry) entry = pts[0] ?? null;
  const path = entry ? pts.filter((x) => x.at > entry!.at) : [];
  const gaps = await gapsFor(tx, w.mint, w.t0_ms - STALE_MS, end, nowIso);
  const coverage: Outcome["coverage"] = gaps.length ? "gap" : !entry ? "no_entry" : !path.length ? "no_trades" : "ok";
  const base = {
    method: "ov2" as const, callout_id: w.callout_id, mint: w.mint, author_wallet: w.author, horizon_min: h, t0: iso(w.t0_ms),
    call_lag_ms: Number.isFinite(w.created_ms) ? w.t0_ms - w.created_ms : null, entry_basis: basis, ref_sol: REF_SOL,
    trades: path.length, pre_call_trades: (pre?.n as number) ?? 0, new_callouts: (nc?.n as number) ?? 0, coverage, gaps, supersedes: null,
  };
  if (!entry || !path.length)
    return { ...base, price0_sol: entry?.p ?? null, price_sol: null, multiple: null, peak_multiple: null, trough_multiple: null, t_peak_s: null, net_multiple: null, phase: entry ? (entry.amm ? "amm" : "curve") : null, graduated: false };
  const last = path.at(-1)!;
  const peak = path.reduce((a, b) => (b.p > a.p ? b : a));
  const trough = path.reduce((a, b) => (b.p < a.p ? b : a));
  const buy = fillBuy({ price_sol: entry.p, at_ms: entry.at, graduated: entry.amm }, REF_SOL);
  const sell = fillSell({ price_sol: last.p, at_ms: last.at, graduated: last.amm }, buy.tokens);
  return {
    ...base, price0_sol: entry.p, price_sol: last.p, multiple: last.p / entry.p, peak_multiple: peak.p / entry.p, trough_multiple: trough.p / entry.p,
    t_peak_s: (peak.at - w.t0_ms) / 1000, net_multiple: sell.sol / buy.spent_sol, phase: entry.amm ? "amm" : "curve", graduated: !entry.amm && path.some((x) => x.amm),
  };
}

export function scorekeeper(tape: Tape, clock: Clock): Consumer & { stats: Record<string, number> } {
  const stats = { watched: 0, outcomes: 0, corrected: 0, scored: 0, precall: 0 };
  let pre: Pre[] = [];
  let preCursor = { at: new Date(0).toISOString(), id: "" };
  let preSec = -1; // pre-call watches tick once per second of Tape time
  let loaded = false;
  const watches = new Map<string, Watch[]>();
  let scoredBucket = -1;

  async function load(tx: Tx) {
    watches.clear();
    for (const r of await tx`select * from mind.outcome_watch where cardinality(done) < ${HORIZONS.length} order by at, event_id`) {
      const w: Watch = { callout_id: r.callout_id as string, event_id: r.event_id as string, mint: r.mint as string, author: r.author as string | null, created_ms: (r.created_at as Date).getTime(), t0_ms: (r.at as Date).getTime(), probs: r.probs as Prob[], done: r.done as number[] };
      (watches.get(w.mint) ?? watches.set(w.mint, []).get(w.mint)!).push(w);
    }
    pre = (await tx`select * from mind.precall_watch where not done order by at, signal_id`).map((r) => ({ signal_id: r.signal_id as string, mint: r.mint as string, at_ms: (r.at as Date).getTime(), p: r.p as number, horizon_min: r.horizon_min as number }));
    const [c] = await tx`select at, signal_id from mind.precall_watch order by at desc, signal_id desc limit 1`;
    preCursor = c ? { at: (c.at as Date).toISOString(), id: c.signal_id as string } : { at: new Date(0).toISOString(), id: "" };
    const [s] = await tx`select max(seen_time) at from tape.events where topic = 'score.updated'`;
    scoredBucket = s?.at ? Math.floor((s.at as Date).getTime() / SCORE_EVERY_MS) : -1;
    loaded = true;
  }

  async function resolve(tx: Tx, w: Watch, now: number, e: Envelope) {
    for (const h of HORIZONS) {
      if (w.done.includes(h) || now < w.t0_ms + h * 60_000) continue;
      const o = await measure(tx, w, h, e.seen_time);
      await tape.emitIn(tx, "outcome.measured", o, { source: "scorekeeper", subject: w.callout_id, causes: [w.event_id, e.id], after: e.seen_time });
      stats.outcomes++;
      if (o.coverage !== "gap")
        for (const pr of w.probs.filter((x) => x.horizon_min === h)) {
          const hit = o.new_callouts >= pr.n ? 1 : 0;
          await tx`insert into mind.scores (kind, horizon_min, n, brier_sum, hits, p_sum) values (${pr.kind}, ${h}, 1, ${(pr.p - hit) ** 2}, ${hit}, ${pr.p})
            on conflict (kind, horizon_min) do update set n = mind.scores.n + 1, brier_sum = mind.scores.brier_sum + excluded.brier_sum,
              hits = mind.scores.hits + excluded.hits, p_sum = mind.scores.p_sum + excluded.p_sum`;
          stats.scored++;
        }
      w.done.push(h);
    }
    await tx`update mind.outcome_watch set done = ${w.done} where callout_id = ${w.callout_id}`;
    if (w.done.length === HORIZONS.length) {
      const list = watches.get(w.mint)!;
      list.splice(list.indexOf(w), 1);
      if (!list.length) watches.delete(w.mint);
    }
  }

  /** A gap reported after outcomes were written: append corrections that supersede them. */
  async function correct(tx: Tx, e: Envelope) {
    const g = e.body as BodyOf<"system.gap">;
    if (g.source !== "trades" && g.source !== "rpc") return; // the callout feed's gaps do not hide trades
    const rows = await tx`select distinct on (body->>'callout_id', body->>'horizon_min') id, body from tape.events
      where topic = 'outcome.measured' and seen_time < ${e.seen_time} ${g.scope ? tx`and body->>'mint' = ${g.scope}` : tx``}
      order by body->>'callout_id', body->>'horizon_min', seen_time desc, id desc`;
    for (const r of rows) {
      const o = r.body as Outcome;
      const t0 = Date.parse(o.t0);
      if (o.coverage === "gap" || Date.parse(g.from) > t0 + o.horizon_min * 60_000 || (g.to && Date.parse(g.to) < t0 - STALE_MS)) continue;
      await tape.emitIn(tx, "outcome.measured", { ...o, coverage: "gap", gaps: [e.id], supersedes: r.id as string }, { source: "scorekeeper", subject: o.callout_id, causes: [e.id, r.id as string], after: e.seen_time });
      stats.corrected++;
    }
  }

  /** Brier for precall.callout_p (docs/07 precall): hit = any callout on the coin within the horizon after the signal. */
  async function precallTick(tx: Tx, nowIso: string) {
    const now = Date.parse(nowIso);
    const fresh = await tx`select id, subject, produced_at, (value->>'p')::float p, (value->>'horizon_min')::int h from board.signals
      where kind = ${PRECALL} and (produced_at, id) > (${preCursor.at}, ${preCursor.id}) and produced_at <= ${nowIso} order by produced_at, id`;
    for (const r of fresh) {
      const w: Pre = { signal_id: r.id as string, mint: r.subject as string, at_ms: (r.produced_at as Date).getTime(), p: r.p as number, horizon_min: r.h as number };
      await tx`insert into mind.precall_watch (signal_id, mint, at, p, horizon_min) values (${w.signal_id}, ${w.mint}, ${iso(w.at_ms)}, ${w.p}, ${w.horizon_min}) on conflict do nothing`;
      pre.push(w);
      preCursor = { at: iso(w.at_ms), id: w.signal_id };
    }
    for (const w of pre.filter((x) => now >= x.at_ms + x.horizon_min * 60_000)) {
      const [c] = await tx`select count(*)::int n from tape.events where topic = 'callout.created' and body->>'mint' = ${w.mint}
        and seen_time > ${iso(w.at_ms)} and seen_time <= ${iso(w.at_ms + w.horizon_min * 60_000)}`;
      const hit = (c!.n as number) > 0 ? 1 : 0;
      await tx`insert into mind.scores (kind, horizon_min, n, brier_sum, hits, p_sum) values (${PRECALL}, ${w.horizon_min}, 1, ${(w.p - hit) ** 2}, ${hit}, ${w.p})
        on conflict (kind, horizon_min) do update set n = mind.scores.n + 1, brier_sum = mind.scores.brier_sum + excluded.brier_sum,
          hits = mind.scores.hits + excluded.hits, p_sum = mind.scores.p_sum + excluded.p_sum`;
      await tx`update mind.precall_watch set done = true where signal_id = ${w.signal_id}`;
      pre.splice(pre.indexOf(w), 1);
      stats.precall++;
    }
  }

  async function publishScores(tx: Tx, e: Envelope) {
    for (const r of await tx`select * from mind.scores where n > 0 order by kind, horizon_min`) {
      const n = r.n as number;
      const base = (r.hits as number) / n;
      const brier = (r.brier_sum as number) / n;
      const ref = base * (1 - base);
      await tape.emitIn(tx, "score.updated", { kind: r.kind as string, horizon_min: r.horizon_min as number, n, brier, base_rate: base, skill: ref > 0 ? 1 - brier / ref : null }, { source: "scorekeeper", subject: r.kind as string, causes: [e.id], after: e.seen_time });
    }
  }

  return {
    name: "scorekeeper",
    startAtHead: true,
    topics: ["callout.created", "post.queued", "trade.curve", "trade.amm", "system.gap"],
    batch: 1000,
    stats,
    async handle(events, tx) {
      try {
        if (!loaded) await load(tx);
        for (const e of events) {
          const now = Date.parse(e.seen_time);
          clock.advance?.(now);
          const bucket = Math.floor(now / SCORE_EVERY_MS);
          if (scoredBucket < 0) scoredBucket = bucket;
          if (bucket > scoredBucket) {
            scoredBucket = bucket;
            await publishScores(tx, e);
          }
          // quiet coins: resolve once the horizon plus a grace period has passed
          // (sorted, so the order never depends on map history: a restarted consumer resolves in the same order)
          if (Math.floor(now / 1000) !== preSec) {
            preSec = Math.floor(now / 1000);
            await precallTick(tx, e.seen_time);
          }
          const due = [...watches.values()].flat().filter((w) => HORIZONS.some((h) => !w.done.includes(h) && now >= w.t0_ms + h * 60_000 + GRACE_MS));
          for (const w of due.sort((a, b) => a.t0_ms - b.t0_ms || (a.event_id < b.event_id ? -1 : 1))) await resolve(tx, w, now, e);
          if (e.topic === "post.queued") {
            // a house callout (docs/09) is scored like any caller's, as the author `house`
            const b = e.body as BodyOf<"post.queued">;
            if (b.kind === "update") continue;
            // our callouts as `house`; our data replies as `house:reply` (a reply was right when the coin fell)
            const w: Watch = { callout_id: b.house_id, event_id: e.id, mint: b.mint, author: b.kind === "callout" ? "house" : "house:reply", created_ms: now, t0_ms: now, probs: [], done: [] };
            const ins = await tx`insert into mind.outcome_watch (callout_id, event_id, mint, author, created_at, at, probs)
              values (${w.callout_id}, ${w.event_id}, ${w.mint}, ${w.author}, ${e.seen_time}, ${e.seen_time}, '[]') on conflict do nothing returning 1`;
            if (ins.length) {
              (watches.get(w.mint) ?? watches.set(w.mint, []).get(w.mint)!).push(w);
              stats.watched++;
            }
          } else if (e.topic === "callout.created") {
            const b = e.body as BodyOf<"callout.created">;
            if (b.via === "history") continue; // seen long after it was made: no honest t0
            const board = await liveFor(tx, b.mint, e.seen_time);
            const probs: Prob[] = PROB_KINDS.flatMap((k) => {
              const v = board[k]?.value as { p?: number; n?: number; horizon_min?: number } | undefined;
              return v?.p != null && v.n != null && v.horizon_min != null ? [{ kind: k, p: v.p, n: v.n, horizon_min: v.horizon_min }] : [];
            });
            const w: Watch = { callout_id: b.callout_id, event_id: e.id, mint: b.mint, author: b.author_wallet, created_ms: Date.parse(b.created_at), t0_ms: now, probs, done: [] };
            const ins = await tx`insert into mind.outcome_watch (callout_id, event_id, mint, author, created_at, at, probs)
              values (${w.callout_id}, ${w.event_id}, ${w.mint}, ${w.author}, ${b.created_at}, ${e.seen_time}, ${tx.json(probs as never)}) on conflict do nothing returning 1`;
            if (ins.length) {
              (watches.get(w.mint) ?? watches.set(w.mint, []).get(w.mint)!).push(w);
              stats.watched++;
            }
          } else if (e.topic === "system.gap") {
            await correct(tx, e);
          } else {
            for (const w of [...(watches.get((e.body as BodyOf<"trade.curve">).mint) ?? [])])
              if (HORIZONS.some((h) => !w.done.includes(h) && now >= w.t0_ms + h * 60_000)) await resolve(tx, w, now, e);
          }
        }
      } catch (err) {
        loaded = false;
        throw err;
      }
    },
  };
}
