// Thesis and post texts (docs/EXECUTION.md). Pure functions: the same Board, spec and fill give the same thesis and words.
// Claims carry their evidence class (docs/SYSTEM.md). Numbers are computed here, never by a model.
import type { BodyOf } from "@asimog/contracts";
import type { BoardValues, Spec } from "../mind/dsl.ts";

export type Thesis = Omit<BodyOf<"thesis.formed">, "commit_id">;
type V = Record<string, unknown> | undefined;

const num = (v: V, k: string) => (typeof v?.[k] === "number" ? (v[k] as number) : null);
const f2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const mult = (x: number) => `${x.toFixed(2)}x`;

export function money(usd: number | null) {
  if (usd == null || !Number.isFinite(usd)) return null;
  return usd >= 1e6 ? `${(usd / 1e6).toFixed(1)}M` : usd >= 1e3 ? `${Math.round(usd / 1e3)}k` : `${Math.round(usd)}`;
}

export function formThesis(o: {
  thesis_id: string; mint: string; strategy_id: string; position_id: string; spec: Spec; board: BoardValues;
  entry_price_sol: number; size_sol: number; win_p: number | null; precall_horizon_min: number;
}): Thesis {
  const b = o.board;
  const flow = b["flow.state"];
  const pre = b["precall.callout_p"];
  const curve = b["curve.progress"];
  const kind: Thesis["kind"] = pre && (o.spec.family === "pre_call" || !b["age.opportunity"]) ? "pre_call" : "post_call";
  const claims: Thesis["claims"] = [];
  if (flow) claims.push({ class: "observed", text: `${num(flow, "buyers_60s") ?? 0} buyer${num(flow, "buyers_60s") === 1 ? "" : "s"} in 60s, net ${(num(flow, "net_sol_60s") ?? 0) >= 0 ? "+" : ""}${f2(num(flow, "net_sol_60s") ?? 0)} SOL` });
  if (curve) claims.push({ class: "observed", text: `curve ${pct(num(curve, "progress") ?? 0)} to graduation` });
  if (pre) {
    claims.push({ class: "computed", text: `callout odds ${f2(num(pre, "p") ?? 0)} within ${num(pre, "horizon_min") ?? o.precall_horizon_min} min from ${num(pre, "callers_buying") ?? 1} tracked buyer(s)` });
    claims.push({ class: "computed", text: `buyer record: ${num(pre, "n_called") ?? 0} of ${num(pre, "n_buys") ?? 0} closed buys called` });
  }
  for (const k of ["hawkes.wave_p", "callers.wave_p"] as const) if (b[k]) claims.push({ class: "computed", text: `${k} ${f2(num(b[k], "p") ?? 0)}` });
  const tq = b["jev.callout.thesis_quality"];
  if (tq) claims.push({ class: "ai_judgment", text: `caller thesis quality ${f2(num(tq, "score_norm") ?? 0)} (Jev)` });
  const kc = b["jev.callout.kind"];
  if (typeof kc?.choice === "string") claims.push({ class: "ai_judgment", text: `caller post reads as ${kc.choice} (Jev)` });

  const ladder = o.spec.exits.flatMap((e) => ("mult_gte" in e.when ? [{ mult: e.when.mult_gte, sell: e.sell }] : []));
  const stop = Math.max(...o.spec.stop.any.flatMap((w) => ("mult_lte" in w ? [w.mult_lte] : [])));
  const hold = Math.min(...[...o.spec.exits.map((e) => e.when), ...o.spec.stop.any].flatMap((w) => ("held_min_gte" in w ? [w.held_min_gte] : [])));
  const H = num(pre, "horizon_min") ?? o.precall_horizon_min;
  const prediction = kind === "pre_call"
    ? { p: num(pre, "p") ?? 0, horizon_min: H, what: "a callout on the coin" }
    : { p: o.win_p ?? 0, horizon_min: hold, what: "first take-profit before the stop" };
  const invalidation = [`price at or below ${mult(stop)}`, `held ${hold} min`];
  if (kind === "pre_call") invalidation.push(`no callout within ${H} min`);
  return {
    thesis_id: o.thesis_id, mint: o.mint, strategy_id: o.strategy_id, position_id: o.position_id, kind, claims, prediction,
    plan: { entry_price_sol: o.entry_price_sol, size_sol: o.size_sol, ladder, stop, max_hold_min: hold }, invalidation,
  };
}

const lead = (paper: boolean) => (paper ? "PAPER. " : "");

/** The callout: position first, then the strongest observation, the prediction, the plan. It is posted on the coin's
 * own page, so it never repeats the ticker (a ticker is untrusted text and could break a check). */
export function calloutText(t: Thesis, o: { paper: boolean; mcap_usd: number | null }): string {
  const at = money(o.mcap_usd);
  const parts = [`Bought ${sol(t.plan.size_sol)} SOL${at ? ` at ${at} mc` : ""}.`];
  const obs = t.claims.find((c) => c.class === "observed");
  if (obs) parts.push(`${cap(obs.text)}.`);
  if (t.kind === "pre_call") parts.push(`Callout odds ${f2(t.prediction.p)} in ${t.prediction.horizon_min} min.`);
  else parts.push(`Win odds ${f2(t.prediction.p)} by my model.`);
  if (t.plan.ladder.length) parts.push(`Ladder: ${t.plan.ladder.map((l) => `${pct(l.sell)} at ${mult(l.mult)}`).join(", ")}.`);
  parts.push(`Stop ${mult(t.plan.stop)}. Max hold ${t.plan.max_hold_min} min.`);
  return lead(o.paper) + parts.join(" ");
}

/** An exit of the house position. `reason` is the desk's exit rule (`exit:<i>:<rule>`). */
export function exitText(o: { paper: boolean; reason: string; sold: number; left: number; mult: number }): string {
  const rule = o.reason.split(":")[2] ?? "";
  const held = o.left > 1e-9 ? ` Holding ${pct(o.left)}.` : "";
  if (rule === "stop") return `${lead(o.paper)}Out at ${mult(o.mult)}. Stop hit.`;
  if (rule === "held_min_gte") return `${lead(o.paper)}Out at ${mult(o.mult)}. Hold limit.`;
  if (rule === "called_s_gte") return `${lead(o.paper)}Sold ${pct(o.sold)} at ${mult(o.mult)} into the callout.${held}`;
  if (rule === "retired") return `${lead(o.paper)}Out at ${mult(o.mult)}. Strategy retired.`;
  return `${lead(o.paper)}Sold ${pct(o.sold)} at ${mult(o.mult)}.${held}`;
}

/** The final update: the net result and whether the thesis held. */
export function closeText(o: { paper: boolean; kind: Thesis["kind"]; net_mult: number; size_sol: number; called_after_s: number | null; horizon_min: number }): string {
  const res = `Closed. ${mult(o.net_mult)} net on ${sol(o.size_sol)} SOL.`;
  const why = o.kind === "pre_call"
    ? o.called_after_s != null ? ` Callout came ${Math.round(o.called_after_s)} s after entry.` : ` No callout in ${o.horizon_min} min. Thesis failed.`
    : o.net_mult > 1 ? " Thesis held." : " Thesis failed.";
  return lead(o.paper) + res + why;
}

const sol = (x: number) => x.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
