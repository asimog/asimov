// Scorekeeper (docs/07): what happened after each callout, at compressed horizons, and how well the probability
// signals predicted it (Brier). Resolution happens only after the horizon has passed on the Clock: no lookahead.
import type { BodyOf, Envelope } from "@asimog/contracts";
import { liveFor } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";

const HORIZONS = (env.opt("OUTCOME_HORIZONS_MIN") ?? "1,3,5").split(",").map(Number);
const MAX_H = Math.max(...HORIZONS);
const SCORE_EVERY_MS = env.int("SCORE_EVERY_S", 60) * 1000;
const PROB_KINDS = ["hawkes.wave_p", "callers.wave_p"];

type Prob = { kind: string; p: number; n: number; horizon_min: number };
type Watch = { callout_id: string; mint: string; at_ms: number; price0: number | null; probs: Prob[]; done: number[] };

export function scorekeeper(tape: Tape, clock: Clock): Consumer & { stats: Record<string, number> } {
  const stats = { watched: 0, outcomes: 0, scored: 0 };
  let loaded = false;
  const watches = new Map<string, Watch[]>();
  const price = new Map<string, number>();
  let nextScore = 0;
  let nextSweep = 0;

  async function load(tx: Tx) {
    watches.clear();
    for (const r of await tx`select * from mind.outcome_watch where cardinality(done) < ${HORIZONS.length}`) {
      const w: Watch = { callout_id: r.callout_id as string, mint: r.mint as string, at_ms: (r.at as Date).getTime(), price0: r.price0 as number | null, probs: r.probs as Prob[], done: r.done as number[] };
      (watches.get(w.mint) ?? watches.set(w.mint, []).get(w.mint)!).push(w);
    }
    loaded = true;
  }

  async function resolve(tx: Tx, w: Watch, now: number, e: Envelope, force = false) {
    for (const h of HORIZONS) {
      if (w.done.includes(h) || (now < w.at_ms + h * 60_000 && !force)) continue;
      const end = new Date(w.at_ms + h * 60_000).toISOString();
      const [c] = await tx`select count(distinct wallet)::int n from mem.callouts where mint = ${w.mint} and created_at > ${new Date(w.at_ms).toISOString()} and created_at <= ${end} and callout_id <> ${w.callout_id}`;
      const p1 = price.get(w.mint) ?? null;
      const newCallouts = (c?.n as number) ?? 0;
      await tape.emitIn(
        tx, "outcome.measured",
        { callout_id: w.callout_id, mint: w.mint, horizon_min: h, price0_sol: w.price0, price_sol: p1, multiple: w.price0 && p1 ? p1 / w.price0 : null, new_callouts: newCallouts },
        { source: "scorekeeper", subject: w.callout_id, causes: [e.id], after: e.seen_time },
      );
      stats.outcomes++;
      for (const pr of w.probs.filter((x) => x.horizon_min === h)) {
        const hit = newCallouts >= pr.n ? 1 : 0;
        await tx`insert into mind.scores (kind, horizon_min, n, brier_sum, hits, p_sum) values (${pr.kind}, ${h}, 1, ${(pr.p - hit) ** 2}, ${hit}, ${pr.p})
          on conflict (kind, horizon_min) do update set n = mind.scores.n + 1, brier_sum = mind.scores.brier_sum + excluded.brier_sum,
            hits = mind.scores.hits + excluded.hits, p_sum = mind.scores.p_sum + excluded.p_sum`;
        stats.scored++;
      }
      w.done.push(h);
    }
    await tx`update mind.outcome_watch set done = ${w.done}, price0 = ${w.price0} where callout_id = ${w.callout_id}`;
    if (w.done.length === HORIZONS.length) {
      const list = watches.get(w.mint)!;
      list.splice(list.indexOf(w), 1);
      if (!list.length) watches.delete(w.mint);
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
    topics: ["callout.created", "trade.curve", "trade.amm"],
    batch: 1000,
    stats,
    async handle(events, tx) {
      try {
        if (!loaded) await load(tx);
        for (const e of events) {
          const now = Date.parse(e.seen_time);
          clock.advance?.(now);
          if (!nextScore) nextScore = now + SCORE_EVERY_MS;
          if (now >= nextScore) ((nextScore = now + SCORE_EVERY_MS), await publishScores(tx, e));
          if (now >= nextSweep) {
            nextSweep = now + 5000;
            for (const list of [...watches.values()]) for (const w of [...list]) if (now > w.at_ms + (MAX_H + 1) * 60_000) await resolve(tx, w, now, e, true);
          }
          if (e.topic === "callout.created") {
            const b = e.body as BodyOf<"callout.created">;
            const board = await liveFor(tx, b.mint, e.seen_time);
            const probs: Prob[] = PROB_KINDS.flatMap((k) => {
              const v = board[k]?.value as { p?: number; n?: number; horizon_min?: number } | undefined;
              return v?.p != null && v.n != null && v.horizon_min != null ? [{ kind: k, p: v.p, n: v.n, horizon_min: v.horizon_min }] : [];
            });
            const w: Watch = { callout_id: b.callout_id, mint: b.mint, at_ms: now, price0: price.get(b.mint) ?? null, probs, done: [] };
            await tx`insert into mind.outcome_watch (callout_id, mint, at, price0, probs) values (${w.callout_id}, ${w.mint}, ${e.seen_time}, ${w.price0}, ${tx.json(probs as never)}) on conflict do nothing`;
            (watches.get(w.mint) ?? watches.set(w.mint, []).get(w.mint)!).push(w);
            stats.watched++;
          } else {
            const t = e.body as BodyOf<"trade.curve">;
            if (!t.price_sol) continue;
            price.set(t.mint, t.price_sol);
            for (const w of [...(watches.get(t.mint) ?? [])]) {
              if (w.price0 == null) w.price0 = t.price_sol;
              if (HORIZONS.some((h) => !w.done.includes(h) && now >= w.at_ms + h * 60_000)) await resolve(tx, w, now, e);
            }
          }
        }
      } catch (err) {
        loaded = false;
        throw err;
      }
    },
  };
}
