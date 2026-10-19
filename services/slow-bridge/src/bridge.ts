// The Slow Bridge (docs/SLOW-MIND.md section 5): the one adapter between core and both slow engines. It schedules runs (feed timer,
// escalations), feeds both engines at once (fan-out), maps their outputs to core MCP write tools, and passes reports
// between them (each run gets the newest reports of the other engine as parents). It owns no business rule: which coin and
// which stage come from core's escalation gate.
// Ways it fails: an engine is down (the job fails with the reason, the next slot tries again; ingestion never waits);
// a run hangs (RUN_TIMEOUT_S, then failed); the Bridge restarts mid-run (running jobs older than the timeout requeue);
// a slot is still running when the next comes (one job per (engine, kind, subject, slot), never queued twice);
// an escalation storm (per-hour quotas per engine: a grant with no room is deferred, promoted oldest first when room
// returns, and expires after SLOW_DEFER_MAX_MIN); a long run delays escalations (schedule and drain run on their own loops).
import type { EngineClient } from "./engine.ts";
import { claim, daySpend, defer, enqueue, expireDeferred, finish, promoteDeferred, requeueStale } from "./jobs.ts";
import { type Cores, mapOutput } from "./mapper.ts";
import type { Engine, Job, Kind } from "./types.ts";

type Sql = import("postgres").Sql<Record<string, unknown>>;

export type BridgeConfig = {
  feedEveryMin: number; // BETTAFISH_FEED_EVERY_MIN
  feedWindowMin: number;
  coinRunsPerHour: number; // BETTAFISH_COIN_RUNS_PER_HOUR
  swarmRunsPerHour: number; // SWARM_RUNS_PER_HOUR
  presets: { bettafish: string; miroshark: string }; // feed runs and stage 3
  chain: "parallel" | "bettafish_first"; // SLOW_CHAIN
  chainWaitS: number;
  runTimeoutS: number;
  pollMs: number;
  deferMaxMin: number; // SLOW_DEFER_MAX_MIN
  stageUsd: Record<1 | 2 | 3, number>; // SLOW_STAGE<n>_USD_PER_RUN: each run's cap
  dayUsd: number; // SLOW_USD_PER_DAY, per engine
};

export type BridgeDeps = { sql: Sql; cores: Cores; engines: Record<Engine, EngineClient | null>; now: () => number; newId: () => string; cfg: BridgeConfig };

type Ev = { id: string; seen_time: string; subject: string | null; body: Record<string, unknown> };
type Target = { engine: Engine; kind: Kind; preset: string; stage: 1 | 2 | 3 | null };

/** What each stage runs (docs/SLOW-MIND.md section 3): stage 1 BettaFish nano; stage 2 BettaFish lite and a small swarm; stage 3 the owner's presets. */
const STAGES: Record<number, (p: BridgeConfig["presets"]) => Target[]> = {
  1: () => [{ engine: "bettafish", kind: "coin", preset: "nano", stage: 1 }],
  2: () => [{ engine: "bettafish", kind: "coin", preset: "lite", stage: 2 }, { engine: "miroshark", kind: "swarm", preset: "nano", stage: 2 }],
  3: (p) => [{ engine: "bettafish", kind: "coin", preset: p.bettafish, stage: 3 }, { engine: "miroshark", kind: "swarm", preset: p.miroshark, stage: 3 }],
};
/** A feed run has no stage: its cap follows its preset's size. */
const PRESET_STAGE: Record<string, 1 | 2 | 3> = { nano: 1, lite: 2, full: 3 };

export class Bridge {
  stats = { queued: 0, deferred: 0, runs: 0, done: 0, failed: 0, reports: 0, writes: 0, refused: 0 };
  constructor(private d: BridgeDeps) {}

  private iso(ms = this.d.now()) {
    return new Date(ms).toISOString();
  }

  private perHour(t: Target) {
    return t.engine === "bettafish" ? this.d.cfg.coinRunsPerHour : this.d.cfg.swarmRunsPerHour;
  }

