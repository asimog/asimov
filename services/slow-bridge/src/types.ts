// The one contract both engines speak to the Bridge (docs/SLOW-MIND.md section 5): POST /asimog/runs starts a run, GET /asimog/runs/:id
// reports it. BettaFish's asimog_worker.py and MiroShark's asimog blueprint both implement it.
export type Engine = "bettafish" | "miroshark";
export type Kind = "feed" | "coin" | "swarm";
export type Job = { id: string; engine: Engine; kind: Kind; subject: string; preset: string; slot: string };

export type RunRequest = { job_id: string; kind: Kind; subject: string; preset: string; window_min: number; started_at: string; parent_reports: string[]; dossier?: unknown; parent_texts?: { report_id: string; producer: string; summary: string; markdown: string | null }[] };
export type ReportOut = { producer: string; kind: Kind; subject: string; summary: string; cites: string[]; ir?: Record<string, unknown> | null; markdown?: string | null; simulated?: boolean };
export type RunOutput = {
  reports?: ReportOut[];
  synthesis_feed?: Record<string, unknown>; // emit_synthesis_feed arguments
  synthesis_coin?: Record<string, unknown>; // emit_synthesis_coin arguments
  mood?: Record<string, unknown>; // emit_mood_feed arguments
  forum_lines?: Record<string, unknown>[]; // emit_forum_line arguments
  swarm?: Record<string, unknown>; // emit_swarm_result arguments
  beliefs?: Record<string, unknown>; // emit_swarm_beliefs arguments (topic, branches)
  cost_usd?: number;
};
export type RunStatus = { state: "running" | "done" | "failed"; output?: RunOutput; error?: string };

/** The core MCP client the Bridge uses, one per capability (synth, swarm, exchange). */
export interface Core {
  call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}
