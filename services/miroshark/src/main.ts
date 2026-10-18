// MiroShark service: `tsx services/miroshark/src/main.ts <mint>` runs one swarm for a coin through the core MCP server
// with the swarm token. Escalation (docs/17) will call the same function; there is no timer, runs are escalation-only.
import { connectCore, Lane, loadEnv, need } from "@asimog/lane";
import crypto from "node:crypto";
import { runSwarm, swarmPresetFromEnv } from "./swarm.ts";

const env = loadEnv();
const mint = process.argv[2];
if (!mint) throw new Error("usage: main.ts <mint>");
const token = env.MCP_TOKEN_SWARM;
if (!token) throw new Error("set MCP_TOKEN_SWARM (the cap:board.swarm token in MCP_TOKENS)");
const core = await connectCore(need(env, "MCP_URL"), token);
const preset = swarmPresetFromEnv(env);
const res = await runSwarm({ core, lane: new Lane("SWARM"), preset, newId: () => `sw_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}` }, { mint });
console.log(JSON.stringify({ preset: preset.name, ...res }));
await core.close();
