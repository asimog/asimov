// A suite: what it proves, its tier, the paths it covers, and a run that returns checks and metrics.
// Replay suites share one replay per tape, so a suite that reuses a cached replay reports only its own time.
import type { Check } from "./checks.ts";
import type { ReplayResult } from "./replay.ts";

/** fast: every change, under its budget; slow: by name when the change needs it; soak: long behaviour; milestone: when the owner asks. */
export type Tier = "fast" | "slow" | "soak" | "milestone";
export const TIERS: Tier[] = ["fast", "slow", "soak", "milestone"];
export const FAST_BUDGET_MS = 60_000;

export type ReplayOpts = { seed?: number; extra?: import("./replay.ts").Row[]; restartAt?: number; reverse?: boolean; liveLeg?: boolean };
/** `tape`: another fixture than the run's; its replay is still owned and dropped by the runner. */
export type Ctx = { tape: string; replay: (tag?: string, opts?: ReplayOpts & { tape?: string }) => Promise<ReplayResult> };
export type Suite = {
  name: string;
  proves: string;
  tier: Tier;
  /** path prefixes this suite proves; `npm run preflight` names it when the diff touches one */
  covers: string[];
  budget_ms?: number;
  tape?: boolean;
  /** `skipped`: why the suite did not run; reported as SKIP, never as a pass */
  run(ctx: Ctx): Promise<{ checks: Check[]; metrics: Record<string, unknown>; files?: Record<string, string>; skipped?: string }>;
};
