// Strategy DSL (docs/STRATEGY.md): a strategy is data. This file validates specs and evaluates them against Board values.
// No eval, no code in specs. Every number a spec can reach is bounded here.
import { z } from "zod";
import { FEE } from "../analyzers/curve-math.ts";
import { env } from "../lib/env.ts";

/** Signal catalog: kinds a spec may name, their subject, the fields usable as [0,1] score inputs, and their System. */
type SigInfo = { subject: "mint" | "callout" | "caller"; system: 1 | 2; unit: string[]; fields: string[] };
export const CATALOG: Record<string, SigInfo> = {
  "age.opportunity": { subject: "callout", system: 1, unit: ["first_on_coin"], fields: ["minutes", "pre_move_pct", "first_on_coin"] },
  "echo.score": { subject: "callout", system: 1, unit: ["score", "text", "follow"], fields: ["score", "text", "follow", "edge", "earlier"] },
  "hawkes.wave_p": { subject: "mint", system: 1, unit: ["p"], fields: ["p", "expected_new"] },
  "hawkes.branching": { subject: "mint", system: 1, unit: ["n"], fields: ["n"] },
  "hawkes.intensity": { subject: "mint", system: 1, unit: [], fields: ["per_min", "callouts_6h"] },
  "callers.wave_p": { subject: "mint", system: 1, unit: ["p"], fields: ["p", "expected_new"] },
  "caller.dna": { subject: "caller", system: 1, unit: ["net_win", "followers_norm"], fields: ["n", "resolved", "net_win", "med_net", "med_age", "med_pre", "followers", "followers_norm"] },
  "curve.progress": { subject: "mint", system: 1, unit: ["progress"], fields: ["progress", "real_sol", "mcap_usd"] },
  "flow.state": { subject: "mint", system: 1, unit: ["heat", "top_share"], fields: ["buys_60s", "sells_60s", "buyers_60s", "net_sol_60s", "accel", "known_callers_buying"] },
  "risk.state": { subject: "mint", system: 1, unit: ["score", "bundle_share", "fresh_share", "sniper_share", "top10_share", "creator_sold"], fields: ["bundle_wallets", "holders_est", "breaches"] },
  "wallets.smart_buying": { subject: "mint", system: 1, unit: ["score"], fields: ["n", "copy_net_med", "lead_s_med"] },
  "precall.callout_p": { subject: "mint", system: 1, unit: ["p", "caller_p", "p_peak"], fields: ["n_buys", "n_called", "lag_med_s", "med_peak", "pop_rate", "callers_buying", "buy_sol"] },
  "jev.callout.kind": { subject: "callout", system: 1, unit: ["p.fresh_call", "p.hype", "p.exit_notice", "p.fud", "p.other"], fields: ["choice"] },
  "jev.callout.thesis_quality": { subject: "callout", system: 1, unit: ["score_norm"], fields: ["score"] },
  "jev.callout.promo": { subject: "callout", system: 1, unit: ["p"], fields: [] },
  "jev.callout.countdown": { subject: "callout", system: 1, unit: ["p"], fields: [] },
  "jev.callout.injection": { subject: "callout", system: 1, unit: ["p"], fields: [] },
  "jev.callout.narrative": {
    subject: "callout",
    system: 1,
    unit: ["p.ai_agents", "p.animals", "p.celebrity", "p.politics", "p.culture", "p.tech", "p.other"],
    fields: ["choice"],
  },
};

/** Compressed horizons (docs/STRATEGY.md): the longest a position of each horizon may be held. */
export const HORIZON_MAX_MIN = {
  fast: env.num("HORIZON_FAST_MIN"),
  medium: env.num("HORIZON_MEDIUM_MIN"),
  slow: env.num("HORIZON_SLOW_MIN"),
} as const;
export type Horizon = keyof typeof HORIZON_MAX_MIN;

const Op = z.enum([">=", "<=", ">", "<", "==", "exists", "absent"]);
const Cond = z.object({ sig: z.string(), field: z.string().optional(), op: Op, v: z.union([z.number(), z.string(), z.boolean()]).optional() });
const Term = z.object({ w: z.number().min(-2).max(2), sig: z.string(), field: z.string().optional(), missing: z.union([z.literal("skip"), z.number().min(0).max(1)]).default("skip") });
const ExitWhen = z.union([
  z.object({ mult_gte: z.number().min(1.01).max(100) }),
  z.object({ mult_lte: z.number().min(0.05).max(0.99) }),
  z.object({ held_min_gte: z.number().min(0.1).max(10_000) }),
  z.object({ called_s_gte: z.number().min(0).max(3600) }),
  Cond,
]);
export const Spec = z.object({
  id: z.string(),
  family: z.string().min(1).max(40),
  horizon: z.enum(["fast", "medium", "slow"]),
  universe: z.object({ all: z.array(Cond).max(12) }),
  score: z.object({ sum: z.array(Term).min(1).max(16) }),
  enter_if: z.object({ score_gte: z.number().min(0).max(1) }),
  size: z.object({ kelly_fraction: z.number().min(0).max(1), max_sol: z.number().positive().max(1000), max_impact_bps: z.number().min(1).max(5000) }),
  call: z.object({ policy: z.string().regex(/^(after_fill|after_fill_delay:\d{1,4}|silent)$/), template: z.string().max(40) }),
  exits: z.array(z.object({ when: ExitWhen, sell: z.number().min(0.01).max(1) })).min(1).max(8),
  stop: z.object({ any: z.array(ExitWhen).min(1).max(6) }),
});
export type Spec = z.infer<typeof Spec>;
type CondT = z.infer<typeof Cond>;
type ExitWhenT = z.infer<typeof ExitWhen>;

