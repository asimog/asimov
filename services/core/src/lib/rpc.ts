// RPC pool (docs/15): several free Solana RPC endpoints used as one, each held to its own plan: requests per second,
// monthly budget, refused methods. RPC_URLS = "name|rps|url,name|rps|url" in order of preference; falls back to RPC_URL.
// Per provider NAME (upper case): RPC_DENY_NAME, RPC_BUDGET_NAME (units a month, 0 = no cap), RPC_COST_NAME (units a call).
// URLs hold API keys: we log names only.
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.ts";

export type EndpointSpec = { name: string; url: string; rps: number; deny?: string[]; budget?: number; cost?: number };
export type PoolOpts = {
  endpoints?: EndpointSpec[]; // default: from env
  usageFile?: string | null; // monthly usage counts; null keeps them in memory only
  nowMs?: () => number; // month boundaries only; pacing uses performance.now
  saveEveryMs?: number;
  maxTries?: number;
};

type Endpoint = {
  name: string; url: string; rps: number; deny: Set<string>; budget: number; cost: number; used: number;
  nextFreeMs: number; restUntilMs: number; restMs: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now(); // pacing only, never a recorded time (recorded times come from the Clock)
const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export function specsFromEnv(): EndpointSpec[] {
  const raw = env.opt("RPC_URLS");
  const specs = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        const [name, rps, ...rest] = s.split("|");
        const N = name!.toUpperCase();
        return { name: name!, rps: Number(rps), url: rest.join("|"), deny: list(env.opt(`RPC_DENY_${N}`)), budget: env.num(`RPC_BUDGET_${N}`, 0), cost: env.num(`RPC_COST_${N}`, 1) };
      })
    : env.opt("RPC_URL") ? [{ name: "rpc", rps: env.num("RPC_RPS", 5), url: env.str("RPC_URL") }] : [];
  return specs.filter((s) => s.url); // a provider whose URL is not in .env.local is dropped
}

const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

export class RpcPool {
  private eps: Endpoint[];
  private id = 0;
  private readonly timeoutMs = env.int("RPC_TIMEOUT_MS", 8000);
  private readonly maxTries: number;
  private readonly stop = env.num("RPC_BUDGET_STOP", 0.95);
  private readonly usageFile: string | null;
  private readonly nowMs: () => number;
  private readonly saveEveryMs: number;
  private month = "";
  private lastSave = 0;
  stats: Record<string, { ok: number; failed: number }>;

  constructor(o: PoolOpts = {}) {
    this.eps = (o.endpoints ?? specsFromEnv()).map((s) => ({ name: s.name, url: s.url, rps: s.rps, deny: new Set(s.deny ?? []), budget: s.budget ?? 0, cost: s.cost ?? 1, used: 0, nextFreeMs: 0, restUntilMs: 0, restMs: 0 }));
    this.maxTries = o.maxTries ?? env.int("RPC_MAX_TRIES", 6);
    this.nowMs = o.nowMs ?? Date.now;
    this.saveEveryMs = o.saveEveryMs ?? 5000;
    this.usageFile = o.usageFile === undefined ? path.join(env.root, "artifacts", "rpc-usage.json") : o.usageFile;
    this.stats = Object.fromEntries(this.eps.map((e) => [e.name, { ok: 0, failed: 0 }]));
    this.load();
  }

  get names() {
    return this.eps.map((e) => e.name);
  }

  get size() {
    return this.eps.length;
  }

  /** Units used this month against the budget, by endpoint name (ctl doctor). */
  usage() {
    this.roll();
    return Object.fromEntries(this.eps.map((e) => [e.name, e.budget ? `${e.used}/${e.budget}` : `${e.used}/no cap`]));
  }

