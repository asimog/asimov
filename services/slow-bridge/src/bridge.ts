// The Slow Bridge (docs/SLOW-MIND.md section 5): the one adapter between core and both slow engines. It schedules runs (feed timer,
// escalations), feeds both engines at once (fan-out), maps their outputs to core MCP write tools, and passes reports
// between them (each run gets the newest reports of the other engine as parents). It owns no business rule.
// Ways it fails: an engine is down (the job fails with the reason, the next slot tries again; ingestion never waits);
// a run hangs (RUN_TIMEOUT_S, then failed); the Bridge restarts mid-run (running jobs older than the timeout requeue);
// a slot is still running when the next comes (one job per (engine, kind, subject, slot), never queued twice);
// an escalation storm (per-hour quotas per engine).

import type { EngineClient } from "./engine.ts";
import { claim, enqueue, finish, requeueStale } from "./jobs.ts";
import { type Cores, mapOutput } from "./mapper.ts";
import type { Engine, Job, Kind } from "./types.ts";

type Sql = import("postgres").Sql<Record<string, unknown>>;

export type BridgeConfig = {
  feedEveryMin: number; // BETTAFISH_FEED_EVERY_MIN
  feedWindowMin: number;
  coinRunsPerHour: number; // BETTAFISH_COIN_RUNS_PER_HOUR
  swarmRunsPerHour: number; // SWARM_RUNS_PER_HOUR
  presets: { bettafish: string; miroshark: string };
  chain: "parallel" | "bettafish_first"; // SLOW_CHAIN
  chainWaitS: number;
  runTimeoutS: number;
  pollMs: number;
};

export type BridgeDeps = { sql: Sql; cores: Cores; engines: Record<Engine, EngineClient | null>; now: () => number; newId: () => string; cfg: BridgeConfig };

type Ev = { id: string; seen_time: string; subject: string | null; body: Record<string, unknown> };

export class Bridge {
  stats = { queued: 0, runs: 0, done: 0, failed: 0, reports: 0, writes: 0, refused: 0 };
  constructor(private d: BridgeDeps) {}

  private iso(ms = this.d.now()) {
    return new Date(ms).toISOString();
  }

  private async queue(engine: Engine, kind: Kind, subject: string, slot: string): Promise<boolean> {
    if (!this.d.engines[engine]) return false; // that engine is off: nothing to queue
    const ok = await enqueue(this.d.sql, { id: this.d.newId(), engine, kind, subject, preset: this.d.cfg.presets[engine], slot });
    if (ok) this.stats.queued++;
    return ok;
  }

  private async quotaLeft(engine: Engine, kind: Kind, perHour: number): Promise<boolean> {
    const [r] = await this.d.sql`select count(*)::int n from slow.jobs where engine = ${engine} and kind = ${kind} and slot >= ${this.iso(this.d.now() - 3_600_000)}`;
    return (r!.n as number) < perHour;
  }

  /** Queue what is due: the feed slot, then each new escalation (both engines on the same coin). */
  async schedule(): Promise<void> {
    const t = this.d.now();
    const period = this.d.cfg.feedEveryMin * 60_000;
    await this.queue("bettafish", "feed", "global", this.iso(Math.floor(t / period) * period));

    const [cur] = await this.d.sql`select seen_time, event_id from slow.cursors where name = 'escalations'`;
    const { events } = await this.d.cores.exchange.call<{ events: Ev[] }>("events_since", { topics: ["attention.grant", "jev.escalated"], after_seen_time: cur?.seen_time ? (cur.seen_time as Date).toISOString() : undefined, after_id: (cur?.event_id as string | undefined) ?? undefined, limit: 50 });
    for (const e of events) {
      const job = String(e.body.job);
      const mint = String(e.body.subject ?? e.subject);
      const slot = new Date(e.seen_time).toISOString();
      if ((job === "synthesis_deep" || job === "synthesis_coin") && (await this.quotaLeft("bettafish", "coin", this.d.cfg.coinRunsPerHour))) await this.queue("bettafish", "coin", mint, slot);
      if (job === "swarm_run" || job === "synthesis_coin") { // a coin escalation feeds both engines at once
        if (await this.quotaLeft("miroshark", "swarm", this.d.cfg.swarmRunsPerHour)) await this.queue("miroshark", "swarm", mint, slot);
      }
      await this.d.sql`insert into slow.cursors (name, seen_time, event_id) values ('escalations', ${slot}, ${e.id})
        on conflict (name) do update set seen_time = excluded.seen_time, event_id = excluded.event_id`;
    }
  }

