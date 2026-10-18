// Slow Bridge process: `npm run slow-bridge`. Every value from env (docs/24); engines that have no URL are off.
import crypto from "node:crypto";
import { connectCore, loadEnv, need, num } from "@asimog/lane";
import postgres from "postgres";
import { Bridge } from "./bridge.ts";
import { EngineClient } from "./engine.ts";

const env = loadEnv();
const sql = postgres(need(env, "DATABASE_URL"), { max: 4 });
const url = need(env, "MCP_URL");
const cores = {
  synth: await connectCore(url, need(env, "MCP_TOKEN_SYNTH")),
  swarm: await connectCore(url, need(env, "MCP_TOKEN_SWARM")),
  exchange: await connectCore(url, need(env, "MCP_TOKEN_EXCHANGE")),
};
const bridge = new Bridge({
  sql,
  cores,
  engines: {
    bettafish: env.BETTAFISH_URL ? new EngineClient("bettafish", env.BETTAFISH_URL) : null,
    miroshark: env.MIROSHARK_URL ? new EngineClient("miroshark", env.MIROSHARK_URL) : null,
  },
  now: () => Date.now(),
  newId: () => `sj_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
  cfg: {
    feedEveryMin: num(env, "BETTAFISH_FEED_EVERY_MIN", 30),
    feedWindowMin: num(env, "BETTAFISH_FEED_WINDOW_MIN", 60),
    coinRunsPerHour: num(env, "BETTAFISH_COIN_RUNS_PER_HOUR", 6),
    swarmRunsPerHour: num(env, "SWARM_RUNS_PER_HOUR", 6),
    presets: { bettafish: need(env, "BETTAFISH_PRESET"), miroshark: need(env, "SWARM_PRESET") },
    chain: env.SLOW_CHAIN === "bettafish_first" ? "bettafish_first" : "parallel",
    chainWaitS: num(env, "SLOW_CHAIN_WAIT_S", 300),
    runTimeoutS: num(env, "SLOW_RUN_TIMEOUT_S", 1800),
    pollMs: num(env, "SLOW_POLL_MS", 3000),
  },
});
const every = num(env, "SLOW_TICK_S", 30) * 1000;
let busy = false;
const tick = async () => {
  if (busy) return;
  busy = true;
  try {
    await bridge.schedule();
    await bridge.drain();
  } catch (err) {
    console.error(JSON.stringify({ msg: "slow-bridge tick", err: String(err).slice(0, 300) }));
  } finally {
    busy = false;
  }
};
await tick();
setInterval(() => void tick(), every);
setInterval(() => console.log(JSON.stringify({ msg: "slow-bridge stats", ...bridge.stats })), 60_000);
