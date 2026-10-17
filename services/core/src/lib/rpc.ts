// RPC pool (docs/15): several free Solana RPC endpoints used as one, with per-endpoint rate limits and fallback.
// RPC_URLS = "name|rps|url,name|rps|url" in order of preference; falls back to RPC_URL. URLs hold API keys: we log names only.
import { env } from "./env.ts";

type Endpoint = { name: string; url: string; rps: number; nextFreeMs: number; restUntilMs: number; restMs: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now(); // pacing only, never a recorded time (recorded times come from the Clock)

function endpoints(): Endpoint[] {
  const raw = env.opt("RPC_URLS");
  const list = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        const [name, rps, ...rest] = s.split("|");
        return { name: name!, rps: Number(rps), url: rest.join("|") };
      })
    : env.opt("RPC_URL") ? [{ name: "rpc", rps: env.num("RPC_RPS", 5), url: env.str("RPC_URL") }] : [];
  return list.map((e) => ({ ...e, nextFreeMs: 0, restUntilMs: 0, restMs: 0 }));
}

export class RpcPool {
  private eps = endpoints();
  private id = 0;
  private readonly timeoutMs = env.int("RPC_TIMEOUT_MS", 8000);
  private readonly maxTries = env.int("RPC_MAX_TRIES", 6);
  stats: Record<string, { ok: number; failed: number }> = Object.fromEntries(this.eps.map((e) => [e.name, { ok: 0, failed: 0 }]));

  get names() {
    return this.eps.map((e) => e.name);
  }

  get size() {
    return this.eps.length;
  }

  /** The first endpoint that is not resting, waiting for its rate-limit slot; or the one that wakes soonest. */
  private async pick(): Promise<Endpoint> {
    const t = now();
    const awake = this.eps.filter((e) => e.restUntilMs <= t);
    // preference order first; if every awake endpoint is at its rate limit, the one free soonest; if all rest, the one waking soonest
    const e = awake.find((x) => x.nextFreeMs <= t)
      ?? (awake.length ? awake.reduce((a, b) => (b.nextFreeMs < a.nextFreeMs ? b : a)) : this.eps.reduce((a, b) => (b.restUntilMs < a.restUntilMs ? b : a)));
    const at = Math.max(t, e.restUntilMs, e.nextFreeMs);
    e.nextFreeMs = at + 1000 / e.rps;
    if (at > t) await sleep(at - t);
    return e;
  }

  private rest(e: Endpoint) {
    e.restMs = Math.min(10_000, e.restMs ? e.restMs * 2 : 1000);
    e.restUntilMs = now() + e.restMs;
    this.stats[e.name]!.failed++;
  }

  /** One JSON-RPC call. Provider trouble moves it to the next endpoint; a JSON-RPC error is thrown as is. */
  async call<T>(method: string, params: unknown[]): Promise<T> {
    if (!this.eps.length) throw new Error("no RPC endpoint configured (RPC_URLS or RPC_URL)");
    let last = "";
    for (let attempt = 0; attempt < this.maxTries; attempt++) {
      const e = await this.pick();
      try {
        const r = await fetch(e.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (r.status === 429 || r.status >= 500) {
          last = `${e.name}: http ${r.status}`;
          this.rest(e);
          continue;
        }
        const j = (await r.json()) as { result?: T; error?: { code: number; message: string } };
        e.restMs = 0;
        this.stats[e.name]!.ok++;
        if (j.error) throw new RpcError(method, j.error.code, j.error.message);
        return j.result as T;
      } catch (err) {
        if (err instanceof RpcError) throw err;
        last = `${e.name}: ${(err as Error).name}`; // never the message: it may echo the URL and its key
        this.rest(e);
      }
    }
    throw new Error(`${method}: every RPC attempt failed (last ${last})`);
  }

  /** `getHealth` on each endpoint, by name (ctl doctor). */
  async health() {
    const out: Record<string, string> = {};
    for (const e of this.eps)
      try {
        const r = await fetch(e.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }), signal: AbortSignal.timeout(this.timeoutMs) });
        out[e.name] = r.ok ? (((await r.json()) as { result?: string }).result ?? "no result") : `http ${r.status}`;
      } catch (err) {
        out[e.name] = (err as Error).name;
      }
    return out;
  }
}

export class RpcError extends Error {
  constructor(method: string, readonly code: number, message: string) {
    super(`${method}: ${message}`);
  }
}
