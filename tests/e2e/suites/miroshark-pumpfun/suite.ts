// MiroShark's real Wonderwall engine with our Pump.fun module (docs/SLOW-MIND.md P5, P6), offline: camel agents act through tool
// calls answered by a stub model; the Bridge sends the coin dossier from core; branch B injects our callout. Proves the
// nine-action platform runs, the pump.fun holding rule holds, branches differ, and swarm results reach the Tape; with a
// Twitter platform beside it (market-media bridge, cross-platform digest), graph memory on Neo4j with SIMULATED edges,
// upstream's report agent with our two read tools, and caller personas calling the core MCP read tools.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../../services/core/src/lib/env.ts";
import { Bridge } from "../../../../services/slow-bridge/src/bridge.ts";
import { EngineClient } from "../../../../services/slow-bridge/src/engine.ts";
import type { Check } from "../../lib/checks.ts";
import { llmStub, type StubReq } from "../../lib/llm-stub.ts";
import { CAP, MINT_A, slowEnv, WORKER_ENV, WORKER_TOKEN } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const BACKEND = path.join(env.root, "services", "miroshark", "engine", "backend");
const PY = path.join(BACKEND, ".venv-asimog", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** Each persona acts by a script: callers buy then call (one tries to call before buying), followers buy then sell.
 *  On Twitter everyone posts once. Callers end their turns with an <mcp_call/> tag: first a read, then a write (refused).
 *  The report agent calls our two tools, then writes. */
function swarmAnswer(steps: Map<string, number>) {
  const next = (k: string) => {
    const n = steps.get(k) ?? 0;
    steps.set(k, n + 1);
    return n;
  };
  return (r: StubReq): string => {
    if (r.system.includes("Report title: Swarm Report (SIMULATED)")) {
      if (r.user.includes("Tool coin_outcome_so_far returned")) return "Final Answer: SIMULATED. The swarm moved on the callers it trusted.";
      if (r.user.includes("Tool asimog_reports returned")) return '<tool_call>{"name": "coin_outcome_so_far", "parameters": {}}</tool_call>';
      return '<tool_call>{"name": "asimog_reports", "parameters": {}}</tool_call>';
    }
    const name = r.system.match(/(?:You are|Your name is) (\S+?)[,.]/)?.[1] ?? "x";
    const caller = r.system.includes("Pump.fun caller");
    if (r.tools.includes("create_post")) return r.afterTool ? "ok" : next(`tw:${name}`) === 0 ? 'TOOL:create_post {"content":"PEPE on the curve, watching the callers"}' : "TOOL:do_nothing {}";
    if (r.afterTool || !r.tools.length) {
      if (!caller || !r.tools.length) return "ok";
      const n = next(`mcp:${name}`);
      if (n === 0) return `<mcp_call server="asimog" tool="coin_dossier" args='{"mint":"${MINT_A}"}' />`;
      if (n === 1) return `<mcp_call server="asimog" tool="emit_swarm_result" args='{}' />`;
      return "ok";
    }
    const n = next(name);
    if (caller && n === 0) return 'TOOL:post_callout {"mint_or_symbol":"PEPE","content":"PEPE early, no position yet"}'; // refused: no position
    if (n === 0 || (caller && n === 1)) return `TOOL:buy {"mint_or_symbol":"PEPE","amount_sol":${caller ? 0.05 : 0.02}}`;
    if (caller && n === 2) return 'TOOL:post_callout {"mint_or_symbol":"PEPE","content":"PEPE still early, holding"}';
    if (!caller && n === 2) return 'TOOL:sell {"mint_or_symbol":"PEPE","fraction":0.5}';
    return "TOOL:do_nothing {}";
  };
}

export const suite: Suite = {
  name: "miroshark-pumpfun",
  tier: "slow",
  covers: ["services/miroshark/engine/"],
  proves: "MiroShark's Wonderwall engine runs our Pump.fun module with camel agents and a stub model: actions move the curve, a callout without a position is refused, branch B carries our callout, and swarm results and the SIMULATED report reach the Tape through the Bridge.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    if (!fs.existsSync(PY)) return { checks: [{ name: "MiroShark venv exists (uv sync into .venv-asimog)", pass: false, detail: PY }], metrics: {} };
    const w = await slowEnv("mspump");
    const steps = new Map<string, number>();
    const llm = await llmStub(swarmAnswer(steps));
    const mcp = await w.mcpUp();
    const port = 7900 + Math.floor(Math.random() * 90);
    const worker = spawn(PY, ["asimog_worker.py", "--port", String(port)], {
      cwd: BACKEND,
      env: { ...process.env, ...WORKER_ENV, ASIMOG_FORK: "1", PYTHONUTF8: "1", LLM_API_KEY: "stub", LLM_BASE_URL: llm.url, LLM_MODEL_NAME: "gpt-4o-mini", WONDERWALL_MODEL_NAME: "gpt-4o-mini", SWARM_CALLER_AGENTS: "3", SWARM_FOLLOWER_AGENTS: "4", SWARM_ROUNDS: "3", SWARM_SAMPLES: "1", SWARM_BRANCHES: "A,B", SWARM_WAVE_CALLERS: "2", SWARM_TIMEOUT_S: "300", SWARM_PLATFORMS: "pumpfun,twitter", SWARM_GRAPH_FEATURES: "minimal", NEO4J_URI: env.opt("NEO4J_URI") ?? "bolt://127.0.0.1:7687", NEO4J_USER: env.opt("NEO4J_USER") ?? "neo4j", NEO4J_PASSWORD: env.opt("NEO4J_PASSWORD") ?? "", SWARM_REPORT: "agent", SMART_MODEL_NAME: "gpt-4o-mini", CORE_MCP_URL: mcp.url, SWARM_CORE_TOKEN: w.tok(CAP.swarmRead), MCP_AGENT_TOOLS_ENABLED: "true", SWARM_PERSONA_TOOLS: "coin_dossier,reports_for", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    worker.stdout.on("data", (d) => (log += d));
    worker.stderr.on("data", (d) => (log += d));
    try {
      await w.seed();
      // the report exchange, BettaFish -> MiroShark: a coin report the swarm must seed from and its report agent must read
      await w.inProc(CAP.exchange).call("report_publish", { report_id: "sj_bf0_0", producer: "bettafish.report", kind: "coin", subject: MINT_A, preset: "lite", summary: "PEPE has two early callers and real buyers.", cites: ["co_a1"], markdown: "# Coin synthesis\n\nBF-MARKER two early callers [cid:co_a1]." });
      const eng = new EngineClient("miroshark", `http://127.0.0.1:${port}`, WORKER_TOKEN);
      for (let i = 0; i < 180 && !(await eng.healthy()); i++) await new Promise((r) => setTimeout(r, 500));
      add("the MiroShark worker starts with its model from our env", await eng.healthy(), log.slice(-300));
      const cores = { synth: w.inProc(CAP.synth), swarm: w.inProc(CAP.swarm), exchange: w.inProc(CAP.exchange) };
      const bridge = new Bridge({ sql: w.sql, cores, engines: { bettafish: null, miroshark: eng }, now: () => Date.now(), newId: () => "sj_ms1", cfg: { feedEveryMin: 30, feedWindowMin: 60, coinRunsPerHour: 6, swarmRunsPerHour: 6, presets: { bettafish: "lite", miroshark: "lite" }, chain: "parallel", chainWaitS: 1, runTimeoutS: 400, pollMs: 500, deferMaxMin: 90, stageUsd: { 1: 1, 2: 1, 3: 1 }, dayUsd: 100, coinWindowMin: 60 } });
      w.tape.emit("jev.escalated", { subject: MINT_A, gate_reasons: ["voi"], job: "swarm_run", voi: 0.5, stage: 2, arm: "run" }, { source: "attention", subject: MINT_A });
      await w.tape.flush();
      await bridge.schedule();
      await bridge.drain();
      const [job] = await w.sql`select state, error, cost_usd from slow.jobs where id = 'sj_ms1'`;
      add("the swarm job finishes", job?.state === "done", `${job?.state} ${job?.error ?? ""} ${job?.state !== "done" ? log.slice(-600) : ""}`);
      add("the swarm reports its real spend (token usage times the env prices)", Number(job?.cost_usd) > 0, `cost_usd ${Number(job?.cost_usd).toFixed(6)} over ${llm.calls.length} model calls`);
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
      add("the swarm report is published as SIMULATED", (rep?.body as { simulated?: boolean; summary?: string } | undefined)?.simulated === true && String((rep?.body as { summary?: string } | undefined)?.summary).startsWith("SIMULATED"), String((rep?.body as { summary?: string } | undefined)?.summary).slice(0, 160));
      // P6: the Twitter platform beside pumpfun, with upstream's market-media bridge and cross-platform digest
      const twCalls = llm.calls.filter((c) => c.tools.includes("create_post"));
      add("a Twitter platform runs beside pumpfun with the same personas", twCalls.length > 0 && posts.some((p) => (p.body as { platform?: string }).platform === "twitter"), `${twCalls.length} twitter turns`);
      add("Twitter agents see the Pump.fun curve (market-media bridge)", twCalls.some((c) => c.system.includes("# PUMP.FUN MARKET (SIMULATED)")), "");
      add("traders see Twitter sentiment (market-media bridge)", llm.calls.some((c) => c.tools.includes("buy") && c.system.includes("# SOCIAL MEDIA SENTIMENT")), "");
      add("each agent sees its own actions on the other platform (cross-platform digest)", llm.calls.some((c) => c.system.includes("# YOUR RECENT ACTIVITY ON OTHER PLATFORMS")), "");
      // P6: graph memory on Neo4j, seeded from the dossier, simulated actions as their own edges
      const [body] = await w.sql`select ir, markdown from slow.reports where producer = 'miroshark.report'`;
      const ir = (body?.ir ?? {}) as { graph?: { features: string; seeded: number; observed: number; simulated: number } };
      add("graph memory on Neo4j is seeded from the dossier", ir.graph?.features === "minimal" && (ir.graph?.seeded ?? 0) > 0, JSON.stringify(ir.graph));
      add("simulated actions are SIMULATED edges and observed edges stay as seeded", (ir.graph?.simulated ?? 0) > 0 && ir.graph?.observed === ir.graph?.seeded, JSON.stringify(ir.graph));
      // P6: upstream's report agent with the Swarm Report (SIMULATED) template and our two read tools
      const md = String(body?.markdown ?? "");
      const titles = ["Spread path", "Branch A vs B", "Belief drift", "The callers who moved it", "Wave probability"];
      add("the report has the fixed Swarm Report (SIMULATED) sections", md.startsWith("# Swarm Report (SIMULATED)") && titles.every((t) => md.includes(`## ${t}`)), md.slice(0, 120));
      add("the report agent read BettaFish reports and the real flow through the core", llm.calls.some((c) => c.user.includes("Tool asimog_reports returned")) && llm.calls.some((c) => c.user.includes("Tool coin_outcome_so_far returned") && c.user.includes("distinct_callers")), "");
      const repBody = rep?.body as { parent_reports?: string[] } | undefined;
      add("the BettaFish report is the swarm's parent, seeded into the graph and read by the report agent", (repBody?.parent_reports ?? []).includes("sj_bf0_0") && (ir.graph?.seeded ?? 0) >= 9 && llm.calls.some((c) => c.user.includes("Tool asimog_reports returned") && c.user.includes("sj_bf0_0")) && md.includes("sj_bf0_0"), `${JSON.stringify(repBody?.parent_reports)} seeded ${ir.graph?.seeded}`);
      add("each section opens with numbers from code", md.includes("wave_p ") && md.includes("over 1 samples"), "");
      // P6: caller personas call the core MCP read tools; anything else is refused before the core
      add("caller personas see the core tools", llm.calls.some((c) => c.system.includes("# MCP TOOLS AVAILABLE") && c.system.includes("asimog/coin_dossier")), "");
      add("a persona's read call comes back the next round", llm.calls.some((c) => c.system.includes("asimog/coin_dossier [OK")), "");
      add("a persona's write call is refused", llm.calls.some((c) => c.system.includes("asimog/emit_swarm_result [ERR")), "");
      return { checks, metrics: { model_calls: llm.calls.length, posts: posts.length, twitter_turns: twCalls.length, graph_simulated_edges: ir.graph?.simulated ?? 0 } };
    } finally {
      fs.writeFileSync(path.join(env.root, "artifacts", "miroshark-worker.log"), log);
      worker.kill();
      llm.close();
      await w.close();
    }
  },
};
