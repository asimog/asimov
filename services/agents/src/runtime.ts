// The agents runtime: deterministic triggers fill the job table, a worker claims jobs and runs each agent's graph with
// its own belt of core tools, its own model lane and a Postgres checkpoint thread per job (docs/SYSTEM.md).
import { BudgetExceeded, type Embedder, type Lane, type LaneName } from "@asimog/lane";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { Sql } from "./db.ts";
import { buildGraph } from "./graphs.ts";
import { claim, enqueue, finish, getCursor, type Job, setCursor } from "./jobs.ts";
import { AGENT_NAMES, AGENTS, type AgentName } from "./lanes.ts";
import { itemOf, MEMORY_TOPICS, recall, remember } from "./memory.ts";
import { type Belt, loadBelt } from "./tools.ts";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** period and offset of each cron slot, in UTC (docs/SYSTEM.md: Reporter daily 00:05, Ops every 15 min, Researcher weekly). */
export const SCHEDULES: Partial<Record<AgentName, { period: number; offset: number }>> = {
  noop: { period: MIN, offset: 0 },
  ops: { period: 15 * MIN, offset: 0 },
  reporter: { period: DAY, offset: 5 * MIN },
  researcher: { period: 7 * DAY, offset: 0 },
};

export interface AgentsOpts {
  sql: Sql;
  mcpUrl: string;
  token: (agent: AgentName) => string | undefined;
  /** the lane for one agent: spend metered under the lane name, model chain per agent (config/models.json) */
  lane: (name: LaneName, agent: AgentName) => Lane;
  checkpointer?: BaseCheckpointSaver;
  /** the embedder for agents.memory (E5); without it the Librarian idles and graphs get no recall */
  embedder?: Embedder;
  now?: () => number;
  enabled?: AgentName[];
}

export class AgentsRuntime {
  private belts = new Map<AgentName, Promise<Belt>>();
  private now: () => number;
  private enabled: AgentName[];
  constructor(private o: AgentsOpts) {
    this.now = o.now ?? (() => Date.now());
    this.enabled = o.enabled ?? AGENT_NAMES.filter((a) => a !== "noop");
  }

  /** Librarian (E5): embed texts seen since its cursor. A budget refusal leaves the cursor, so the batch is retried later. */
  async index(limit = 50): Promise<number> {
    if (!this.o.embedder || !this.enabled.includes("librarian")) return 0;
    const belt = await this.belt("librarian");
    const cur = await getCursor(this.o.sql, "librarian");
    const { events } = await belt.call<{ events: { id: string; topic: string; seen_time: string; subject: string | null; body: Record<string, unknown> }[] }>("events_since", { topics: MEMORY_TOPICS, after_seen_time: cur.seen_time ?? undefined, after_id: cur.id ?? undefined, limit });
    if (!events.length) return 0;
    const n = await remember(this.o.sql, this.o.embedder, events.flatMap((e) => itemOf(e) ?? []));
    const last = events.at(-1)!;
    await setCursor(this.o.sql, "librarian", new Date(last.seen_time).toISOString(), last.id);
    return n;
  }

  belt(agent: AgentName): Promise<Belt> {
    if (!this.belts.has(agent)) {
      const token = this.o.token(agent);
      if (!token) return Promise.reject(new Error(`no token for ${agent}: set ${AGENTS[agent].tokenEnv}`));
      this.belts.set(agent, loadBelt(agent, this.o.mcpUrl, token, AGENTS[agent].tools));
    }
    return this.belts.get(agent)!;
  }

