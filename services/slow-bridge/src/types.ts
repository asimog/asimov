// The one contract both engines speak to the Bridge (docs/SLOW-MIND.md section 5): POST /asimog/runs starts a run, GET /asimog/runs/:id
// reports it. BettaFish's asimog_worker.py and MiroShark's asimog blueprint both implement it.
export type Engine = "bettafish" | "miroshark";
export type Kind = "feed" | "coin" | "swarm";
/** `usd_cap`: the run's spend cap (its stage's SLOW_STAGE<n>_USD_PER_RUN); `stage`: null for feed runs. */
/** `started_at`: this claim's own mark; a finish carries it, so a poller whose job was requeued and claimed again cannot finish it */
export type Job = { id: string; engine: Engine; kind: Kind; subject: string; preset: string; slot: string; stage: number | null; usd_cap: number; started_at: string };

export type RunRequest = { job_id: string; kind: Kind; subject: string; preset: string; usd_cap: number; window_min: number; started_at: string; as_of: string; parent_reports: string[]; dossier?: unknown; parent_texts?: { report_id: string; producer: string; summary: string; markdown: string | null }[]; narrative?: { size: number; first_text: string | null } };
export type ReportOut = { producer: string; kind: Kind; subject: string; summary: string; cites: string[]; ir?: Record<string, unknown> | null; markdown?: string | null; simulated?: boolean };
export type RunOutput = {
  reports?: ReportOut[];
  synthesis_feed?: Record<string, unknown>; // emit_synthesis_feed arguments
  synthesis_coin?: Record<string, unknown>; // emit_synthesis_coin arguments
  forum_lines?: Record<string, unknown>[]; // emit_forum_line arguments
  swarm?: Record<string, unknown>; // emit_swarm_result arguments: raw per-sample counts, posts, usd
  beliefs?: Record<string, unknown>; // emit_swarm_beliefs arguments (topic, branches)
  cost_usd?: number;
  truncated?: boolean; // the run stopped at its usd_cap and returned what it had
};
/** `cost_usd`: the run's real spend so far, on every poll. */
export type RunStatus = { state: "running" | "done" | "failed"; output?: RunOutput; error?: string; cost_usd?: number };

/** The core MCP client the Bridge uses, one per capability (synth, swarm, exchange). */
export interface Core {
  call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}