  /** Runs left this hour for an engine and kind: jobs in the last hour that took a slot (not deferred, not expired). */
  private async quotaLeft(engine: Engine, kind: Kind, perHour: number): Promise<number> {
    const [r] = await this.d.sql`select count(*)::int n from slow.jobs where engine = ${engine} and kind = ${kind} and slot >= ${this.iso(this.d.now() - 3_600_000)}
      and state <> 'deferred' and coalesce(error, '') <> 'expired'`;
    return perHour - (r!.n as number);
  }

  private async queue(t: Target, subject: string, slot: string, deferred?: string): Promise<boolean> {
    if (!this.d.engines[t.engine]) return false; // that engine is off: nothing to queue
    const why = deferred ?? (t.kind === "feed" || (await this.quotaLeft(t.engine, t.kind, this.perHour(t))) > 0 ? undefined : "quota"); // the feed has its own timer
    const usd_cap = this.d.cfg.stageUsd[t.stage ?? PRESET_STAGE[t.preset] ?? 3];
    const ok = await enqueue(this.d.sql, { id: this.d.newId(), engine: t.engine, kind: t.kind, subject, preset: t.preset, slot, stage: t.stage, usd_cap, deferred: why });
    if (ok) this.stats[why ? "deferred" : "queued"]++;
    return ok;
  }

  /** The jobs an escalation event asks for; none for a control coin. */
  private targets(e: Ev): Target[] {
    const b = e.body;
    if (b.arm === "control" || b.job === null) return []; // control: recorded by core, never run
    if (typeof b.stage === "number") return STAGES[b.stage]?.(this.d.cfg.presets) ?? [];
    if (b.job === "synthesis_deep") return [{ engine: "bettafish", kind: "coin", preset: this.d.cfg.presets.bettafish, stage: 3 }]; // attention.grant: the owner's presets
    if (b.job === "swarm_run") return [{ engine: "miroshark", kind: "swarm", preset: this.d.cfg.presets.miroshark, stage: 3 }];
    return [];
  }