  private load() {
    this.month = monthOf(this.nowMs());
    if (!this.usageFile || !fs.existsSync(this.usageFile)) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.usageFile, "utf8")) as { month: string; used: Record<string, number> };
      if (j.month === this.month) for (const e of this.eps) e.used = j.used[e.name] ?? 0;
    } catch {
      // a torn file means counts start at zero; the provider dashboards stay the truth
    }
  }

  private save(force = false) {
    if (!this.usageFile) return;
    const t = this.nowMs();
    if (!force && t - this.lastSave < this.saveEveryMs) return;
    this.lastSave = t;
    fs.mkdirSync(path.dirname(this.usageFile), { recursive: true });
    fs.writeFileSync(this.usageFile, JSON.stringify({ month: this.month, used: Object.fromEntries(this.eps.map((e) => [e.name, e.used])) }));
  }

  private roll() {
    const m = monthOf(this.nowMs());
    if (m === this.month) return;
    this.month = m;
    for (const e of this.eps) e.used = 0;
  }

  /** May this endpoint take this call: method allowed by its plan, budget left under the stop line. */
  private eligible(e: Endpoint, method: string) {
    return !e.deny.has(method) && (!e.budget || e.used + e.cost <= e.budget * this.stop);
  }

  /** The first eligible endpoint that is not resting, waiting for its rate-limit slot; or the one that wakes soonest. */
  private async pick(method: string): Promise<Endpoint> {
    this.roll();
    const ok = this.eps.filter((e) => this.eligible(e, method));
    if (!ok.length) throw new Error(`${method}: no endpoint can serve it (refused by every plan, or every budget is spent)`);
    const t = now();
    const awake = ok.filter((e) => e.restUntilMs <= t);
    // preference order first; if every awake endpoint is at its rate limit, the one free soonest; if all rest, the one waking soonest
    const e = awake.find((x) => x.nextFreeMs <= t)
      ?? (awake.length ? awake.reduce((a, b) => (b.nextFreeMs < a.nextFreeMs ? b : a)) : ok.reduce((a, b) => (b.restUntilMs < a.restUntilMs ? b : a)));
    const at = Math.max(t, e.restUntilMs, e.nextFreeMs);
    e.nextFreeMs = at + 1000 / e.rps;
    e.used += e.cost;
    this.save();
    if (at > t) await sleep(at - t);
    return e;
  }

  private rest(e: Endpoint, retryAfterMs = 0) {
    e.restMs = Math.min(10_000, e.restMs ? e.restMs * 2 : 1000);
    e.restUntilMs = now() + Math.max(e.restMs, Math.min(60_000, retryAfterMs));
    this.stats[e.name]!.failed++;
  }

  /** One JSON-RPC call. Provider trouble moves it to the next endpoint; a JSON-RPC error is thrown as is. */
  async call<T>(method: string, params: unknown[]): Promise<T> {
    if (!this.eps.length) throw new Error("no RPC endpoint configured (RPC_URLS or RPC_URL)");
    if (/^send/i.test(method)) throw new Error(`${method}: money paths send through one chosen endpoint, not through the pool`);
    let last = "";
    for (let attempt = 0; attempt < this.maxTries; attempt++) {
      const e = await this.pick(method);
      try {
        const r = await fetch(e.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (r.status === 429 || r.status >= 500) {
          last = `${e.name}: http ${r.status}`;
          this.rest(e, Number(r.headers.get("retry-after") ?? 0) * 1000);
          continue;
        }
        const j = (await r.json()) as { result?: T; error?: { code: number; message: string } };
        if (j.error && (j.error.code === -32601 || (j.error.code === -32099 && /not available/i.test(j.error.message)))) {
          e.deny.add(method); // a plan refusal (-32099 "not available", -32601 "dedicated nodes only"), not an outage: never send this method there again
          last = `${e.name}: ${method} refused by plan`;
          continue;
        }
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

  /** `getSlot` on each endpoint, by name (ctl doctor). Not counted against budgets: one call a run. */
  async health() {
    const out: Record<string, string> = {};
    for (const e of this.eps)
      try {
        const r = await fetch(e.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }), signal: AbortSignal.timeout(this.timeoutMs) });
        out[e.name] = r.ok ? (((await r.json()) as { result?: number }).result !== undefined ? "ok" : "no result") : `http ${r.status}`;
      } catch (err) {
        out[e.name] = (err as Error).name;
      }
    this.save(true);
    return out;
  }
}

export class RpcError extends Error {
  constructor(method: string, readonly code: number, message: string) {
    super(`${method}: ${message}`);
  }
}
