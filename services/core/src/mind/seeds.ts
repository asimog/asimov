// Seed Strategy Pool (docs/08, docs/23): 8 families x 6 variants (3 horizons x tight/loose). Ids are stable so every
// replay seeds the same pool. Families are niche labels, not code paths.
import { HORIZON_MAX_MIN, type Horizon, type Spec } from "./dsl.ts";

type Style = { enter: number; kelly: number; tp: readonly [number, number]; stop: number; called_s?: number };
/** A family may bring its own styles and hold limits; the others use STYLE and the horizon maximum. */
type Family = Pick<Spec, "family" | "universe" | "score" | "call"> & { style?: Record<"tight" | "loose", Style>; hold?: Record<Horizon, number> };

const curveOpen = { sig: "curve.progress", field: "progress", op: "<", v: 0.9 } as const;
const notInjected = { sig: "jev.callout.injection", field: "p", op: "<", v: 0.5 } as const;

const FAMILIES: Family[] = [
  {
    family: "wave_anticipation",
    universe: { all: [curveOpen, { sig: "age.opportunity", field: "pre_move_pct", op: "<", v: 60 }] },
    score: {
      sum: [
        { w: 0.5, sig: "hawkes.wave_p", missing: "skip" },
        { w: 0.4, sig: "callers.wave_p", missing: "skip" },
        { w: 0.2, sig: "hawkes.branching", missing: "skip" },
        { w: 0.2, sig: "jev.callout.thesis_quality", field: "score_norm", missing: "skip" },
        { w: -0.4, sig: "echo.score", missing: "skip" },
      ],
    },
    call: { policy: "after_fill", template: "wave" },
  },
  {
    family: "bellwether_follow",
    universe: { all: [curveOpen, { sig: "caller.dna", field: "n", op: ">=", v: 2 }] },
    score: {
      sum: [
        { w: 0.6, sig: "caller.dna", field: "net_win", missing: "skip" },
        { w: 0.3, sig: "caller.dna", field: "followers_norm", missing: "skip" },
        { w: 0.2, sig: "jev.callout.kind", field: "p.fresh_call", missing: "skip" },
        { w: -0.3, sig: "jev.callout.promo", missing: "skip" },
      ],
    },
    call: { policy: "after_fill", template: "follow" },
  },
  {
    family: "graduation_run",
    universe: {
      all: [
        { sig: "curve.progress", field: "progress", op: ">=", v: 0.45 },
        { sig: "curve.progress", field: "progress", op: "<", v: 0.92 },
        { sig: "age.opportunity", field: "minutes", op: "exists" }, // after a callout; pre-call has its own family
      ],
    },
    score: {
      sum: [
        { w: 0.5, sig: "curve.progress", missing: "skip" },
        { w: 0.4, sig: "hawkes.wave_p", missing: "skip" },
        { w: 0.2, sig: "callers.wave_p", missing: "skip" },
        { w: -0.3, sig: "jev.callout.kind", field: "p.exit_notice", missing: "skip" },
      ],
    },
    call: { policy: "after_fill", template: "graduation" },
  },
  {
    family: "narrative_rotation",
    universe: { all: [curveOpen, notInjected] },
    score: {
      sum: [
        { w: 0.4, sig: "jev.callout.narrative", field: "p.ai_agents", missing: "skip" },
        { w: 0.2, sig: "jev.callout.narrative", field: "p.culture", missing: "skip" },
        { w: 0.4, sig: "jev.callout.thesis_quality", field: "score_norm", missing: "skip" },
        { w: 0.3, sig: "hawkes.wave_p", missing: "skip" },
        { w: -0.3, sig: "jev.callout.kind", field: "p.hype", missing: "skip" },
      ],
    },
    call: { policy: "after_fill", template: "narrative" },
  },
  {
    family: "fresh_thesis",
    universe: {
      all: [curveOpen, notInjected, { sig: "age.opportunity", field: "minutes", op: "<", v: 5 }, { sig: "age.opportunity", field: "pre_move_pct", op: "<", v: 25 }],
    },
    score: {
      sum: [
        { w: 0.5, sig: "jev.callout.thesis_quality", field: "score_norm", missing: "skip" },
        { w: 0.3, sig: "jev.callout.kind", field: "p.fresh_call", missing: "skip" },
        { w: 0.2, sig: "age.opportunity", field: "first_on_coin", missing: "skip" },
        { w: -0.4, sig: "jev.callout.promo", missing: "skip" },
        { w: -0.3, sig: "echo.score", missing: "skip" },
      ],
    },
    call: { policy: "after_fill", template: "thesis" },
  },
  {
    // a known caller bought and has not called yet: buy before the callout, sell into it (docs/08 pre-call)
    family: "pre_call",
    universe: {
      all: [
        { sig: "precall.callout_p", field: "p", op: "exists" },
        { sig: "curve.progress", field: "progress", op: "<", v: 0.85 },
        { sig: "flow.state", field: "top_share", op: "<", v: 0.6 },
      ],
    },
    score: {
      sum: [
        { w: 0.6, sig: "precall.callout_p", field: "p", missing: "skip" },
        { w: 0.3, sig: "precall.callout_p", field: "p_peak", missing: "skip" },
        { w: 0.2, sig: "flow.state", field: "heat", missing: "skip" },
        { w: 0.2, sig: "caller.dna", field: "followers_norm", missing: "skip" },
        { w: -0.3, sig: "flow.state", field: "top_share", missing: "skip" },
      ],
    },
    call: { policy: "after_fill", template: "pre_call" },
    style: {
      tight: { enter: 0.45, kelly: 0.25, tp: [1.2, 1.4], stop: 0.88, called_s: 30 },
      loose: { enter: 0.35, kelly: 0.15, tp: [1.3, 1.8], stop: 0.8, called_s: 60 },
    },
    hold: { fast: 3, medium: 6, slow: 10 },
  },
  {
    // copyable wallets from the Index are buying: follow them before the callout wave (docs/23 4)
    family: "smart_early",
    universe: {
      all: [
        { sig: "wallets.smart_buying", field: "n", op: ">=", v: 1 },
        { sig: "risk.state", field: "score", op: "<", v: 0.5 },
        { sig: "curve.progress", field: "mcap_usd", op: ">=", v: 4000 },
      ],
    },
    score: {
      sum: [
        { w: 0.6, sig: "wallets.smart_buying", field: "score", missing: "skip" },
        { w: 0.2, sig: "flow.state", field: "heat", missing: "skip" },
        { w: 0.2, sig: "precall.callout_p", field: "p", missing: "skip" },
        { w: -0.4, sig: "risk.state", field: "score", missing: "skip" },
      ],
    },
    call: { policy: "after_fill", template: "smart_early" },
    style: {
      tight: { enter: 0.4, kelly: 0.25, tp: [1.25, 1.6], stop: 0.85, called_s: 30 },
      loose: { enter: 0.3, kelly: 0.15, tp: [1.4, 2.2], stop: 0.75, called_s: 60 },
    },
    hold: { fast: 3, medium: 8, slow: 20 },
  },
  {
    // coin metrics alone, no callers: 6K is only where this family starts; evolution moves it (docs/23 4)
    family: "launch_scan",
    universe: {
      all: [
        { sig: "curve.progress", field: "mcap_usd", op: ">=", v: 6000 },
        { sig: "flow.state", field: "buyers_60s", op: ">=", v: 10 },
        { sig: "risk.state", field: "score", op: "<", v: 0.5 },
      ],
    },
    score: {
      sum: [
        { w: 0.5, sig: "flow.state", field: "heat", missing: "skip" },
        { w: 0.3, sig: "wallets.smart_buying", field: "score", missing: "skip" },
        { w: -0.3, sig: "flow.state", field: "top_share", missing: "skip" },
        { w: -0.4, sig: "risk.state", field: "score", missing: "skip" },
      ],
    },
    call: { policy: "after_fill", template: "launch_scan" },
    style: {
      tight: { enter: 0.45, kelly: 0.2, tp: [1.25, 1.6], stop: 0.85 },
      loose: { enter: 0.35, kelly: 0.12, tp: [1.5, 2.5], stop: 0.7 },
    },
    hold: { fast: 3, medium: 8, slow: 20 },
  },
];

