// Engine output -> core MCP write tools (docs/SLOW-MIND.md section 5). No rule lives here: core validates every write (citation
// rule, Jev verify, prose Guard, capability). Reports are published first, so the signals can name them.
import type { Core, Job, RunOutput } from "./types.ts";

export type Cores = { synth: Core; swarm: Core; exchange: Core };
/** `failed`: the run produced nothing to keep (an empty swarm); the job is finished failed with this reason and nothing is written. */
export type Mapped = { reports: string[]; writes: string[]; refused: { tool: string; reason: string }[]; failed?: string };

export async function mapOutput(c: Cores, job: Job, out: RunOutput, parents: string[], window: { from: string | null; to: string | null }): Promise<Mapped> {
  const m: Mapped = { reports: [], writes: [], refused: [] };
  const actions = ((out.swarm?.samples as { actions?: number }[] | undefined) ?? []).reduce((n, s) => n + Number(s.actions ?? 0), 0);
  if (out.swarm && !(actions > 0)) return { ...m, failed: "empty_swarm" }; // no simulated action: no wave_p, no report
  const write = async (core: Core, tool: string, args: Record<string, unknown>) => {
    try {
      await core.call(tool, args);
      m.writes.push(tool);
    } catch (err) {
      m.refused.push({ tool, reason: String((err as Error).message ?? err).slice(0, 200) });
    }
  };
  for (const [i, r] of (out.reports ?? []).entries()) {
    const report_id = `${job.id}_${i}`;
    try {
      await c.exchange.call("report_publish", { report_id, producer: r.producer, kind: r.kind, subject: job.subject, window_from: window.from, window_to: window.to, preset: job.preset, summary: r.summary, cites: r.cites, parent_reports: parents, ir: r.ir ?? null, markdown: r.markdown ?? null, simulated: r.simulated ?? job.engine === "miroshark" });
      m.reports.push(report_id);
    } catch (err) {
      m.refused.push({ tool: "report_publish", reason: String((err as Error).message ?? err).slice(0, 200) });
    }
  }
  // the run's window bounds its citations (core drops a borrowed id): the Bridge's ids and window come last, so engine text never overrides them
  const run = { as_of: window.to, window_min: Math.round((Date.parse(window.to ?? "") - Date.parse(window.from ?? "")) / 60_000) };
  if (out.synthesis_feed) await write(c.synth, "emit_synthesis_feed", { ...out.synthesis_feed, synthesis_id: job.id, preset: job.preset, ...run });
  if (out.synthesis_coin) await write(c.synth, "emit_synthesis_coin", { ...out.synthesis_coin, synthesis_id: job.id, mint: job.subject, preset: job.preset, ...run });
  for (const f of out.forum_lines ?? []) await write(c.synth, "emit_forum_line", { ...f, synthesis_id: job.id, ...run }); // the engine's own round
  if (out.swarm) await write(c.swarm, "emit_swarm_result", { ...out.swarm, swarm_id: job.id, mint: job.subject, preset: job.preset });
  if (out.beliefs) await write(c.swarm, "emit_swarm_beliefs", { ...out.beliefs, swarm_id: job.id, mint: job.subject });
  return m;
}
