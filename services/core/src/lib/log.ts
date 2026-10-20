// Structured JSON logs to stderr. Never log secrets (env.ts redact()).
type Level = "debug" | "info" | "warn" | "error";
const MIN: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const level = process.env.LOG_LEVEL ?? "info";
if (!(level in MIN)) throw new Error(`LOG_LEVEL must be one of ${Object.keys(MIN).join(", ")}, got ${level}`); // a typo must not quietly log at info
const threshold = MIN[level as Level];

function out(level: Level, msg: string, data?: Record<string, unknown>) {
  if (MIN[level] < threshold) return;
  process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level, msg, ...data })}\n`);
}

export const log = {
  debug: (m: string, d?: Record<string, unknown>) => out("debug", m, d),
  info: (m: string, d?: Record<string, unknown>) => out("info", m, d),
  warn: (m: string, d?: Record<string, unknown>) => out("warn", m, d),
  error: (m: string, d?: Record<string, unknown>) => out("error", m, d),
};
