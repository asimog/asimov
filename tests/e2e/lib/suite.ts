// A suite: what it proves, and a run that returns checks and metrics. Replay suites share one replay per tape.
import type { Check } from "./checks.ts";
import type { ReplayResult } from "./replay.ts";

export type Ctx = { tape: string; replay: (tag?: string, seed?: number) => Promise<ReplayResult> };
export type Suite = { name: string; proves: string; tape?: boolean; run(ctx: Ctx): Promise<{ checks: Check[]; metrics: Record<string, unknown> }> };
