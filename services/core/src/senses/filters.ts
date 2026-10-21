// Callout door (docs/PIPELINE.md section 1): an ordered list of small pure predicates. Each returns a reason or null,
// so the first failing predicate names what refused the callout. Every threshold comes from config/filters.json; this
// file holds no number. As-of safe: it reads only the callout and the config loaded at boot.
import crypto from "node:crypto";
import type { Config } from "../lib/config.ts";

export type CalloutFilters = Config["filters"]["callout"];
export type RejectReason = "unknown_chain" | "chain" | "min_position" | "min_mcap" | "max_mcap";

/** The facts the door sees. A null is unknown at the source, never zero. */
export type CalloutFacts = {
  callout_id: string;
  chain: string | null;
  position_usd: number | null;
  mcap_usd: number | null;
};

type Predicate = { reason: RejectReason; refuses(c: CalloutFacts, f: CalloutFilters): boolean };

export const PREDICATES: Predicate[] = [
  { reason: "unknown_chain", refuses: (c, f) => c.chain === null && f.unknown_chain === "refuse" },
  { reason: "chain", refuses: (c, f) => c.chain !== null && !f.chains.includes(c.chain) },
  { reason: "min_position", refuses: (c, f) => c.position_usd !== null && c.position_usd < f.min_position_usd },
  { reason: "min_mcap", refuses: (c, f) => c.mcap_usd !== null && c.mcap_usd < f.min_mcap_usd },
  { reason: "max_mcap", refuses: (c, f) => f.max_mcap_usd !== null && c.mcap_usd !== null && c.mcap_usd > f.max_mcap_usd },
];

/** The first reason the callout is refused, or null when it passes. Pure. */
export function passes(c: CalloutFacts, f: CalloutFilters): RejectReason | null {
  for (const p of PREDICATES) if (p.refuses(c, f)) return p.reason;
  return null;
}

/** A hash of the id, so the same item is sampled on every run. */
export function sampled(calloutId: string, pct: number): boolean {
  if (pct <= 0) return false;
  const n = crypto.createHash("sha256").update(calloutId).digest().readUInt32BE(0);
  return n % 100 < Math.min(100, pct);
}

export type LaunchFilters = Config["filters"]["launch"];
export type LaunchFact = "dev_buy" | "block0_snipers" | "bundle";
export type LaunchFacts = { dev_buy_sol: number | null; block0_sniper_share: number | null; bundle_share: number | null };
export type LaunchVerdict = { reason: RejectReason | `unknown_${LaunchFact}` | "dev_buy" | "block0_snipers" | "bundle" | null; unknown: LaunchFact[] };

/** The launch door: a threshold reason wins; an unknown fact is decided by `on_unknown` for the watch reason. */
export function passesLaunch(f: LaunchFacts, lf: LaunchFilters, watchReason: "caller_buy" | "smart_buy" | "follow" | "heat" | "metrics"): LaunchVerdict {
  const unknown: LaunchFact[] = [];
  if (f.dev_buy_sol === null) unknown.push("dev_buy");
  if (f.block0_sniper_share === null) unknown.push("block0_snipers");
  if (f.bundle_share === null) unknown.push("bundle");
  if (f.dev_buy_sol !== null && f.dev_buy_sol > lf.max_dev_buy_sol) return { reason: "dev_buy", unknown };
  if (f.block0_sniper_share !== null && f.block0_sniper_share > lf.max_block0_sniper_share) return { reason: "block0_snipers", unknown };
  if (f.bundle_share !== null && f.bundle_share > lf.max_bundle_share) return { reason: "bundle", unknown };
  if (unknown.length && (lf.on_unknown[watchReason] ?? "refuse") === "refuse") return { reason: `unknown_${unknown[0]!}` as LaunchVerdict["reason"], unknown };
  return { reason: null, unknown };
}
