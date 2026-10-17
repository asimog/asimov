// Evolution (docs/08): MAP-Elites niches (family x horizon), mutation, crossover, retirement.
// Pure: same pool, stats and random stream give the same offspring. Every child passes the validator.
import { env } from "../lib/env.ts";
import { CATALOG, HORIZON_MAX_MIN, type Spec, specDistance, validate } from "./dsl.ts";
import { lcb, type Stats } from "./kernel.ts";

export const E = {
  poolMax: env.int("POOL_MAX", 128),
  offspring: env.int("EVOLVE_OFFSPRING", 16),
  parentMinTrades: env.int("EVOLVE_PARENT_MIN_TRADES", 2),
  minDistance: env.num("EVOLVE_MIN_DISTANCE", 0.05),
  nicheMax: env.int("EVOLVE_NICHE_MAX", 12),
  retireMinTrades: env.int("RETIRE_MIN_TRADES", 50),
  retireIdleMs: env.int("RETIRE_IDLE_MIN", 120) * 60_000,
  retireDdFrac: env.num("RETIRE_DD_FRAC", 0.3),
};

export type Member = { spec: Spec; stats: Stats; born_ms: number; last_trade_ms: number | null; mk60: number[] };
export type Child = { spec: Spec; origin: "mutation" | "crossover"; parents: string[] };

const niche = (s: Spec) => `${s.family}|${s.horizon}`;
const clone = <T>(x: T): T => structuredClone(x);
const pick = <T>(xs: readonly T[], rand: () => number): T => xs[Math.floor(rand() * xs.length)]!;
const nudge = (x: number, rand: () => number) => x * (1 + 0.1 * (Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())));
const fitness = (m: Member) => (m.stats.n ? lcb(m.stats) : Number.NEGATIVE_INFINITY);

export function mutate(parent: Spec, rand: () => number): Spec {
  const s = clone(parent);
  const op = Math.floor(rand() * 6);
  if (op === 0) {
    const t = pick(s.score.sum, rand);
    t.w = Math.max(-2, Math.min(2, nudge(t.w, rand)));
  } else if (op === 1) {
    s.enter_if.score_gte = Math.max(0.05, Math.min(0.95, nudge(s.enter_if.score_gte, rand)));
  } else if (op === 2) {
    if (s.score.sum.length > 2 && rand() < 0.5) s.score.sum.splice(Math.floor(rand() * s.score.sum.length), 1);
    else {
      const kinds = Object.keys(CATALOG).filter((k) => CATALOG[k]!.unit.length);
      const sig = pick(kinds, rand);
      s.score.sum.push({ sig, field: pick(CATALOG[sig]!.unit, rand), w: (rand() < 0.7 ? 1 : -1) * (0.1 + 0.3 * rand()), missing: "skip" });
    }
  } else if (op === 3) {
    const e = pick(s.exits, rand);
    if ("mult_gte" in e.when) e.when.mult_gte = Math.max(1.05, Math.min(20, nudge(e.when.mult_gte, rand)));
    else if ("held_min_gte" in e.when) e.when.held_min_gte = Math.max(0.5, Math.min(HORIZON_MAX_MIN[s.horizon], nudge(e.when.held_min_gte, rand)));
    else e.sell = Math.max(0.05, Math.min(1, nudge(e.sell, rand)));
  } else if (op === 4) {
    const st = s.stop.any.find((w) => "mult_lte" in w) as { mult_lte: number } | undefined;
    if (st) st.mult_lte = Math.max(0.3, Math.min(0.97, nudge(st.mult_lte, rand)));
  } else {
    s.size.kelly_fraction = Math.max(0.02, Math.min(1, nudge(s.size.kelly_fraction, rand)));
  }
  return s;
}

/** Universe and score from A, exits and stops from B, same horizon. */
export function crossover(a: Spec, b: Spec): Spec {
  return { ...clone(a), exits: clone(b.exits), stop: clone(b.stop) };
}

export function evolve(pool: Member[], nowMs: number, bookSol: number, rand: () => number, newId: () => string) {
  const retire: { id: string; reason: string; m: Member }[] = [];
  for (const m of pool) {
    const idle = nowMs - (m.last_trade_ms ?? m.born_ms);
    const mk = [...m.mk60].sort((x, y) => x - y);
    if (m.stats.n >= E.retireMinTrades && lcb(m.stats) < 0) retire.push({ id: m.spec.id, reason: "lcb_below_zero", m });
    else if (m.stats.max_dd > E.retireDdFrac * bookSol) retire.push({ id: m.spec.id, reason: "drawdown", m });
    else if (mk.length >= E.retireMinTrades && mk[Math.floor(mk.length / 2)]! < 0) retire.push({ id: m.spec.id, reason: "markout_60s_negative", m });
    else if (idle > E.retireIdleMs) retire.push({ id: m.spec.id, reason: "idle", m });
  }
  const gone = new Set(retire.map((r) => r.id));
  let alive = pool.filter((m) => !gone.has(m.spec.id));

  const parents = alive.filter((m) => m.stats.n >= E.parentMinTrades).sort((a, b) => fitness(b) - fitness(a));
  const elite = parents.slice(0, Math.max(2, Math.ceil(parents.length / 2)));
  const children: Child[] = [];
  const rejected: { reason: string }[] = [];
  for (let i = 0; i < E.offspring * 3 && children.length < E.offspring && elite.length; i++) {
    const a = pick(elite, rand);
    const mates = elite.filter((m) => m !== a && m.spec.horizon === a.spec.horizon);
    const b = mates.length > 0 && rand() < 0.3 ? pick(mates, rand) : null;
    const cross = b !== null;
    const raw = b ? crossover(a.spec, b.spec) : mutate(a.spec, rand);
    raw.id = newId();
    const v = validate(raw);
    if (!v.ok) {
      rejected.push({ reason: v.reasons[0]! });
      continue;
    }
    const same = [...alive.map((m) => m.spec), ...children.map((c) => c.spec)].filter((s) => niche(s) === niche(v.spec));
    if (same.length >= E.nicheMax || same.some((s) => specDistance(s, v.spec) < E.minDistance)) {
      rejected.push({ reason: "duplicate_or_niche_full" });
      continue;
    }
    children.push({ spec: v.spec, origin: cross ? "crossover" : "mutation", parents: b ? [a.spec.id, b.spec.id] : [a.spec.id] });
  }
  // over the cap: the worst by fitness in the most crowded niches retire
  const over = alive.length + children.length - E.poolMax;
  if (over > 0) {
    const count = new Map<string, number>();
    for (const m of alive) count.set(niche(m.spec), (count.get(niche(m.spec)) ?? 0) + 1);
    const worst = [...alive].sort((a, b) => (count.get(niche(b.spec))! - count.get(niche(a.spec))!) || fitness(a) - fitness(b)).slice(0, over);
    for (const m of worst) retire.push({ id: m.spec.id, reason: "pool_cap", m });
    alive = alive.filter((m) => !worst.includes(m));
  }
  return { retire, children, rejected };
}
