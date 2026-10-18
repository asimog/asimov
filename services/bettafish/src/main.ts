// BettaFish service: a feed run every BETTAFISH_FEED_EVERY_MIN, through the core MCP server with the synthesis token.
// Coin runs are started by escalation (docs/17), not here yet.
import { connectCore, Lane, loadEnv, need } from "@asimog/lane";
import crypto from "node:crypto";
import { presetFromEnv } from "./preset.ts";
import { Runner, runFeed } from "./synth.ts";

const env = loadEnv();
const url = need(env, "MCP_URL");
const token = env.MCP_TOKEN_SYNTH;
if (!token) throw new Error("set MCP_TOKEN_SYNTH (the cap:board.synthesis token in MCP_TOKENS)");
const core = await connectCore(url, token);
const preset = presetFromEnv(env);
const deps = { core, lane: new Lane("SYNTH"), preset, newId: () => `sy_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}` };
const runner = new Runner();
const tick = async () => {
  const r = await runner.once(() => runFeed(deps));
  console.log(JSON.stringify({ at: new Date().toISOString(), preset: preset.name, run: r ?? "skipped: previous run still going", skipped_total: runner.skipped }));
};
await tick();
setInterval(() => void tick().catch((e) => console.error(String(e))), preset.feedEveryMin * 60_000);
