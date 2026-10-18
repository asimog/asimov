// Engine output -> core MCP write tools (docs/24 section 5). No rule lives here: core validates every write (citation
// rule, Jev verify, prose Guard, capability). Reports are published first, so the signals can name them.
import type { Core, Job, RunOutput } from "./types.ts";

export type Cores = { synth: Core; swarm: Core; exchange: Core };
export type Mapped = { reports: string[]; writes: string[]; refused: { tool: string; reason: string }[] };

export async function mapOutput(c: Cores, job: Job, out: RunOutput, parents: string[], window: { from: string | null; to: string | null }): Promise<Mapped> {
  const m: Mapped = { reports: [], writes: [], refused: [] };
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
      await c.exchange.call("report_publish", { report_id, producer: r.producer, kind: r.kind, subject: r.subject, window_from: window.from, window_to: window.to, preset: job.preset, summary: r.summary, cites: r.cites, parent_reports: parents, ir: r.ir ?? null, markdown: r.markdown ?? null, simulated: r.simulated ?? job.engine === "miroshark" });
      m.reports.push(report_id);
    } catch (err) {
      m.refused.push({ tool: "report_publish", reason: String((err as Error).message ?? err).slice(0, 200) });
    }
  }
  if (out.synthesis_feed) await write(c.synth, "emit_synthesis_feed", { synthesis_id: job.id, preset: job.preset, ...out.synthesis_feed });
  if (out.mood) await write(c.synth, "emit_mood_feed", { synthesis_id: job.id, ...out.mood });
  if (out.synthesis_coin) await write(c.synth, "emit_synthesis_coin", { synthesis_id: job.id, mint: job.subject, preset: job.preset, ...out.synthesis_coin });
  for (const [i, f] of (out.forum_lines ?? []).entries()) await write(c.synth, "emit_forum_line", { synthesis_id: job.id, round: i, ...f });
  if (out.swarm) await write(c.swarm, "emit_swarm_result", { swarm_id: job.id, mint: job.subject, preset: job.preset, ...out.swarm });
  return m;
}