/** Validate a spec. Returns the parsed spec or every reason it is invalid. Never throws. */
export function validate(raw: unknown): { ok: true; spec: Spec } | { ok: false; reasons: string[] } {
  const parsed = Spec.safeParse(raw);
  if (!parsed.success) return { ok: false, reasons: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const s = parsed.data;
  const reasons: string[] = [];
  const checkSig = (sig: string, field: string | undefined, where: string, unit: boolean) => {
    const info = CATALOG[sig];
    if (!info) return reasons.push(`${where}: unknown signal ${sig}`);
    if (s.horizon === "fast" && info.system !== 1) reasons.push(`${where}: fast strategies use System One signals only (${sig})`);
    const f = field ?? info.unit[0];
    if (unit && (!f || !info.unit.includes(f))) reasons.push(`${where}: ${sig}.${f ?? "?"} is not a [0,1] field`);
    if (!unit && field && !info.fields.includes(field) && !info.unit.includes(field)) reasons.push(`${where}: unknown field ${sig}.${field}`);
  };
  s.universe.all.forEach((c, i) => checkSig(c.sig, c.field, `universe.${i}`, false));
  s.score.sum.forEach((t, i) => checkSig(t.sig, t.field, `score.${i}`, true));
  if (!s.score.sum.some((t) => t.w > 0)) reasons.push("score: needs at least one positive weight");
  const whens = [...s.exits.map((e) => e.when), ...s.stop.any];
  whens.forEach((w, i) => "sig" in w && checkSig(w.sig, w.field, `exit.${i}`, false));
  const held = whens.flatMap((w) => ("held_min_gte" in w ? [w.held_min_gte] : []));
  if (!held.length) reasons.push("exits: needs a held_min_gte exit");
  if (held.some((h) => h > HORIZON_MAX_MIN[s.horizon])) reasons.push(`exits: held_min_gte over the ${s.horizon} horizon (${HORIZON_MAX_MIN[s.horizon]} min)`);
  if (!s.stop.any.some((w) => "mult_lte" in w)) reasons.push("stop: needs a mult_lte stop");
  if (!s.exits.some((e) => "mult_gte" in e.when)) reasons.push("exits: needs a mult_gte take-profit");
  return reasons.length ? { ok: false, reasons } : { ok: true, spec: s };
}

// ---------- evaluation ----------
export type BoardValues = Record<string, Record<string, unknown> | undefined>;

/** Read a field of a signal value. `p.X` reads a choice probability; the default is the kind's first unit field. */
export function read(board: BoardValues, sig: string, field?: string): number | string | boolean | undefined {
  const v = board[sig];
  if (!v) return undefined;
  const f = field ?? CATALOG[sig]?.unit[0];
  if (!f) return undefined;
  if (f === "followers_norm") return Math.min(1, Math.log10(((v.followers as number) ?? 0) + 1) / 5);
  if (f.startsWith("p.") && v.probabilities) return ((v.probabilities as Record<string, number>)[f.slice(2)] ?? 0) as number;
  const x = v[f];
  return typeof x === "string" && x !== "" && !Number.isNaN(Number(x)) ? Number(x) : (x as number | string | boolean | undefined);
}

function cond(board: BoardValues, c: CondT): boolean {
  const x = read(board, c.sig, c.field);
  if (c.op === "exists") return x !== undefined && x !== null;
  if (c.op === "absent") return x === undefined || x === null;
  if (x === undefined || x === null) return false;
  if (c.op === "==") return x === c.v;
  const a = Number(x);
  const b = Number(c.v);
  return c.op === ">=" ? a >= b : c.op === "<=" ? a <= b : c.op === ">" ? a > b : a < b;
}

export type Terms = { sig: string; field: string; w: number; x: number }[];

export function scoreOf(spec: Spec, board: BoardValues): { score: number | null; terms: Terms } {
  const terms: Terms = [];
  for (const t of spec.score.sum) {
    const raw = read(board, t.sig, t.field);
    const x = typeof raw === "number" ? raw : typeof raw === "boolean" ? Number(raw) : t.missing === "skip" ? null : t.missing;
    if (x === null) continue;
    terms.push({ sig: t.sig, field: t.field ?? CATALOG[t.sig]!.unit[0]!, w: t.w, x: Math.max(0, Math.min(1, x)) });
  }
  const pos = terms.reduce((a, t) => a + Math.max(0, t.w), 0);
  if (pos === 0) return { score: null, terms };
  return { score: terms.reduce((a, t) => a + t.w * t.x, 0) / pos, terms };
}

/** Geometry of a spec's first take-profit and its stop: used for the cost floor and for sizing. */
export function geometry(spec: Spec) {
  const tp = Math.min(...spec.exits.flatMap((e) => ("mult_gte" in e.when ? [e.when.mult_gte] : [])));
  const stop = Math.max(...spec.stop.any.flatMap((w) => ("mult_lte" in w ? [w.mult_lte] : [])));
  return { tp, stop, b: (tp - 1) / (1 - stop) };
}

export type EntryDecision =
  | { enter: false; reason: string; score: number | null; terms: Terms }
  | { enter: true; score: number; terms: Terms; edge_bps: number; cost_bps: number; size_sol: number };

/**
 * Universe, score, threshold, then the cost floor: the score read as a win chance must clear
 * round-trip costs (fees both ways plus slippage both ways) given the take-profit and stop geometry.
 */
/** `fixed_sol`: ghost and probe strategies trade one owner-set size; `budget_sol`: a full strategy's kernel share of the book. */
export type Sizing = { fixed_sol: number } | { budget_sol: number };
export function evaluateEntry(spec: Spec, board: BoardValues, quote: (sol: number) => { slippage_bps: number; impact_bps: number }, sizing: Sizing): EntryDecision {
  for (const c of spec.universe.all) if (!cond(board, c)) return { enter: false, reason: `universe:${c.sig}`, score: null, terms: [] };
  const { score, terms } = scoreOf(spec, board);
  if (score === null) return { enter: false, reason: "no_score", score, terms };
  if (score < spec.enter_if.score_gte) return { enter: false, reason: "below_threshold", score, terms };
  const g = geometry(spec);
  const kelly = Math.max(0, (score * g.b - (1 - score)) / g.b);
  if (kelly <= 0) return { enter: false, reason: "no_edge", score, terms };
  const size = Math.min(spec.size.max_sol, "fixed_sol" in sizing ? sizing.fixed_sol : spec.size.kelly_fraction * kelly * sizing.budget_sol);
  if (size <= 0) return { enter: false, reason: "no_budget", score, terms };
  const q = quote(size);
  if (q.impact_bps > spec.size.max_impact_bps) return { enter: false, reason: "impact_over_spec", score, terms };
  const cost_bps = 2 * FEE * 10_000 + 2 * q.slippage_bps;
  const edge_bps = (score * (g.tp - 1) - (1 - score) * (1 - g.stop)) * 10_000;
  if (edge_bps <= cost_bps) return { enter: false, reason: "below_cost_floor", score, terms };
  return { enter: true, score, terms, edge_bps, cost_bps, size_sol: size };
}

/** `calledS`: seconds since a callout landed on the coin after our entry, or null (docs/STRATEGY.md pre-call). */
export type ExitCtx = { mult: number; heldMin: number; calledS: number | null; board: BoardValues };
export function whenHolds(w: ExitWhenT, x: ExitCtx, band = 1): boolean {
  if ("mult_gte" in w) return x.mult >= w.mult_gte * band;
  if ("mult_lte" in w) return x.mult <= w.mult_lte;
  if ("held_min_gte" in w) return x.heldMin >= w.held_min_gte;
  if ("called_s_gte" in w) return x.calledS !== null && x.calledS >= w.called_s_gte;
  return cond(x.board, w);
}

/** Distance between two specs of the same shape: mean relative gap of weights and thresholds. */
export function specDistance(a: Spec, b: Spec): number {
  if (a.family !== b.family || a.horizon !== b.horizon) return 1;
  const va = vector(a);
  const vb = vector(b);
  const keys = new Set([...Object.keys(va), ...Object.keys(vb)]);
  let d = 0;
  for (const k of keys) d += Math.abs((va[k] ?? 0) - (vb[k] ?? 0)) / Math.max(1e-6, Math.abs(va[k] ?? 0), Math.abs(vb[k] ?? 0));
  return d / keys.size;
}
function vector(s: Spec): Record<string, number> {
  const v: Record<string, number> = { enter: s.enter_if.score_gte, kelly: s.size.kelly_fraction };
  for (const t of s.score.sum) v[`w:${t.sig}:${t.field ?? ""}`] = t.w;
  s.universe.all.forEach((c) => typeof c.v === "number" && (v[`u:${c.sig}:${c.field ?? ""}:${c.op}`] = c.v));
  s.exits.forEach((e, i) => {
    const w = e.when as Record<string, unknown>;
    for (const k of ["mult_gte", "mult_lte", "held_min_gte", "called_s_gte"]) if (typeof w[k] === "number") v[`x${i}:${k}`] = w[k] as number;
    v[`x${i}:sell`] = e.sell;
  });
  return v;
}
