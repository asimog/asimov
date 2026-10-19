// Agents service: `tsx services/agents/src/main.ts`. Deterministic ticks queue jobs; a worker runs them.
// Needs the core MCP server (MCP_PORT) and one token per agent (MCP_TOKEN_<AGENT>) in .env.local.
import { Lane, type LaneName, loadEnv, need } from "@asimog/lane";
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
const lanes = new Map<LaneName, Lane>();
const enabled = (env.AGENTS_ENABLED ? env.AGENTS_ENABLED.split(",").map((s) => s.trim()) : AGENT_NAMES.filter((a) => a !== "noop")) as AgentName[];
const rt = new AgentsRuntime({
  sql,
  mcpUrl: need(env, "MCP_URL"),
  token: (a) => env[AGENTS[a].tokenEnv] ?? env[`MCP_TOKEN_${a.toUpperCase()}`],
  lane: (n) => lanes.get(n) ?? (lanes.set(n, new Lane(n, { spend })), lanes.get(n)!),
  checkpointer,
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
