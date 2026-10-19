// The allocation kernel (docs/STRATEGY.md, docs/SYSTEM.md): one rule at every level. Posterior over mean net return per SOL
// traded, skeptical prior, Thompson sample per round, capital share proportional to samples above the hurdle.
import { env } from "../lib/env.ts";

export const K = {
  priorMean: env.num("KERNEL_PRIOR_MEAN"),
  priorN: env.num("KERNEL_PRIOR_N"),
  priorSd: env.num("KERNEL_PRIOR_SD"),
  hurdle: env.num("KERNEL_HURDLE"),
  capFull: env.num("KERNEL_CAP_FULL"),
  capProbe: env.num("KERNEL_CAP_PROBE"),
  promoteMinTrades: env.int("PROMOTE_MIN_TRADES"),
  maxDdFrac: env.num("PROMOTE_MAX_DD_FRAC"),
  holdoutFrac: env.num("PROMOTE_HOLDOUT_FRAC"),
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

/** The standard normal quantile (Acklam's approximation, relative error under 1.2e-9). */
export function zOf(p: number) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const tail = (q: number) => (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** 90% lower confidence bound of mean net return per trade, raised for `members` tries in one family (Bonferroni). */
export function lcb(s: Stats, members = 1) {
  const p = posterior(s);
  return p.mu - zOf(1 - 0.1 / Math.max(1, members)) * p.scale;
}

/** Stats of a list of returns (one per coin when correlated trades are counted once). */
export function statsOf(rets: number[], max_dd = 0): Stats {
  return { n: rets.length, sum: rets.reduce((a, b) => a + b, 0), sq: rets.reduce((a, b) => a + b * b, 0), rets, max_dd };
}

/** The family's held-out test (docs/STRATEGY.md section 5): its per-coin returns, oldest first; the latest share must clear the raised bound. */
export function familyPasses(coinRets: number[], members: number) {
  const k = Math.ceil(coinRets.length * K.holdoutFrac);
  return k > 0 && lcb(statsOf(coinRets.slice(-k)), members) > K.hurdle;
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

/**
 * Ghost -> probe: its family passed the held-out test, enough trades (one per coin), the bound raised for the family's
 * size above the hurdle in both halves, drawdown inside the limit.
 */
export function stageOf(s: Stats, bookSol: number, members: number, familyOk: boolean): "ghost" | "probe" | "full" {
  if (!familyOk || s.n < K.promoteMinTrades || s.max_dd > K.maxDdFrac * bookSol) return "ghost";
  const half = Math.floor(s.rets.length / 2);
  const ok = lcb(statsOf(s.rets.slice(0, half)), members) > K.hurdle && lcb(statsOf(s.rets.slice(half)), members) > K.hurdle;
  if (!ok) return "ghost";
  return s.n >= K.promoteMinTrades + env.int("PROMOTE_FULL_EXTRA_TRADES") ? "full" : "probe";
}

export type Allocation = { strategy_id: string; n: number; mean: number | null; lcb: number | null; sample: number; share: number; stage: string };

/** `stats`: one return per coin; `family`: the family's per-coin returns, oldest first, and its living members. */
export type AllocRow = { strategy_id: string; stats: Stats; family: { coinRets: number[]; members: number } };

export function allocate(rows: AllocRow[], bookSol: number, rand: () => number): Allocation[] {
  const out = rows.map(({ strategy_id, stats, family }) => {
    const p = posterior(stats);
    const stage = stageOf(stats, bookSol, family.members, familyPasses(family.coinRets, family.members));
    return { strategy_id, n: stats.n, mean: p.mean, lcb: stats.n ? lcb(stats, family.members) : null, sample: p.mu + p.scale * sampleT(p.df, rand), share: 0, stage };
  });
  const eligible = out.filter((a) => a.stage !== "ghost" && a.sample > K.hurdle);
  const total = eligible.reduce((a, b) => a + (b.sample - K.hurdle), 0);
  for (const a of eligible) a.share = Math.min(a.stage === "probe" ? K.capProbe : K.capFull, (a.sample - K.hurdle) / total);
  return out.sort((a, b) => b.sample - a.sample);
}
