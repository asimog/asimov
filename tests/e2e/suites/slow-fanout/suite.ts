// Fan-out and independence (docs/SLOW-MIND.md section 3, rule 1; P7). One coin escalation starts BettaFish and MiroShark on the
// same coin at once, both reading the same feed; meanwhile a sense writes the Tape at a fixed rate. Proves ingestion
// keeps its rate and write latency while both engines run, and again after both are killed mid-run; the Bridge records
// the killed runs as failed with a reason and never blocks the writer.
// Ways it fails: an engine holds a lock the writer needs (latency jumps while it runs); the Bridge waits on a dead engine
// inside the writer's path (rate drops after the kill); the escalation feeds only one engine (one job, not two).
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../../services/core/src/lib/env.ts";
import { Bridge } from "../../../../services/slow-bridge/src/bridge.ts";
import { EngineClient } from "../../../../services/slow-bridge/src/engine.ts";
import { ENGINE as BF_DIR, PY as BF_PY } from "../../lib/bettafish.ts";
import { bettafishAnswer } from "../../lib/bettafish-stub.ts";
import type { Check } from "../../lib/checks.ts";
import { llmStub } from "../../lib/llm-stub.ts";
import { CAP, MINT_A, slowEnv, WALLETS } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const MS_DIR = path.join(env.root, "services", "miroshark", "engine", "backend");
const MS_PY = path.join(MS_DIR, ".venv-asimog", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]! : 0);

