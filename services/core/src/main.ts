// core: boots the tape, senses, memory, analyzers, reflex and mind. Every part is switchable by env (docs/OPS.md).
import { liveClock } from "./lib/clock.ts";
import { loadConfig, readConfig } from "./lib/config.ts";
import { connect, migrate } from "./lib/db.ts";
import { env, redact } from "./lib/env.ts";
import { log } from "./lib/log.ts";
import { runtime } from "./runtime.ts";
import { Tape } from "./tape/tape.ts";

async function main() {
  const mode = env.str("ASIMOG_MODE");
  if (mode === "replay") throw new Error("core main runs paper or live; use `ctl replay` for replays");
  readConfig(); // a bad config/*.json stops boot before anything connects
  const sql = connect();
  await migrate(sql);
  const clock = liveClock(mode as "paper" | "live");
  log.info("boot", { mode, config: redact() });
  await loadConfig(new Tape(sql, clock));
  const rt = await runtime({ sql, clock });
  await rt.start();
  const shutdown = async (sig: string) => {
    log.info("shutdown", { sig });
    await rt.stop();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal", { err: String(err), stack: (err as Error).stack });
  process.exit(1);
});
