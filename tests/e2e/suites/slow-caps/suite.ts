// D2 (docs/SLOW-MIND.md section 3): spend caps. The real BettaFish worker and the real Bridge, against a fake provider that bills a
// fixed $0.01 per call (1000 prompt tokens at $10 per million): a run over its per-run cap stops and is marked truncated, the job
// records the engine's real spend, and past the day cap a job is deferred and never reaches the engine.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../../services/core/src/lib/env.ts";
import { Bridge } from "../../../../services/slow-bridge/src/bridge.ts";
import { EngineClient } from "../../../../services/slow-bridge/src/engine.ts";
import type { RunStatus } from "../../../../services/slow-bridge/src/types.ts";
import { bettafishAnswer } from "../../lib/bettafish-stub.ts";
import type { Check } from "../../lib/checks.ts";
import { llmStub } from "../../lib/llm-stub.ts";
import { CAP, MINT_A, slowEnv } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const ENGINE = path.join(env.root, "services", "bettafish", "engine");
const PY = path.join(ENGINE, ".venv-asimog", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const PER_CALL = 0.01;
const CAP_USD = 0.02;

/** The Bridge's own engine client, keeping the spend the engine reported on its last status poll. */
class Spy extends EngineClient {
  reported = 0;
  override async status(runId: string): Promise<RunStatus> {
    const s = await super.status(runId);
    this.reported = s.cost_usd ?? this.reported;
    return s;
  }
}

export const suite: Suite = {
  name: "slow-caps",
  tier: "slow",
  covers: ["services/slow-bridge/", "services/bettafish/engine/asimog_worker.py"],
  proves: "D2: a run over its per-run USD cap stops and is marked truncated; the job's cost_usd is the engine's real reported spend; past SLOW_USD_PER_DAY a job is deferred (day_cap) and never run.",
  async run() {
    if (!fs.existsSync(PY)) return { checks: [{ name: "BettaFish venv exists (uv venv .venv-asimog; uv pip install -r requirements-asimog.txt)", pass: false, detail: PY }], metrics: {} };
    const w = await slowEnv("slowcaps");
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const llm = await llmStub((r) => bettafishAnswer(r.system, r.user), { usage: { prompt_tokens: 1000, completion_tokens: 0 } });
    const port = 7600 + Math.floor(Math.random() * 300);
    const ro = new URL(w.url);
    ro.username = "slow_reader";
    ro.password = "";
    const keys = ["INSIGHT_ENGINE", "KEYWORD_OPTIMIZER", "FORUM_HOST", "REPORT_ENGINE"].flatMap((k) => [[`${k}_API_KEY`, "stub"], [`${k}_BASE_URL`, llm.url], [`${k}_MODEL_NAME`, "stub"]]);
    const worker = spawn(PY, ["asimog_worker.py", "--port", String(port)], {
      cwd: ENGINE,
      env: {
        ...process.env, ...Object.fromEntries(keys), LLM_PRICE_IN_PER_M: "10", LLM_PRICE_OUT_PER_M: "0", ASIMOG_FORK: "1", BETTAFISH_DB_URL: ro.toString(), BETTAFISH_ENGINES: "insight",
        SEARCH_TOOL_TYPE: "AsimogMedia", BETTAFISH_SENTIMENT: "off", MAX_PARAGRAPHS: "2", MAX_REFLECTIONS: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", HF_HUB_OFFLINE: "1", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    worker.stdout.on("data", (d) => (log += d));
    worker.stderr.on("data", (d) => (log += d));
    try {
      await w.seed();
      const eng = new Spy("bettafish", `http://127.0.0.1:${port}`);
      for (let i = 0; i < 120 && !(await eng.healthy()); i++) await new Promise((r) => setTimeout(r, 500));
      if (!(await eng.healthy())) return { checks: [{ name: "the worker starts", pass: false, detail: log.slice(-400) }], metrics: {} };
      const cores = { synth: w.inProc(CAP.synth), swarm: w.inProc(CAP.swarm), exchange: w.inProc(CAP.exchange) };
      let n = 0;
      const cfg = { feedEveryMin: 1, feedWindowMin: 60, coinRunsPerHour: 6, swarmRunsPerHour: 6, presets: { bettafish: "nano", miroshark: "nano" }, chain: "parallel" as const, chainWaitS: 1, runTimeoutS: 120, pollMs: 200, deferMaxMin: 90, stageUsd: { 1: CAP_USD, 2: 1, 3: 1 }, dayUsd: 100 };

      // 1. a nano feed run (stage 1 cap) against a provider that bills $0.01 per call
      const bridge = new Bridge({ sql: w.sql, cores, engines: { bettafish: eng, miroshark: null }, now: () => Date.now(), newId: () => `sj_cap${++n}`, cfg });
      await bridge.schedule();
      await bridge.drain();
      const [job] = await w.sql`select state, error, cost_usd, usd_cap, result from slow.jobs where id = 'sj_cap1'`;
      const truncated = (job?.result as { truncated?: boolean } | null)?.truncated === true;
      const spent = Number(job?.cost_usd ?? 0);
      add("a run over its per-run cap stops truncated", job?.state === "done" && truncated && spent > CAP_USD && spent <= CAP_USD + PER_CALL + 1e-9 && llm.calls.length === Math.round(spent / PER_CALL),
        `spent ${spent.toFixed(2)} of ${Number(job?.usd_cap).toFixed(2)} cap, truncated ${truncated}, ${llm.calls.length} model calls (${job?.state}${job?.error ? ` ${job.error}` : ""})`);
      add("cost_usd on the job equals the engine's reported spend", Math.abs(spent - eng.reported) < 1e-9 && Math.abs(spent - llm.calls.length * PER_CALL) < 1e-9, `job ${spent.toFixed(4)} = engine ${eng.reported.toFixed(4)} = ${llm.calls.length} calls x $${PER_CALL}`);

      // 2. the engine has spent past the day cap: a new grant is deferred and never reaches it
      const calls = llm.calls.length;
      const capped = new Bridge({ sql: w.sql, cores, engines: { bettafish: eng, miroshark: null }, now: () => Date.now(), newId: () => `sj_day${++n}`, cfg: { ...cfg, dayUsd: CAP_USD } });
      w.tape.emit("jev.escalated", { subject: MINT_A, gate_reasons: ["test"], job: "synthesis_coin", voi: 0.4, stage: 1, arm: "run", deferred: false }, { source: "attention", subject: MINT_A });
      await w.tape.flush();
      await capped.schedule();
      await capped.drain();
      const [day] = await w.sql`select state, error from slow.jobs where subject = ${MINT_A} and kind = 'coin'`;
      add("past the day cap a job is deferred, not run", day?.state === "deferred" && day.error === "day_cap" && llm.calls.length === calls, `${day?.state}, reason ${day?.error}, ${llm.calls.length - calls} new model calls`);
      return { checks, metrics: { spent, calls: llm.calls.length } };
    } finally {
      worker.kill();
      llm.close();
      fs.mkdirSync(path.join(env.root, "artifacts"), { recursive: true });
      fs.writeFileSync(path.join(env.root, "artifacts", "slow-caps-worker.log"), log);
      await w.close();
    }
  },
};
