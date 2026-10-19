// Slow Bridge process: `npm run slow-bridge`. Every value from env (docs/SLOW-MIND.md); engines that have no URL are off.
import crypto from "node:crypto";
import { connectCore, loadEnv, need } from "@asimog/lane";
import postgres from "postgres";
import { Bridge } from "./bridge.ts";
import { EngineClient } from "./engine.ts";

const env = loadEnv();
/** A number setting: its one default is in .env.example, the owner's value in .env.local; a typo stops boot. */
const setting = (k: string) => {
  const v = Number(need(env, k));
  if (!Number.isFinite(v)) throw new Error(`env ${k} must be a number, got ${env[k]}`);
  return v;
};
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
    bettafish: env.BETTAFISH_URL ? new EngineClient("bettafish", env.BETTAFISH_URL, need(env, "BETTAFISH_WORKER_TOKEN")) : null,
    miroshark: env.MIROSHARK_URL ? new EngineClient("miroshark", env.MIROSHARK_URL, need(env, "SWARM_WORKER_TOKEN")) : null,
  },
  now: () => Date.now(),
  newId: () => `sj_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
  cfg: {
    feedEveryMin: setting("BETTAFISH_FEED_EVERY_MIN"),
    feedWindowMin: setting("BETTAFISH_FEED_WINDOW_MIN"),
    coinRunsPerHour: setting("BETTAFISH_COIN_RUNS_PER_HOUR"),
    swarmRunsPerHour: setting("SWARM_RUNS_PER_HOUR"),
    presets: { bettafish: need(env, "BETTAFISH_PRESET"), miroshark: need(env, "SWARM_PRESET") },
    chain: env.SLOW_CHAIN === "bettafish_first" ? "bettafish_first" : "parallel",
    chainWaitS: setting("SLOW_CHAIN_WAIT_S"),
    runTimeoutS: setting("SLOW_RUN_TIMEOUT_S"),
    pollMs: setting("SLOW_POLL_MS"),
    deferMaxMin: setting("SLOW_DEFER_MAX_MIN"),
    stageUsd: { 1: setting("SLOW_STAGE1_USD_PER_RUN"), 2: setting("SLOW_STAGE2_USD_PER_RUN"), 3: setting("SLOW_STAGE3_USD_PER_RUN") },
    dayUsd: setting("SLOW_USD_PER_DAY"),
    coinWindowMin: setting("SLOW_COIN_WINDOW_MIN"),
  },
});
// escalations on their own timer (SLOW_SCHEDULE_S), runs on theirs (SLOW_TICK_S): a long run never delays reading a grant
bridge.start(setting("SLOW_SCHEDULE_S") * 1000, setting("SLOW_TICK_S") * 1000, (where, err) => console.error(JSON.stringify({ msg: `slow-bridge ${where}`, err: String(err).slice(0, 300) })));
setInterval(() => console.log(JSON.stringify({ msg: "slow-bridge stats", ...bridge.stats })), 60_000);
