// Calibration (docs/STRATEGY.md section 4): a score is a ranking, not a probability. Per family, closed ghost decisions are
// binned by entry score in equal-count bins of at least CALIB_MIN_PER_BIN; each bin gives the share with net above zero and
// the mean net return, both made non-decreasing in score (pool adjacent violators). Pure: same rows, same map.
import { env } from "../lib/env.ts";

export const CALIB = { minPerBin: env.int("CALIB_MIN_PER_BIN"), kellyCap: env.num("KELLY_CAP"), minBins: 3 };

export type Bin = { lo: number; hi: number; n: number; win: number; mean: number };

/** Weighted pool-adjacent-violators: the closest non-decreasing sequence. */
function monotone(ys: number[], ws: number[]): number[] {
  const blocks: { y: number; w: number; len: number }[] = [];
  for (const [i, y] of ys.entries()) {
    blocks.push({ y, w: ws[i]!, len: 1 });
    while (blocks.length > 1 && blocks.at(-2)!.y > blocks.at(-1)!.y) {
      const b = blocks.pop()!;
      const a = blocks.pop()!;
      blocks.push({ y: (a.y * a.w + b.y * b.w) / (a.w + b.w), w: a.w + b.w, len: a.len + b.len });
    }
  }
  return blocks.flatMap((b) => Array<number>(b.len).fill(b.y));
}

/** `rows`: one per closed decision, entry score and net return (net SOL over cost). */
export function calibrate(rows: { score: number; r: number }[], minPerBin = CALIB.minPerBin): Bin[] {
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  const nb = Math.floor(sorted.length / minPerBin);
  if (nb < 1) return [];
  const raw = Array.from({ length: nb }, (_, i) => sorted.slice(Math.floor((i * sorted.length) / nb), Math.floor(((i + 1) * sorted.length) / nb)));
  const n = raw.map((b) => b.length);
  const win = monotone(raw.map((b) => b.filter((x) => x.r > 0).length / b.length), n);
  const mean = monotone(raw.map((b) => b.reduce((a, x) => a + x.r, 0) / b.length), n);
  return raw.map((b, i) => ({ lo: b[0]!.score, hi: b.at(-1)!.score, n: n[i]!, win: win[i]!, mean: mean[i]! }));
}

/** The bin a score falls in: the highest bin whose low edge is at or under it, else the lowest. */
export function binFor(bins: Bin[], score: number): Bin | null {
  let out = bins[0] ?? null;
  for (const b of bins) if (b.lo <= score) out = b;
  return out;
}
