// The escalation gate (docs/SLOW-MIND.md section 3): decides, from numbers computed here, when a coin earns a slow-mind run.
// It writes `jev.escalated` and nothing else; the Slow Bridge turns a `run` grant into jobs. It never blocks a trade: the desk
// reads none of its output.
// Ways it fails: (1) a replay must give the same grants: every input is the Tape, the Board and mind.* as of the event's seen_time,
// and state is rebuilt from the Tape after a restart; (2) a coin storm: one grant per coin per ENTRY_WINDOW_MIN, the hot set
// included, and the Bridge alone owns quota and caps (a grant with no room waits there); (3) value is never proven without a
// control: half the coins, by a stable hash of the mint, are recorded as `control` with no job.
import crypto from "node:crypto";
import type { BodyOf, Envelope } from "@asimog/contracts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { type Bin, binFor, CALIB } from "./calibrate.ts";
import { type BoardValues, boardValues, read, type Spec, scoreOf } from "./dsl.ts";
import { loadLimits } from "./risk.ts";

export type GateConfig = {
  pLow: number; pHigh: number; disagree: number; hotSize: number; hotEveryMs: number; solUsd: number;
  stageUsd: Record<1 | 2, number>; windowMs: number; calloutMs: number; recheckMs: number;
};
export const gateConfig = (): GateConfig => ({
  pLow: env.num("ESC_P_LOW"), pHigh: env.num("ESC_P_HIGH"), disagree: env.num("ESC_DISAGREE"),
  hotSize: env.int("HOT_SET_SIZE"), hotEveryMs: env.num("HOT_SET_EVERY_S") * 1000, solUsd: env.num("SOL_USD"),
  stageUsd: { 1: env.num("SLOW_STAGE1_USD_PER_RUN"), 2: env.num("SLOW_STAGE2_USD_PER_RUN") },
  windowMs: env.int("ENTRY_WINDOW_MIN") * 60_000, calloutMs: env.num("ESC_CALLOUT_S") * 1000, recheckMs: env.num("ESC_RECHECK_MIN") * 60_000,
});

/** The fast probabilities the gate compares: each kind's first [0,1] field. */
const FAST = ["precall.callout_p", "callers.wave_p", "hawkes.wave_p"];
const JOB = { 1: "synthesis_coin", 2: "swarm_run" } as const;
const GATE_TOPICS = ["precall.detected", "coin.watched", "callout.created", "synthesis.coin", "trade.curve"];

/** Control split: sha256(mint) mod 2. Stable across runs, so a coin is always in the same arm. */
export const armOf = (mint: string): "run" | "control" => (crypto.createHash("sha256").update(mint).digest()[31]! % 2 === 0 ? "run" : "control");

type Coin = { reason: "precall" | "smart_buy" | "callout"; at_ms: number; caller: string | null; callout_id: string | null };
type Grant = { stage: 1 | 2; at_ms: number; arm: "run" | "control" };