  /** Queue what is due: expire and promote deferred jobs (oldest first), the feed slot, then each new escalation. */
  async schedule(): Promise<number> {
    const t = this.d.now();
    const before = this.stats.queued;
    await expireDeferred(this.d.sql, this.iso(t - this.d.cfg.deferMaxMin * 60_000), this.iso(t));
    for (const [engine, kind, perHour] of [["bettafish", "coin", this.d.cfg.coinRunsPerHour], ["miroshark", "swarm", this.d.cfg.swarmRunsPerHour]] as const)
      await promoteDeferred(this.d.sql, engine, kind, await this.quotaLeft(engine, kind, perHour));
    const period = this.d.cfg.feedEveryMin * 60_000;
    await this.queue({ engine: "bettafish", kind: "feed", preset: this.d.cfg.presets.bettafish, stage: null }, "global", this.iso(Math.floor(t / period) * period));

    const [cur] = await this.d.sql`select seen_time, event_id from slow.cursors where name = 'escalations'`;
    const { events } = await this.d.cores.exchange.call<{ events: Ev[] }>("events_since", { topics: ["attention.grant", "jev.escalated"], after_seen_time: cur?.seen_time ? (cur.seen_time as Date).toISOString() : undefined, after_id: (cur?.event_id as string | undefined) ?? undefined, limit: 50 });
    for (const e of events) {
      const mint = String(e.body.subject ?? e.subject);
      const slot = new Date(e.seen_time).toISOString();
      for (const target of this.targets(e)) await this.queue(target, mint, slot, e.body.deferred === true ? "core_deferred" : undefined);
      await this.d.sql`insert into slow.cursors (name, seen_time, event_id) values ('escalations', ${slot}, ${e.id})
        on conflict (name) do update set seen_time = excluded.seen_time, event_id = excluded.event_id`;
    }
    return this.stats.queued - before;
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
      if (!b || b.state === "done" || b.state === "failed" || b.state === "deferred") return;
      await new Promise((r) => setTimeout(r, this.d.cfg.pollMs));
    }
  }

  /** Run one queued job end to end. Returns false when the queue is empty. */
  async runOne(): Promise<boolean> {
    await requeueStale(this.d.sql, this.iso(this.d.now() - this.d.cfg.runTimeoutS * 2000));
    const job = await claim(this.d.sql, this.iso());
    if (!job) return false;
    if ((await daySpend(this.d.sql, job.engine, job.slot)) >= this.d.cfg.dayUsd) { // SLOW_USD_PER_DAY: never run, wait for expiry
      await defer(this.d.sql, job.id, "day_cap");
      this.stats.deferred++;
      return true;
    }
    this.stats.runs++;
    const engine = this.d.engines[job.engine];
    let spent = 0; // the engine's real spend, from its last status poll: recorded even when the run fails
    try {
      if (!engine) throw new Error(`${job.engine} is off`);
      await this.waitForChain(job);
      const parents = await this.parents(job);
      const windowMin = job.kind === "feed" ? this.d.cfg.feedWindowMin : 60;
      // MiroShark reads no database: the swarm's seed (the coin dossier, the parent reports' text) comes in the request
      const extra = job.engine === "miroshark"
        ? { dossier: await this.d.cores.swarm.call("coin_dossier", { mint: job.subject }), parent_texts: (await this.d.cores.exchange.call<{ reports: { report_id: string; producer: string; summary: string; markdown: string | null }[] }>("reports_for", { subject: job.subject, producer_prefix: "bettafish.", limit: 3 })).reports }
        : {};
      const runId = await engine.start({ job_id: job.id, kind: job.kind, subject: job.subject, preset: job.preset, usd_cap: job.usd_cap, window_min: windowMin, started_at: this.iso(), as_of: job.slot, parent_reports: parents, ...extra });
      const until = this.d.now() + this.d.cfg.runTimeoutS * 1000;
      for (;;) {
        const s = await engine.status(runId);
        spent = s.cost_usd ?? s.output?.cost_usd ?? spent;
        if (s.state === "failed") throw new Error(`engine: ${s.error ?? "failed"}`);
        if (s.state === "done") {
          const m = await mapOutput(this.d.cores, job, s.output ?? {}, parents, { from: this.iso(Date.parse(job.slot) - windowMin * 60_000), to: job.slot });
          this.stats.reports += m.reports.length;
          this.stats.writes += m.writes.length;
          this.stats.refused += m.refused.length;
          await finish(this.d.sql, job.id, this.iso(), { ok: !m.failed, cost_usd: spent, result: { ...m, truncated: s.output?.truncated === true }, error: m.failed });
          this.stats[m.failed ? "failed" : "done"]++;
          return true;
        }
        if (this.d.now() > until) {
          await engine.cancel(runId); // the worker stops spending at its next model call
          throw new Error(`run timed out after ${this.d.cfg.runTimeoutS} s`);
        }
        await new Promise((r) => setTimeout(r, this.d.cfg.pollMs));
      }
    } catch (err) {
      await finish(this.d.sql, job.id, this.iso(), { ok: false, cost_usd: spent, error: String((err as Error).message ?? err).slice(0, 300) });
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

  /**
   * Two loops, each with its own busy flag: escalations are read every `scheduleMs` whether or not a run is draining, and a
   * tick that queued something wakes the drain loop. Returns a stop function.
   */
  start(scheduleMs: number, drainMs: number, onError: (where: string, err: unknown) => void = () => {}): () => void {
    let scheduling = false;
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        await this.drain();
      } catch (err) {
        onError("drain", err);
      } finally {
        draining = false;
      }
    };
    const schedule = async () => {
      if (scheduling) return;
      scheduling = true;
      try {
        if ((await this.schedule()) > 0) void drain();
      } catch (err) {
        onError("schedule", err);
      } finally {
        scheduling = false;
      }
    };
    void schedule().then(drain);
    const timers = [setInterval(() => void schedule(), scheduleMs), setInterval(() => void drain(), drainMs)];
    return () => timers.forEach(clearInterval);
  }
}
