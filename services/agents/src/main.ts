// Agents service: `tsx services/agents/src/main.ts`. Deterministic ticks queue jobs; a worker runs them.
// Needs the core MCP server (MCP_PORT) and one token per agent (MCP_TOKEN_<AGENT>) in .env.local.
import { Embedder, Lane, loadEnv, need } from "@asimog/lane";
import { configValues, modelChain } from "../../core/src/lib/config.ts";
import { makeCheckpointer } from "./checkpoint.ts";
import { connect, migrate, PgSpend } from "./db.ts";
import { AGENT_NAMES, AGENTS, type AgentName } from "./lanes.ts";
import { AgentsRuntime } from "./runtime.ts";

const env = loadEnv();
const url = env.AGENTS_DATABASE_URL || env.DATABASE_URL;
if (!url) throw new Error("set DATABASE_URL (or AGENTS_DATABASE_URL)");
const sql = connect(url);
await migrate(sql);
const checkpointer = await makeCheckpointer(url);
const spend = new PgSpend(sql);
const models = configValues().models;
const lanes = new Map<AgentName, Lane>();
const enabled = (env.AGENTS_ENABLED ? env.AGENTS_ENABLED.split(",").map((s) => s.trim()) : AGENT_NAMES.filter((a) => a !== "noop")) as AgentName[];
const rt = new AgentsRuntime({
  sql,
  mcpUrl: need(env, "MCP_URL"),
  token: (a) => env[AGENTS[a].tokenEnv] ?? env[`MCP_TOKEN_${a.toUpperCase()}`],
  lane: (n, a) => lanes.get(a) ?? (lanes.set(a, new Lane(n, { spend, models: modelChain(models, a) })), lanes.get(a)!),
  checkpointer,
  // E5: the Librarian embeds only when an embedding model is set (or LLM_STUB is on); spend is metered on the EMBED lane
  embedder: env.EMBEDDING_MODEL || ["1", "true"].includes(env.LLM_STUB ?? "") ? new Embedder({ spend }) : undefined,
  enabled,
});
const loop = async () => {
  try {
    const { queued } = await rt.tick();
    const ran = await rt.work();
    if (queued.length || ran) console.log(JSON.stringify({ queued, ran }));
  } catch (err) {
    console.error(String(err));
  }
};
await loop();
setInterval(() => void loop(), Number(env.AGENTS_TICK_S ?? 10) * 1000);
