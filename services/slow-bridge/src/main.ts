// Slow Bridge process: `npm run slow-bridge`. Every value from env (docs/SLOW-MIND.md); engines that have no URL are off.
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
    deferMaxMin: num(env, "SLOW_DEFER_MAX_MIN", 90),
    stageUsd: { 1: Number(need(env, "SLOW_STAGE1_USD_PER_RUN")), 2: Number(need(env, "SLOW_STAGE2_USD_PER_RUN")), 3: Number(need(env, "SLOW_STAGE3_USD_PER_RUN")) },
    dayUsd: Number(need(env, "SLOW_USD_PER_DAY")),
  },
});
// escalations on their own timer (SLOW_SCHEDULE_S), runs on theirs (SLOW_TICK_S): a long run never delays reading a grant
bridge.start(num(env, "SLOW_SCHEDULE_S", 5) * 1000, num(env, "SLOW_TICK_S", 30) * 1000, (where, err) => console.error(JSON.stringify({ msg: `slow-bridge ${where}`, err: String(err).slice(0, 300) })));
setInterval(() => console.log(JSON.stringify({ msg: "slow-bridge stats", ...bridge.stats })), 60_000);