export function escalationGate(tape: Tape, clock: Clock, cfg: GateConfig = gateConfig()): Consumer & { stats: Record<string, number> } {
  const stats = { grants: 0, control: 0, hot: 0 };
  let pending = { grants: 0, control: 0, hot: 0 }; // this batch's counts, added to stats once it commits
  const coins = new Map<string, Coin>(); // the latest in-play start per mint
  const granted = new Map<string, Grant>(); // the latest grant per mint
  let hotBucket = -1; // the hot set runs once per HOT_SET_EVERY_S bucket of Tape time: the same buckets after a restart
  let loaded = false;

  /** Rebuild state from the Tape before `e`, as an uninterrupted run would have it. */
  async function load(tx: Tx, e: Envelope) {
    coins.clear();
    granted.clear();
    const now = Date.parse(e.seen_time);
    const since = new Date(now - Math.max(cfg.windowMs, cfg.recheckMs)).toISOString();
    const rows = await tx`select id, topic, seen_time, subject, body from tape.events
      where topic in ('precall.detected', 'coin.watched', 'callout.created', 'jev.escalated') and seen_time >= ${since} and (seen_time, id) < (${e.seen_time}, ${e.id})
      order by seen_time, id`;
    for (const r of rows) {
      const at = (r.seen_time as Date).getTime();
      if (r.topic === "jev.escalated") {
        const b = r.body as BodyOf<"jev.escalated">;
        if (b.stage === 1 || b.stage === 2) granted.set(b.subject, { stage: b.stage, at_ms: at, arm: b.arm });
      } else note({ topic: r.topic as string, body: r.body } as Envelope, at);
    }
    // the bucket of the last event before `e` on the gate's topics: an uninterrupted run already ticked in it
    const [prev] = await tx`select seen_time from tape.events where topic = any(${GATE_TOPICS}) and (seen_time, id) < (${e.seen_time}, ${e.id}) order by seen_time desc, id desc limit 1`;
    hotBucket = prev ? Math.floor((prev.seen_time as Date).getTime() / cfg.hotEveryMs) : -1;
    loaded = true;
  }

  /** In play (docs/STRATEGY.md section 3) as the gate needs it: precall, smart_buy, or a callout. */
  function note(e: Envelope, at: number): string | null {
    if (e.topic === "precall.detected") {
      const b = e.body as BodyOf<"precall.detected">;
      coins.set(b.mint, { reason: "precall", at_ms: at, caller: b.caller, callout_id: coins.get(b.mint)?.callout_id ?? null });
      return b.mint;
    }
    if (e.topic === "coin.watched") {
      const b = e.body as BodyOf<"coin.watched">;
      if (b.reason !== "smart_buy" && b.reason !== "follow") return null;
      coins.set(b.mint, { reason: "smart_buy", at_ms: at, caller: coins.get(b.mint)?.caller ?? null, callout_id: coins.get(b.mint)?.callout_id ?? null });
      return b.mint;
    }
    if (e.topic === "callout.created") {
      const b = e.body as BodyOf<"callout.created">;
      if (b.via === "history") return null; // the Index's backfill is not a live callout
      coins.set(b.mint, { reason: "callout", at_ms: at, caller: b.author_wallet, callout_id: b.callout_id });
      return b.mint;
    }
    return null;
  }

  function inPlay(mint: string, now: number): string | null {
    const c = coins.get(mint);
    if (!c) return null;
    return now - c.at_ms <= (c.reason === "callout" ? cfg.calloutMs : cfg.windowMs) ? c.reason : null;
  }


  /** The calibrated win chance: each live strategy's score read through its family's map; the highest, or null without maps. */
  async function calibrated(tx: Tx, board: BoardValues, at: string): Promise<number | null> {
    const rows = await tx`select s.spec, c.bins from mind.strategies s
      join (select distinct on (family) family, bins from mind.calibration where at <= ${at} order by family, version desc) c on c.family = s.family
      where s.retired_at is null and s.born_at <= ${at} order by s.id`;
    let best: number | null = null;
    for (const r of rows) {
      const bins = r.bins as Bin[];
      if (bins.length < CALIB.minBins) continue;
      const { score } = scoreOf(r.spec as Spec, board);
      const bin = score === null ? null : binFor(bins, score);
      if (bin) best = Math.max(best ?? 0, bin.win);
    }
    return best;
  }

  async function grant(tx: Tx, e: Envelope, mint: string, stage: 1 | 2, reasons: string[], voi: number) {
    const now = Date.parse(e.seen_time);
    const arm = armOf(mint);
    await tape.emitIn(tx, "jev.escalated", { subject: mint, gate_reasons: arm === "control" ? [...reasons, "control"] : reasons, job: arm === "control" ? null : JOB[stage], voi, stage, arm }, { source: "attention", subject: mint, causes: [e.id], after: e.seen_time });
    granted.set(mint, { stage, at_ms: now, arm });
    pending.grants++;
    if (arm === "control") pending.control++;
  }

  /**
   * Escalate one stage when the coin is in play, the fast signals are unsure, and the value of information beats the stage's
   * cost (room is the Bridge's): VOI = P(change) x stake, P(change) = 1 - |2p - 1| (1 at p 0.5, 0 at p 0 or 1), stake = the owner's max_order_sol;
   * cost = SLOW_STAGE<n>_USD_PER_RUN / SOL_USD.
   */
  async function evaluate(tx: Tx, e: Envelope, mint: string, stage: 1 | 2) {
    const now = Date.parse(e.seen_time);
    const why = inPlay(mint, now);
    if (!why) return;
    const board = await boardValues(tx, e.seen_time, mint, coins.get(mint)?.callout_id, coins.get(mint)?.caller);
    const fast = FAST.map((k) => read(board, k)).filter((x): x is number => typeof x === "number");
    const cal = await calibrated(tx, board, e.seen_time);
    const p = cal ?? (fast.length ? fast.reduce((a, x) => a + x, 0) / fast.length : null);
    const spread = fast.length >= 2 ? Math.max(...fast) - Math.min(...fast) : 0;
    const unsure = p !== null && p >= cfg.pLow && p <= cfg.pHigh;
    if (!unsure && spread <= cfg.disagree) return;
    const stake = (await loadLimits(tx, e.seen_time)).max_order_sol;
    const voi = (p === null ? 1 : 1 - Math.abs(2 * p - 1)) * stake;
    const cost = cfg.stageUsd[stage] / cfg.solUsd;
    if (voi <= cost) return;
    await grant(tx, e, mint, stage, [why, unsure ? `p ${p!.toFixed(2)}${cal === null ? "" : " calibrated"}` : `disagree ${spread.toFixed(2)}`, `voi ${voi.toFixed(4)} > cost ${cost.toFixed(6)} SOL`], voi);
  }

  /** The hot set: the top coins by pre-call chance x caller quality get a stage 1 grant every HOT_SET_EVERY_S of Tape time. */
  async function hotSet(tx: Tx, e: Envelope) {
    const rows = await tx`select distinct on (subject) subject, value from board.signals
      where kind = 'precall.callout_p' and produced_at <= ${e.seen_time} and valid_until > ${e.seen_time} order by subject, produced_at desc, id desc`;
    const ranked = rows
      .map((r) => ({ mint: r.subject as string, rank: Number((r.value as Record<string, unknown>).p ?? 0) * Number((r.value as Record<string, unknown>).caller_p ?? 0) }))
      .filter((x) => x.rank > 0)
      .sort((a, b) => b.rank - a.rank || (a.mint < b.mint ? -1 : 1))
      .slice(0, cfg.hotSize);
    // a coin granted within ESC_RECHECK_MIN was checked recently: the hot set refreshes it once that has passed
    const now = Date.parse(e.seen_time);
    const due = ranked.filter((r) => now - (granted.get(r.mint)?.at_ms ?? -Infinity) > cfg.recheckMs);
    for (const x of due) await grant(tx, e, x.mint, 1, ["hot_set", `rank ${x.rank.toFixed(3)}`], x.rank);
    pending.hot += due.length;
  }

  return {
    name: "attention",
    startAtHead: true,
    topics: GATE_TOPICS,
    batch: 500,
    stats,
    afterCommit() {
      for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] += pending[k];
      pending = { grants: 0, control: 0, hot: 0 };
    },
    async handle(events, tx) {
      try {
        for (const e of events) {
          if (!loaded) await load(tx, e);
          const now = Date.parse(e.seen_time);
          clock.advance?.(now);
          if (Math.floor(now / cfg.hotEveryMs) > hotBucket) {
            hotBucket = Math.floor(now / cfg.hotEveryMs);
            await hotSet(tx, e);
          }
          if (e.topic === "synthesis.coin") { // stage 1 is done: the gate may take the coin one stage further
            const mint = (e.body as BodyOf<"synthesis.coin">).mint;
            const g = granted.get(mint);
            if (g?.stage === 1 && g.arm === "run") await evaluate(tx, e, mint, 2);
            continue;
          }
          const mint = note(e, now);
          if (!mint) continue;
          const g = granted.get(mint);
          if (!g || now - g.at_ms > cfg.recheckMs) await evaluate(tx, e, mint, 1); // one stage 1 per ESC_RECHECK_MIN
        }
      } catch (err) {
        loaded = false; // the transaction rolls back; rebuild from the Tape next batch
        pending = { grants: 0, control: 0, hot: 0 };
        throw err;
      }
    },
  };
}
