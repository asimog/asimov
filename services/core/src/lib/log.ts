// Structured JSON logs to stderr. Never log secrets (env.ts redact()).
type Level = "debug" | "info" | "warn" | "error";
const MIN: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = MIN[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

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
