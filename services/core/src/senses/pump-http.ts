// HTTP client for pump.fun read endpoints (docs/research/pumpfun-endpoints.md).
// Polite by default: one request in flight per host, backoff on 429/5xx, schema-checked by callers.
import { log } from "../lib/log.ts";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36";
const BASE = "https://frontend-api-v3.pump.fun";

let chain: Promise<unknown> = Promise.resolve();
let backoffMs = 0;

export async function pumpGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<{ status: number; body: T | null; raw: string }> {
  const url = new URL(path.startsWith("http") ? path : BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const run = async () => {
    if (backoffMs) await new Promise((r) => setTimeout(r, backoffMs));
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Origin: "https://pump.fun", Referer: "https://pump.fun/", Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await res.text();
    if (res.status === 429 || res.status >= 500) {
      backoffMs = Math.min(60_000, Math.max(1000, backoffMs * 2));
      log.warn("pump-http backoff", { path: url.pathname, status: res.status, backoffMs });
    } else backoffMs = 0;
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
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}