  /** Queue what is due: cron slots, then new events. Safe to call as often as you like. */
  async tick(): Promise<{ queued: string[] }> {
    const queued: string[] = [];
    const t = this.now();
    for (const [agent, s] of Object.entries(SCHEDULES) as [AgentName, { period: number; offset: number }][]) {
      if (!this.enabled.includes(agent)) continue;
      const n = Math.floor((t - s.offset) / s.period);
      const slotStart = new Date(n * s.period + s.offset).toISOString();
      if (await enqueue(this.o.sql, agent, { type: "schedule", slot: slotStart }, `${agent}:${slotStart}`)) queued.push(agent);
    }
    await this.index().catch((err) => console.error(JSON.stringify({ librarian: String(err instanceof Error ? err.message : err).slice(0, 200) })));
    // Postmortem: each closed position that lost money
    if (this.enabled.includes("postmortem")) {
      const belt = await this.belt("postmortem");
      const cur = await getCursor(this.o.sql, "postmortem");
      const { events } = await belt.call<{ events: { id: string; seen_time: string; subject: string | null; body: Record<string, unknown> }[] }>("events_since", { topics: ["position.closed"], after_seen_time: cur.seen_time ?? undefined, after_id: cur.id ?? undefined, limit: 50 });
      for (const e of events) {
        if (Number(e.body.net_sol) < 0 && (await enqueue(this.o.sql, "postmortem", { type: "event", event: e }, `postmortem:${e.id}`))) queued.push("postmortem");
        await setCursor(this.o.sql, "postmortem", new Date(e.seen_time).toISOString(), e.id);
      }
      // ...and each missed wave: a callout that ran on a coin no strategy traded (docs/SYSTEM.md)
      const mc = await getCursor(this.o.sql, "postmortem.missed");
      const missed = await belt.call<{ events: { id: string; seen_time: string; subject: string | null; body: Record<string, unknown> }[] }>("missed_waves", { after_seen_time: mc.seen_time ?? undefined, after_id: mc.id ?? undefined });
      for (const e of missed.events) {
        if (await enqueue(this.o.sql, "postmortem", { type: "event", event: e }, `postmortem:${e.id}`)) queued.push("postmortem");
        await setCursor(this.o.sql, "postmortem.missed", new Date(e.seen_time).toISOString(), e.id);
      }
    }
    // Ops: system events (the cron slot above covers the quiet case)
    if (this.enabled.includes("ops")) {
      const belt = await this.belt("ops");
      const cur = await getCursor(this.o.sql, "ops");
      const { events } = await belt.call<{ events: { id: string; seen_time: string; body: Record<string, unknown> }[] }>("events_since", { topics: ["system.gap", "system.note"], after_seen_time: cur.seen_time ?? undefined, after_id: cur.id ?? undefined, limit: 50 });
      for (const e of events) {
        if ((e.body as { kind?: string }).kind !== "mcp.refused" && (await enqueue(this.o.sql, "ops", { type: "event", event: e }, `ops:${e.id}`))) queued.push("ops");
        await setCursor(this.o.sql, "ops", new Date(e.seen_time).toISOString(), e.id);
      }
    }
    // Integrity writer: each live finding at 0.85 or more (the dedupe key is the signal id)
    if (this.enabled.includes("integrity")) {
      const { signals } = await (await this.belt("integrity")).call<{ signals: { id: string }[] }>("board_signals", { kind: "integrity.finding", min_confidence: 0.85, limit: 50 });
      for (const s of signals) if (await enqueue(this.o.sql, "integrity", { type: "event", event: s }, `integrity:${s.id}`)) queued.push("integrity");
    }
    return { queued };
  }

  async runJob(job: Job): Promise<{ ok: boolean; cost_usd: number; result?: unknown; error?: string }> {
    const spec = AGENTS[job.agent];
    const lane = this.o.lane(spec.lane, job.agent);
    const usd0 = lane.usd;
    const belt = await this.belt(job.agent);
    const ev = (kind: "started" | "done", extra: Record<string, unknown> = {}) => belt.call("job_event", { kind, job_id: job.id, agent: job.agent, trigger_event: job.trigger.type === "event" ? String((job.trigger.event as { id?: string }).id ?? "") : null, ...extra });
    await ev("started");
    let out: { ok: boolean; cost_usd: number; result?: unknown; error?: string };
    try {
      const emb = this.o.embedder;
      const graph = buildGraph(job.agent, { belt, lane, recall: emb ? (q) => recall(this.o.sql, emb, q) : undefined }, this.o.checkpointer);
      const res = await graph.invoke({ trigger: job.trigger }, { configurable: { thread_id: job.id } });
      out = { ok: true, cost_usd: lane.usd - usd0, result: res.result ?? {} };
    } catch (err) {
      out = { ok: false, cost_usd: lane.usd - usd0, error: (err instanceof BudgetExceeded ? "budget: " : "") + String(err instanceof Error ? err.message : err).slice(0, 280) };
    }
    await finish(this.o.sql, job.id, out);
    await ev("done", { cost_usd: out.cost_usd, ...(out.error ? { error: out.error } : {}) }).catch(() => {});
    return out;
  }

  /** Run queued jobs one after another until none are left. */
  async work(max = 20): Promise<number> {
    let n = 0;
    for (; n < max; n++) {
      const job = await claim(this.o.sql);
      if (!job) break;
      await this.runJob(job);
    }
    return n;
  }

  async close() {
    for (const b of this.belts.values()) await (await b).close().catch(() => {});
  }
}