export const suite: Suite = {
  name: "slow-fanout",
  tier: "slow",
  covers: ["services/slow-bridge/", "services/agents/"],
  proves: "One escalation starts both slow engines on the same coin; Tape ingestion keeps its rate and latency while they run and after they are killed.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    if (!fs.existsSync(BF_PY) || !fs.existsSync(MS_PY)) return { checks: [{ name: "both engine venvs exist", pass: false, detail: `${BF_PY} ${MS_PY}` }], metrics: {} };
    const w = await slowEnv("fanout");
    // camel agents (MiroShark) get tools; BettaFish nodes get their scripted JSON. camel uses tools only for model names
    // it knows, so MiroShark asks the stub for gpt-4o-mini
    const llm = await llmStub((r) => (r.tools.length ? (r.afterTool ? "ok" : `TOOL:buy {"mint_or_symbol":"PEPE","amount_sol":0.01}`) : bettafishAnswer(r.system, r.user)));
    const ro = new URL(w.url);
    ro.username = "slow_reader";
    ro.password = "";
    const base = { ...process.env, ASIMOG_FORK: "1", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" };
    const bfKeys = ["INSIGHT_ENGINE", "QUERY_ENGINE", "MEDIA_ENGINE", "REPORT_ENGINE", "FORUM_HOST", "KEYWORD_OPTIMIZER"].flatMap((k) => [[`${k}_API_KEY`, "stub"], [`${k}_BASE_URL`, llm.url], [`${k}_MODEL_NAME`, "stub"]]);
    const bfPort = 7600 + Math.floor(Math.random() * 300);
    const msPort = 7900 + Math.floor(Math.random() * 90);
    const logs = { bettafish: "", miroshark: "" };
    const procs: Record<string, ChildProcess> = {
      bettafish: spawn(BF_PY, ["asimog_worker.py", "--port", String(bfPort)], { cwd: BF_DIR, stdio: ["ignore", "pipe", "pipe"], env: { ...base, ...Object.fromEntries(bfKeys), BETTAFISH_DB_URL: ro.toString(), BETTAFISH_ENGINES: "insight", SEARCH_TOOL_TYPE: "AsimogMedia", QUERY_SEARCH: "tavily,x", BETTAFISH_SENTIMENT: "off", MAX_PARAGRAPHS: "2", MAX_REFLECTIONS: "1", HF_HUB_OFFLINE: "1", TAVILY_API_KEY: "", X_BEARER_TOKEN: "" } }),
      miroshark: spawn(MS_PY, ["asimog_worker.py", "--port", String(msPort)], { cwd: MS_DIR, stdio: ["ignore", "pipe", "pipe"], env: { ...base, LLM_API_KEY: "stub", LLM_BASE_URL: llm.url, LLM_MODEL_NAME: "gpt-4o-mini", SWARM_CALLER_AGENTS: "3", SWARM_FOLLOWER_AGENTS: "4", SWARM_ROUNDS: "40", SWARM_SAMPLES: "1", SWARM_BRANCHES: "A", SWARM_PLATFORMS: "pumpfun", SWARM_GRAPH_FEATURES: "off", SWARM_REPORT: "numbers", SWARM_TIMEOUT_S: "600" } }),
    };
    for (const [k, p] of Object.entries(procs)) {
      p.stdout!.on("data", (d) => (logs[k as keyof typeof logs] += d));
      p.stderr!.on("data", (d) => (logs[k as keyof typeof logs] += d));
    }
    const bf = new EngineClient("bettafish", `http://127.0.0.1:${bfPort}`);
    const ms = new EngineClient("miroshark", `http://127.0.0.1:${msPort}`);
    // the sense: one trade event every 20 ms, flushed every 5, latency per flush
    let phase = "idle";
    const lat: Record<string, number[]> = { baseline: [], running: [], killed: [] };
    const wrote: Record<string, { n: number; ms: number }> = { baseline: { n: 0, ms: 0 }, running: { n: 0, ms: 0 }, killed: { n: 0, ms: 0 } };
    let stop = false;
    let i = 0;
    const sense = (async () => {
      while (!stop) {
        const t0 = Date.now();
        w.tape.emit("trade.curve", { mint: MINT_A, tx: `fan${i++}`, slot_index_id: null, ts: w.clock.iso(), side: "buy", wallet: WALLETS[0]!, sol: 0.1, usd: null, tokens: 1e6, price_sol: 3e-8, price_usd: null, mcap_usd: null, on_curve: true, program: null, pool_sol: null }, { source: "nats", subject: MINT_A });
        if (i % 5 === 0) {
          const f0 = Date.now();
          await w.tape.flush();
          lat[phase]?.push(Date.now() - f0);
        }
        if (wrote[phase]) wrote[phase]!.n++;
        await sleep(Math.max(0, 20 - (Date.now() - t0)));
      }
    })();
    const timed = async (name: string, f: () => Promise<void>) => {
      phase = name;
      const t0 = Date.now();
      await f();
      wrote[name]!.ms = Date.now() - t0;
    };
    try {
      await w.seed();
      for (let k = 0; k < 180 && !((await bf.healthy()) && (await ms.healthy())); k++) await sleep(500);
      add("both engine workers start", (await bf.healthy()) && (await ms.healthy()), `${logs.bettafish.slice(-200)} ${logs.miroshark.slice(-200)}`);
      await timed("baseline", () => sleep(5000));
      const cores = { synth: w.inProc(CAP.synth), swarm: w.inProc(CAP.swarm), exchange: w.inProc(CAP.exchange) };
      let n = 0;
      const bridge = new Bridge({ sql: w.sql, cores, engines: { bettafish: bf, miroshark: ms }, now: () => Date.now(), newId: () => `sj_fan${n++}`, cfg: { feedEveryMin: 1440, feedWindowMin: 60, coinRunsPerHour: 6, swarmRunsPerHour: 6, presets: { bettafish: "lite", miroshark: "lite" }, chain: "parallel", chainWaitS: 1, runTimeoutS: 600, pollMs: 300 } });
      w.tape.emit("jev.escalated", { subject: MINT_A, gate_reasons: ["voi"], job: "synthesis_coin", voi: 0.5 }, { source: "reflex", subject: MINT_A });
      await w.tape.flush();
      await bridge.schedule();
      await w.sql`update slow.jobs set state = 'done' where kind = 'feed'`; // the feed slot is not under test
      const queued = await w.sql`select engine, subject, slot from slow.jobs where kind <> 'feed' order by engine`;
      add("one escalation queues both engines on the same coin and slot", queued.length === 2 && queued.every((q) => q.subject === MINT_A && String(q.slot) === String(queued[0]!.slot)), JSON.stringify(queued.map((q) => q.engine)));
      let bothRunning = 0;
      let calls = { bf: 0, ms: 0 };
      let drained: Promise<void> = Promise.resolve();
      await timed("running", async () => {
        drained = bridge.drain();
        for (let k = 0; k < 240; k++) {
          await sleep(250);
          const r = await w.sql`select count(*)::int n from slow.jobs where kind <> 'feed' and state = 'running'`;
          if (r[0]!.n === 2) bothRunning++;
          calls = { bf: llm.calls.filter((c) => !c.tools.length).length, ms: llm.calls.filter((c) => c.tools.length).length };
          if (bothRunning >= 20 && calls.bf > 0 && calls.ms > 0) break; // both engines are calling the model, for at least 5 s together
        }
      });
      add("both engines ran at the same time on the coin, calling the model", bothRunning >= 20 && calls.bf > 0 && calls.ms > 0, `${bothRunning} samples with both running; model calls ${JSON.stringify(calls)}`);
      const before = llm.calls.length;
      procs.bettafish!.kill();
      procs.miroshark!.kill();
      await timed("killed", () => sleep(5000));
      await drained;
      const jobs = await w.sql`select engine, state, error from slow.jobs where kind <> 'feed' order by engine`;
      add("killed runs are recorded as failed with a reason", jobs.some((j) => j.state === "failed" && String(j.error).length > 0) && jobs.every((j) => j.state === "failed" || j.state === "done"), JSON.stringify(jobs));
      const rate = (k: string) => (wrote[k]!.ms ? (wrote[k]!.n * 1000) / wrote[k]!.ms : 0);
      const [rb, rr, rk] = [rate("baseline"), rate("running"), rate("killed")];
      add("ingestion keeps its rate while both engines run (90% of baseline or more)", rr >= 0.9 * rb, `${rb.toFixed(1)} -> ${rr.toFixed(1)} events/s`);
      add("ingestion keeps its rate after both are killed (90% of baseline or more)", rk >= 0.9 * rb, `${rb.toFixed(1)} -> ${rk.toFixed(1)} events/s`);
      const [lb, lr, lk] = [p95(lat.baseline!), p95(lat.running!), p95(lat.killed!)];
      add("Tape write latency p95 stays under 250 ms in every phase", Math.max(lb, lr, lk) < 250, `p95 ${lb} / ${lr} / ${lk} ms`);
      stop = true;
      await sense;
      const [{ n: rows }] = (await w.sql`select count(*)::int n from tape.events where topic = 'trade.curve' and source = 'nats'`) as unknown as [{ n: number }];
      add("every sense event reached the Tape", rows === i, `${rows} of ${i}`);
      return { checks, metrics: { rate_baseline: +rb.toFixed(2), rate_running: +rr.toFixed(2), rate_killed: +rk.toFixed(2), p95_ms: [lb, lr, lk], model_calls_before_kill: before } };
    } finally {
      stop = true;
      await sense;
      for (const p of Object.values(procs)) p.kill();
      fs.mkdirSync(path.join(env.root, "artifacts"), { recursive: true });
      fs.writeFileSync(path.join(env.root, "artifacts", "slow-fanout-workers.log"), `${logs.bettafish}\n----\n${logs.miroshark}`);
      llm.close();
      await w.close();
    }
  },
};