  /** Parents for a run: the newest reports of the other engine on this subject (docs/SLOW-MIND.md section 6), published before now. */
  private async parents(job: Job): Promise<string[]> {
    const other = job.engine === "bettafish" ? "miroshark." : "bettafish.";
    const { reports } = await this.d.cores.exchange.call<{ reports: { report_id: string }[] }>("reports_for", { subject: job.subject, producer_prefix: other, limit: 3 });
    return reports.map((r) => r.report_id);
  }

  /** With SLOW_CHAIN=bettafish_first, a swarm waits (up to chainWaitS) for the BettaFish coin run on the same slot. */
  private async waitForChain(job: Job): Promise<void> {
    if (this.d.cfg.chain !== "bettafish_first" || job.engine !== "miroshark") return;
    const until = this.d.now() + this.d.cfg.chainWaitS * 1000;
    while (this.d.now() < until) {
      const [b] = await this.d.sql`select state from slow.jobs where engine = 'bettafish' and kind = 'coin' and subject = ${job.subject} and slot = ${job.slot}`;
      if (!b || b.state === "done" || b.state === "failed") return;
      await new Promise((r) => setTimeout(r, this.d.cfg.pollMs));
    }
  }

  /** Run one queued job end to end. Returns false when the queue is empty. */
  async runOne(): Promise<boolean> {
    await requeueStale(this.d.sql, this.iso(this.d.now() - this.d.cfg.runTimeoutS * 2000));
    const job = await claim(this.d.sql, this.iso());
    if (!job) return false;
    this.stats.runs++;
    const engine = this.d.engines[job.engine];
    try {
      if (!engine) throw new Error(`${job.engine} is off`);
      await this.waitForChain(job);
      const parents = await this.parents(job);
      const windowMin = job.kind === "feed" ? this.d.cfg.feedWindowMin : 60;
      // MiroShark reads no database: the swarm's seed (the coin dossier, the parent reports' text) comes in the request
      const extra = job.engine === "miroshark"
        ? { dossier: await this.d.cores.swarm.call("coin_dossier", { mint: job.subject }), parent_texts: (await this.d.cores.exchange.call<{ reports: { report_id: string; producer: string; summary: string; markdown: string | null }[] }>("reports_for", { subject: job.subject, producer_prefix: "bettafish.", limit: 3 })).reports }
        : {};
      const runId = await engine.start({ job_id: job.id, kind: job.kind, subject: job.subject, preset: job.preset, window_min: windowMin, started_at: this.iso(), as_of: job.slot, parent_reports: parents, ...extra });
      const until = this.d.now() + this.d.cfg.runTimeoutS * 1000;
      for (;;) {
        const s = await engine.status(runId);
        if (s.state === "failed") throw new Error(`engine: ${s.error ?? "failed"}`);
        if (s.state === "done") {
          const m = await mapOutput(this.d.cores, job, s.output ?? {}, parents, { from: this.iso(Date.parse(job.slot) - windowMin * 60_000), to: job.slot });
          this.stats.reports += m.reports.length;
          this.stats.writes += m.writes.length;
          this.stats.refused += m.refused.length;
          await finish(this.d.sql, job.id, this.iso(), { ok: true, cost_usd: s.output?.cost_usd ?? 0, result: m });
          this.stats.done++;
          return true;
        }
        if (this.d.now() > until) throw new Error(`run timed out after ${this.d.cfg.runTimeoutS} s`);
        await new Promise((r) => setTimeout(r, this.d.cfg.pollMs));
      }
    } catch (err) {
      await finish(this.d.sql, job.id, this.iso(), { ok: false, cost_usd: 0, error: String((err as Error).message ?? err).slice(0, 300) });
      this.stats.failed++;
      return true;
    }
  }

  /** Drain the queue; runs of different engines go in parallel, one at a time per engine. */
  async drain(): Promise<void> {
    const lanes = Object.keys(this.d.engines).filter((e) => this.d.engines[e as Engine]).length || 1;
    await Promise.all(Array.from({ length: lanes }, async () => {
      while (await this.runOne()) { /* next */ }
    }));
  }
}
