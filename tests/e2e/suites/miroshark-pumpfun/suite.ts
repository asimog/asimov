// MiroShark's real Wonderwall engine with our Pump.fun module (docs/24 P5), offline: camel agents act through tool
// calls answered by a stub model; the Bridge sends the coin dossier from core; branch B injects our callout. Proves the
// nine-action platform runs, the pump.fun holding rule holds, branches differ, and swarm results reach the Tape.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../../services/core/src/lib/env.ts";
import { Bridge } from "../../../../services/slow-bridge/src/bridge.ts";
import { EngineClient } from "../../../../services/slow-bridge/src/engine.ts";
import type { Check } from "../../lib/checks.ts";
import { llmStub, type StubReq } from "../../lib/llm-stub.ts";
import { CAP, MINT_A, slowEnv } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const BACKEND = path.join(env.root, "services", "miroshark", "engine", "backend");
const PY = path.join(BACKEND, ".venv-asimog", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** Each persona acts by a script: callers buy then call (one tries to call before buying), followers buy then sell. */
function swarmAnswer(steps: Map<string, number>) {
  return (r: StubReq): string => {
    if (r.afterTool || !r.tools.length) return "ok";
    const name = r.system.match(/You are (\S+?),/)?.[1] ?? "x";
    const n = steps.get(name) ?? 0;
    steps.set(name, n + 1);
    const caller = r.system.includes("Pump.fun caller");
    if (caller && n === 0) return 'TOOL:post_callout {"mint_or_symbol":"PEPE","content":"PEPE early, no position yet"}'; // refused: no position
    if (n === 0 || (caller && n === 1)) return `TOOL:buy {"mint_or_symbol":"PEPE","amount_sol":${caller ? 0.05 : 0.02}}`;
    if (caller && n === 2) return 'TOOL:post_callout {"mint_or_symbol":"PEPE","content":"PEPE still early, holding"}';
    if (!caller && n === 2) return 'TOOL:sell {"mint_or_symbol":"PEPE","fraction":0.5}';
    return "TOOL:do_nothing {}";
  };
}

export const suite: Suite = {
  name: "miroshark-pumpfun",
  proves: "MiroShark's Wonderwall engine runs our Pump.fun module with camel agents and a stub model: actions move the curve, a callout without a position is refused, branch B carries our callout, and swarm results and the SIMULATED report reach the Tape through the Bridge.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    if (!fs.existsSync(PY)) return { checks: [{ name: "MiroShark venv exists (uv sync into .venv-asimog)", pass: false, detail: PY }], metrics: {} };
    const w = await slowEnv("mspump");
    const steps = new Map<string, number>();
    const llm = await llmStub(swarmAnswer(steps));
    const port = 7900 + Math.floor(Math.random() * 90);
    const worker = spawn(PY, ["asimog_worker.py", "--port", String(port)], {
      cwd: BACKEND,
      env: { ...process.env, ASIMOG_FORK: "1", PYTHONUTF8: "1", LLM_API_KEY: "stub", LLM_BASE_URL: llm.url, LLM_MODEL_NAME: "gpt-4o-mini", WONDERWALL_MODEL_NAME: "gpt-4o-mini", SWARM_CALLER_AGENTS: "3", SWARM_FOLLOWER_AGENTS: "4", SWARM_ROUNDS: "3", SWARM_SAMPLES: "1", SWARM_BRANCHES: "A,B", SWARM_WAVE_CALLERS: "2", SWARM_TIMEOUT_S: "240", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    worker.stdout.on("data", (d) => (log += d));
    worker.stderr.on("data", (d) => (log += d));
    try {
      await w.seed();
      const eng = new EngineClient("miroshark", `http://127.0.0.1:${port}`);
      for (let i = 0; i < 180 && !(await eng.healthy()); i++) await new Promise((r) => setTimeout(r, 500));
      add("the MiroShark worker starts with its model from our env", await eng.healthy(), log.slice(-300));
      const cores = { synth: w.inProc(CAP.synth), swarm: w.inProc(CAP.swarm), exchange: w.inProc(CAP.exchange) };
      const bridge = new Bridge({ sql: w.sql, cores, engines: { bettafish: null, miroshark: eng }, now: () => Date.now(), newId: () => "sj_ms1", cfg: { feedEveryMin: 30, feedWindowMin: 60, coinRunsPerHour: 6, swarmRunsPerHour: 6, presets: { bettafish: "lite", miroshark: "lite" }, chain: "parallel", chainWaitS: 1, runTimeoutS: 300, pollMs: 500 } });
      w.tape.emit("jev.escalated", { subject: MINT_A, gate_reasons: ["voi"], job: "swarm_run", voi: 0.5 }, { source: "reflex", subject: MINT_A });
      await w.tape.flush();
      await bridge.schedule();
      await bridge.drain();
      const [job] = await w.sql`select state, error from slow.jobs where id = 'sj_ms1'`;
      add("the swarm job finishes", job?.state === "done", `${job?.state} ${job?.error ?? ""} ${job?.state !== "done" ? log.slice(-600) : ""}`);
      add("camel agents acted through the pumpfun tools", llm.calls.some((c) => c.tools.includes("post_callout") && c.tools.includes("buy")), `${llm.calls.length} model calls`);
      const toolResults = llm.calls.filter((c) => c.afterTool).map((c) => c.user).join("\n");
      add("a callout without a position is refused, like pump.fun", toolResults.includes("you must hold the coin"), "holding rule");
      const [wave] = await w.sql`select body from tape.events where topic = 'swarm.wave_p' and subject = ${MINT_A}`;
      const wb = wave?.body as { wave_p?: number; samples?: number } | undefined;
      add("swarm.wave_p reaches the Tape", typeof wb?.wave_p === "number", JSON.stringify(wb));
      const [imp] = await w.sql`select body from tape.events where topic = 'swarm.impact' and subject = ${MINT_A}`;
      add("branch B (our callout) is measured against branch A", typeof (imp?.body as { d_callers?: number } | undefined)?.d_callers === "number", JSON.stringify(imp?.body));
      const [bel] = await w.sql`select body from tape.events where topic = 'swarm.beliefs' and subject = ${MINT_A}`;
      const branches = (bel?.body as { branches?: Record<string, { round: number; stance: Record<string, number> }[][]> } | undefined)?.branches ?? {};
      const rounds = branches.A?.[0]?.length ?? 0;
      add("belief drift per round and archetype reaches the Tape for both branches", rounds === 3 && !!branches.B && Object.keys(branches.A![0]![0]!.stance).includes("caller"), JSON.stringify(branches.A?.[0]?.at(-1)));
      const sysWithBeliefs = llm.calls.filter((c) => (c.system + c.user).includes("YOUR CURRENT BELIEFS")).length;
      add("agents see their own beliefs in later rounds", sysWithBeliefs > 0, `${sysWithBeliefs} calls carried a belief block`);
      const posts = await w.sql`select body from tape.events where topic = 'swarm.post'`;
      add("simulated posts reach the Tape marked simulated", posts.length > 0 && posts.every((p) => (p.body as { simulated: boolean }).simulated === true), `${posts.length} posts`);
      const [rep] = await w.sql`select body from tape.events where topic = 'report.published' and body->>'producer' = 'miroshark.report'`;
      add("the swarm report is published as SIMULATED", (rep?.body as { simulated?: boolean; summary?: string } | undefined)?.simulated === true && String((rep?.body as { summary?: string }).summary).startsWith("SIMULATED"), String((rep?.body as { summary?: string } | undefined)?.summary).slice(0, 160));
      return { checks, metrics: { model_calls: llm.calls.length, posts: posts.length } };
    } finally {
      fs.writeFileSync(path.join(env.root, "artifacts", "miroshark-worker.log"), log);
      worker.kill();
      llm.close();
      await w.close();
    }
  },
};
