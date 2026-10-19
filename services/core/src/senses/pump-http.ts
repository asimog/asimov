// HTTP client for pump.fun read endpoints (docs/research/pumpfun-endpoints.md).
// Polite by default: one request in flight per path prefix, backoff on 429/5xx (Retry-After when given), schema-checked by callers.
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";

const UA = "asimog/0.1 (+https://github.com/asimog/asimov)"; // AGENTS.md Platform: we say who we are
const BASE = () => env.str("PUMP_API_URL");

// one queue and one backoff per path prefix: a rate limit on replies never pauses the hot feed (fix plan 3.15)
const lanes = new Map<string, { chain: Promise<unknown>; backoffMs: number }>();

/** Retry-After is delta-seconds or an HTTP date (RFC 9110); NaN when absent or unreadable. */
function retryAfterMs(h: string | null): number {
  if (h === null || h.trim() === "") return Number.NaN;
  return /^\s*\d+(\.\d+)?\s*$/.test(h) ? Number(h) * 1000 : Date.parse(h) - Date.now();
}

export async function pumpGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<{ status: number; body: T | null; raw: string }> {
  const url = new URL(path.startsWith("http") ? path : BASE() + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const prefix = `${url.host}/${url.pathname.split("/")[1] ?? ""}`;
  const lane = lanes.get(prefix) ?? lanes.set(prefix, { chain: Promise.resolve(), backoffMs: 0 }).get(prefix)!;
  const run = async () => {
    if (lane.backoffMs) await new Promise((r) => setTimeout(r, lane.backoffMs));
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await res.text();
    if (res.status === 429 || res.status >= 500) {
      const after = retryAfterMs(res.headers.get("retry-after"));
      lane.backoffMs = Math.min(60_000, Number.isFinite(after) && after > 0 ? after : Math.max(1000, lane.backoffMs * 2));
      log.warn("pump-http backoff", { path: url.pathname, status: res.status, backoffMs: lane.backoffMs });
    } else lane.backoffMs = 0;
    let body: T | null = null;
    if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        body = JSON.parse(raw) as T;
      } catch {
        body = null;
      }
    }
    return { status: res.status, body, raw };
  };
  const p = lane.chain.then(run, run);
  lane.chain = p.catch(() => {});
  return p;
}
