// BettaFish's real Insight engine (docs/SLOW-MIND.md P3), run offline: the vendored DeepSearchAgent with PumpfunDB over the slow.*
// views (role slow_reader) and an OpenAI-compatible stub model. Proves the full plan, search, summary and reflection
// loop runs on our callouts, the cites it writes are real callout ids, and the Bridge maps its output through core.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../../services/core/src/lib/env.ts";
import { Bridge } from "../../../../services/slow-bridge/src/bridge.ts";
import { EngineClient } from "../../../../services/slow-bridge/src/engine.ts";
import type { Check } from "../../lib/checks.ts";
import { llmStub } from "../../lib/llm-stub.ts";
import { CAP, MINT_A, PRICES, slowEnv, WALLETS } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const ENGINE = path.join(env.root, "services", "bettafish", "engine");
const PY = path.join(ENGINE, ".venv-asimog", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** Scripted answers, one per Insight node, chosen by the node's system prompt. */
function answer(system: string, user: string): string {
  if (system.includes("报告架构师")) return JSON.stringify([{ title: "PEPE callers", content: "Who is early on PEPE" }, { title: "DOGE risk", content: "Rug signals on DOGE" }]);
  if (system.includes("舆情数据挖掘专家")) return JSON.stringify({ keywords: ["PEPE", "DOGE"], reasoning: "tickers" });
  if (system.includes("将获得报告中的一个段落")) return JSON.stringify({ search_query: "PEPE", search_tool: "search_topic_globally", reasoning: "find callouts" });
  if (system.includes("深化舆情报告的内容")) return JSON.stringify({ search_query: "DOGE", search_tool: "get_comments_for_topic", reasoning: "replies" });
  if (system.includes("内容深化专家")) return JSON.stringify({ updated_paragraph_latest_state: user.includes("DOGE risk") ? "DOGE looks bundled [cid:co_b1] [cid:co_FAKE]." : "Two callers early on PEPE [cid:co_a1] [cid:co_a2]." });
  if (system.includes("深度内容创作专家")) return JSON.stringify({ paragraph_latest_state: "Callers early on PEPE [cid:co_a1]." });
  if (system.includes("报告编撰大师")) return "# Feed synthesis\n\nPEPE early [cid:co_a1]. DOGE flagged [cid:co_b1].";
  return "{}";
}

export const suite: Suite = {
  name: "bettafish-insight",
  tier: "slow",
  covers: ["services/bettafish/engine/", "services/slow-bridge/"],
  proves: "The vendored BettaFish Insight engine runs its full plan, search, summary and reflection loop over our slow.* views with a stub model, cites real callout ids, and its output reaches the Tape through the Bridge and core's citation rule.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    if (!fs.existsSync(PY)) return { checks: [{ name: "BettaFish venv exists (uv venv .venv-asimog; uv pip install -r requirements-asimog.txt)", pass: false, detail: PY }], metrics: {} };
    const w = await slowEnv("bfinsight");
    const llm = await llmStub((r) => answer(r.system, r.user));
    const port = 7600 + Math.floor(Math.random() * 300);
    const ro = new URL(w.url);
    ro.username = "slow_reader";
    ro.password = "";
    const worker = spawn(PY, ["asimog_worker.py", "--port", String(port)], {
      cwd: ENGINE,
      env: {
        ...process.env, ...PRICES, ASIMOG_FORK: "1", BETTAFISH_DB_URL: ro.toString(), BETTAFISH_ENGINES: "insight", SEARCH_TOOL_TYPE: "AsimogMedia", QUERY_SEARCH: "tavily,x", BETTAFISH_SENTIMENT: "off", MAX_PARAGRAPHS: "2", MAX_REFLECTIONS: "1",
        INSIGHT_ENGINE_API_KEY: "stub", INSIGHT_ENGINE_BASE_URL: llm.url, INSIGHT_ENGINE_MODEL_NAME: "stub",
        KEYWORD_OPTIMIZER_API_KEY: "stub", KEYWORD_OPTIMIZER_BASE_URL: llm.url, KEYWORD_OPTIMIZER_MODEL_NAME: "stub", PYTHONIOENCODING: "utf-8", HF_HUB_OFFLINE: "1", PYTHONUTF8: "1", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    worker.stdout.on("data", (d) => (log += d));
    worker.stderr.on("data", (d) => (log += d));
    try {
      await w.seed();
      // the run is pinned 20 minutes back; a PEPE callout seen after that (but before the database's now) must stay unseen
      // (a 1-minute feed period keeps the slot at that as-of: the seeded callouts sit inside the run window, as core requires)
      const asOfMs = Date.now() - 20 * 60_000;
      await w.sql`insert into mem.callouts (callout_id, mint, wallet, text, created_at, seen_at, first_on_coin, likes, replies)
        values ('co_late', ${MINT_A}, ${WALLETS[0]!}, 'PEPE late call from the future', ${new Date(asOfMs + 5 * 60_000).toISOString()}, ${new Date(asOfMs + 5 * 60_000).toISOString()}, false, 99, 0)`;
      const base = `http://127.0.0.1:${port}`;
      const eng = new EngineClient("bettafish", base);
      for (let i = 0; i < 120 && !(await eng.healthy()); i++) await new Promise((r) => setTimeout(r, 500));
      add("the worker starts with every provider value from our env", await eng.healthy(), log.slice(-300));
      const cores = { synth: w.inProc(CAP.synth), swarm: w.inProc(CAP.swarm), exchange: w.inProc(CAP.exchange) };
      const bridge = new Bridge({ sql: w.sql, cores, engines: { bettafish: eng, miroshark: null }, now: () => asOfMs, newId: () => "sj_bf1", cfg: { feedEveryMin: 1, feedWindowMin: 60, coinRunsPerHour: 6, swarmRunsPerHour: 6, presets: { bettafish: "lite", miroshark: "lite" }, chain: "parallel", chainWaitS: 1, runTimeoutS: 120, pollMs: 300, deferMaxMin: 90, stageUsd: { 1: 1, 2: 1, 3: 1 }, dayUsd: 100 } });
      await bridge.schedule();
      await bridge.drain();
      const [job] = await w.sql`select state, error, result from slow.jobs where id = 'sj_bf1'`;
      add("the feed job finishes", job?.state === "done", `${job?.state} ${job?.error ?? ""} ${log.slice(-400)}`);
      const nodes = (k: string) => llm.calls.filter((c) => c.system.includes(k)).length;
      add("the engine planned a report structure", nodes("报告架构师") === 1, `${nodes("报告架构师")} calls`);
      add("each paragraph ran its first search and summary", nodes("将获得报告中的一个段落") === 2 && nodes("深度内容创作专家") === 2, `search ${nodes("将获得报告中的一个段落")}, summary ${nodes("深度内容创作专家")}`);
      add("each paragraph ran MAX_REFLECTIONS=1 reflection rounds", nodes("深化舆情报告的内容") === 2 && nodes("内容深化专家") === 2, `reflection ${nodes("深化舆情报告的内容")}, rewrite ${nodes("内容深化专家")}`);
      const sawCallouts = llm.calls.some((c) => c.user.includes("[cid:co_a1]") || c.user.includes("cid:co_a"));
      add("the model was shown our callouts from slow.* with their ids", sawCallouts, `${llm.calls.length} model calls`);
      add("nothing seen after the run's as-of reached the model (slow.as_of pinned)", llm.calls.length > 0 && !llm.calls.some((c) => c.user.includes("co_late") || c.user.includes("from the future")), `${llm.calls.length} model calls`);
      add("every prompt carried our English and voice rules", llm.calls.length > 0 && llm.calls.every((c) => c.system.includes("[Asimog rules]")), `${llm.calls.length} calls`);
      const [feed] = await w.sql`select body from tape.events where topic = 'synthesis.feed'`;
      const b = feed?.body as { narratives?: { cites: string[] }[]; claims_dropped?: number } | undefined;
      const allCites = (b?.narratives ?? []).flatMap((n) => n.cites);
      add("synthesis.feed keeps the cited claim and drops the one citing an invented id", !!b && b.narratives?.length === 1 && allCites.length > 0 && !allCites.includes("co_FAKE") && (b.claims_dropped ?? 0) >= 1, JSON.stringify({ cites: allCites, dropped: b?.claims_dropped }));
      const [rep] = await w.sql`select producer, cites, markdown from slow.reports where producer = 'bettafish.insight'`;
      add("the Insight report is published to the exchange", !!rep && (rep.cites as string[]).every((c) => c !== "co_FAKE") && String(rep.markdown).length > 0, JSON.stringify(rep?.cites));
      return { checks, metrics: { model_calls: llm.calls.length } };
    } finally {
      fs.mkdirSync(path.join(env.root, "artifacts"), { recursive: true });
      fs.writeFileSync(path.join(env.root, "artifacts", "bettafish-worker.log"), log);
      worker.kill();
      llm.close();
      await w.close();
    }
  },
};
