// The allocation kernel (docs/08, docs/22): one rule at every level. Posterior over mean net return per SOL
// traded, skeptical prior, Thompson sample per round, capital share proportional to samples above the hurdle.
import { env } from "../lib/env.ts";

export const K = {
  priorMean: env.num("KERNEL_PRIOR_MEAN", -0.01),
  priorN: env.num("KERNEL_PRIOR_N", 5),
  priorSd: env.num("KERNEL_PRIOR_SD", 0.25),
  hurdle: env.num("KERNEL_HURDLE", 0),
  capFull: env.num("KERNEL_CAP_FULL", 0.25),
  capProbe: env.num("KERNEL_CAP_PROBE", 0.05),
  promoteMinTrades: env.int("PROMOTE_MIN_TRADES", 30),
  maxDdFrac: env.num("PROMOTE_MAX_DD_FRAC", 0.3),
};

export type Stats = { n: number; sum: number; sq: number; rets: number[]; max_dd: number };

export function posterior(s: Stats) {
  const n = s.n;
  const mean = n ? s.sum / n : 0;
  const sd = n >= 2 ? Math.sqrt(Math.max(1e-8, (s.sq - n * mean * mean) / (n - 1))) : K.priorSd;
  const N = K.priorN + n;
  const mu = (K.priorN * K.priorMean + n * mean) / N;
  const scale = sd / Math.sqrt(N);
  return { mu, scale, df: Math.max(1, N - 1), mean: n ? mean : null };
}

/** 90% lower confidence bound of mean net return per trade. */
export function lcb(s: Stats) {
  const p = posterior(s);
  return p.mu - 1.2816 * p.scale;
}

function normal(rand: () => number) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
/** Marsaglia-Tsang gamma(shape, 1). */
function gamma(shape: number, rand: () => number): number {
  if (shape < 1) return gamma(shape + 1, rand) * rand() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rand);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    if (Math.log(Math.max(rand(), 1e-12)) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
export function sampleT(df: number, rand: () => number) {
  return normal(rand) / Math.sqrt((2 * gamma(df / 2, rand)) / df);
}

/** Ghost -> probe: enough trades, positive LCB in both halves of its trades, drawdown inside the limit. */
export function stageOf(s: Stats, bookSol: number): "ghost" | "probe" | "full" {
  if (s.n < K.promoteMinTrades || s.max_dd > K.maxDdFrac * bookSol) return "ghost";
  const half = Math.floor(s.rets.length / 2);
  const part = (r: number[]): Stats => ({ n: r.length, sum: r.reduce((a, b) => a + b, 0), sq: r.reduce((a, b) => a + b * b, 0), rets: r, max_dd: 0 });
  const ok = lcb(part(s.rets.slice(0, half))) > K.hurdle && lcb(part(s.rets.slice(half))) > K.hurdle;
  if (!ok) return "ghost";
  return s.n >= K.promoteMinTrades + env.int("PROMOTE_FULL_EXTRA_TRADES", 20) ? "full" : "probe";
}

export type Allocation = { strategy_id: string; n: number; mean: number | null; lcb: number | null; sample: number; share: number; stage: string };

export function allocate(rows: { strategy_id: string; stats: Stats }[], bookSol: number, rand: () => number): Allocation[] {
  const out = rows.map(({ strategy_id, stats }) => {
    const p = posterior(stats);
    return { strategy_id, n: stats.n, mean: p.mean, lcb: stats.n ? lcb(stats) : null, sample: p.mu + p.scale * sampleT(p.df, rand), share: 0, stage: stageOf(stats, bookSol) };
  });
  const eligible = out.filter((a) => a.stage !== "ghost" && a.sample > K.hurdle);
  const total = eligible.reduce((a, b) => a + (b.sample - K.hurdle), 0);
  for (const a of eligible) a.share = Math.min(a.stage === "probe" ? K.capProbe : K.capFull, (a.sample - K.hurdle) / total);
  return out.sort((a, b) => b.sample - a.sample);
}
