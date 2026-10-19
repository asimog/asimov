// Runs the vendored BettaFish worker (services/bettafish/engine/asimog_worker.py) against a fresh slow-mind world and
// an offline stub model, through the real Slow Bridge. Shared by the bettafish-insight and bettafish-full suites.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../services/core/src/lib/env.ts";
import { Bridge } from "../../../services/slow-bridge/src/bridge.ts";
import { EngineClient } from "../../../services/slow-bridge/src/engine.ts";
import { bettafishAnswer } from "./bettafish-stub.ts";
import { llmStub, type StubReq } from "./llm-stub.ts";
import { CAP, slowEnv } from "./slow.ts";

export const ENGINE = path.join(env.root, "services", "bettafish", "engine");
export const PY = path.join(ENGINE, ".venv-asimog", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

export async function runBettafish(tag: string, engines: string, extraEnv: Record<string, string>, prepare?: (w: Awaited<ReturnType<typeof slowEnv>>) => Promise<void>) {
  const w = await slowEnv(tag);
  const llm = await llmStub((r: StubReq) => bettafishAnswer(r.system, r.user));
  const port = 7600 + Math.floor(Math.random() * 300);
  const ro = new URL(w.url);
  ro.username = "slow_reader";
  ro.password = "";
  const keys = ["INSIGHT_ENGINE", "QUERY_ENGINE", "MEDIA_ENGINE", "REPORT_ENGINE", "FORUM_HOST", "KEYWORD_OPTIMIZER"].flatMap((k) => [[`${k}_API_KEY`, "stub"], [`${k}_BASE_URL`, llm.url], [`${k}_MODEL_NAME`, "stub"]]);
  const worker = spawn(PY, ["asimog_worker.py", "--port", String(port)], {
    cwd: ENGINE,
    env: { ...process.env, ...Object.fromEntries(keys), ASIMOG_FORK: "1", BETTAFISH_DB_URL: ro.toString(), BETTAFISH_ENGINES: engines, SEARCH_TOOL_TYPE: "AsimogMedia", QUERY_SEARCH: "tavily,x", BETTAFISH_SENTIMENT: "off", MAX_PARAGRAPHS: "2", MAX_REFLECTIONS: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", HF_HUB_OFFLINE: "1", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", TAVILY_API_KEY: "", X_BEARER_TOKEN: "", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  worker.stdout.on("data", (d) => (log += d));
  worker.stderr.on("data", (d) => (log += d));
  await w.seed();
  await prepare?.(w);
  const eng = new EngineClient("bettafish", `http://127.0.0.1:${port}`);
  for (let i = 0; i < 120 && !(await eng.healthy()); i++) await new Promise((r) => setTimeout(r, 500));
  const healthy = await eng.healthy();
  const cores = { synth: w.inProc(CAP.synth), swarm: w.inProc(CAP.swarm), exchange: w.inProc(CAP.exchange) };
  const bridge = new Bridge({ sql: w.sql, cores, engines: { bettafish: eng, miroshark: null }, now: () => Date.now(), newId: () => `sj_${tag}`, cfg: { feedEveryMin: 30, feedWindowMin: 60, coinRunsPerHour: 6, swarmRunsPerHour: 6, presets: { bettafish: "lite", miroshark: "lite" }, chain: "parallel", chainWaitS: 1, runTimeoutS: 240, pollMs: 300, deferMaxMin: 90 } });
  if (healthy) {
    await bridge.schedule();
    await bridge.drain();
  }
  const [job] = await w.sql`select state, error, result from slow.jobs where id = ${`sj_${tag}`}`;
  const nodes = (k: string) => llm.calls.filter((c) => c.system.includes(k)).length;
  return {
    w, llm, healthy, job, nodes, log,
    async close() {
      fs.mkdirSync(path.join(env.root, "artifacts"), { recursive: true });
      fs.writeFileSync(path.join(env.root, "artifacts", `${tag}-worker.log`), log);
      worker.kill();
      llm.close();
      await w.close();
    },
  };
}