const STYLE: Record<"tight" | "loose", Style> = {
  tight: { enter: 0.62, kelly: 0.25, tp: [1.25, 1.6], stop: 0.85 },
  loose: { enter: 0.5, kelly: 0.15, tp: [1.5, 2.5], stop: 0.7 },
} as const;

export function seedSpecs(): Spec[] {
  const out: Spec[] = [];
  FAMILIES.forEach((f, fi) => {
    (["fast", "medium", "slow"] as Horizon[]).forEach((h, hi) => {
      (["tight", "loose"] as const).forEach((style, si) => {
        const st = (f.style ?? STYLE)[style];
        const hold = f.hold?.[h] ?? HORIZON_MAX_MIN[h];
        const { style: _s, hold: _h, ...base } = f;
        out.push({
          id: `sr_seed_${fi}${hi}${si}_${f.family}_${h}_${style}`,
          ...base,
          horizon: h,
          enter_if: { score_gte: st.enter },
          size: { kelly_fraction: st.kelly, max_sol: 1, max_impact_bps: 300 },
          exits: [
            { when: { mult_gte: st.tp[0]! }, sell: 0.5 },
            { when: { mult_gte: st.tp[1]! }, sell: 0.5 },
            ...(st.called_s == null ? [] : [{ when: { called_s_gte: st.called_s }, sell: 1 }]),
            { when: { held_min_gte: hold }, sell: 1 },
          ],
          stop: { any: [{ mult_lte: st.stop }] },
        });
      });
    });
  });
  return out;
}
