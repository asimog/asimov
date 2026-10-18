// The RPC pool (docs/OPS.md) against local fake providers: limits, budgets, refusals and secrecy hold. No network, no keys.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { RpcError, RpcPool, type EndpointSpec } from "../../../../services/core/src/lib/rpc.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

type Reply = { status?: number; headers?: Record<string, string>; body?: unknown };
type Fake = { url: string; seen: string[]; times: number[]; close(): void };

/** A fake provider: `reply` decides each answer; default is a good result. The key sits in the URL path, like QuickNode. */
async function fake(key: string, reply: (method: string, n: number) => Reply = () => ({})): Promise<Fake> {
  const seen: string[] = [];
  const times: number[] = [];
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const { method, id } = JSON.parse(b) as { method: string; id: number };
      seen.push(method);
      times.push(performance.now());
      const r = reply(method, seen.length);
      res.writeHead(r.status ?? 200, { "content-type": "application/json", ...r.headers });
      res.end(JSON.stringify(r.body ?? { jsonrpc: "2.0", id, result: "ok" }));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/${key}`, seen, times, close: () => srv.close() };
}

const spec = (name: string, f: Fake, o: Partial<EndpointSpec> = {}): EndpointSpec => ({ name, url: f.url, rps: 1000, ...o });
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rpcpool-")), "usage.json");
const rpcErr = (code: number, message: string): Reply => ({ body: { jsonrpc: "2.0", id: 1, error: { code, message } } });
const count = (f: Fake, m: string) => f.seen.filter((x) => x === m).length;

export const suite: Suite = {
  name: "rpc-pool",
  proves: "The RPC pool respects each provider's rate limit, monthly budget and refused methods, spills over on trouble, and never leaks a key.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const fakes: Fake[] = [];
    const mk = async (key: string, r?: Parameters<typeof fake>[1]) => {
      const f = await fake(key, r);
      fakes.push(f);
      return f;
    };
    const SECRET = "sekret-key-123";

    // 1. 429 rests the endpoint and the call moves on, losing nothing
    {
      const a = await mk(SECRET, () => ({ status: 429, headers: { "retry-after": "1" } }));
      const b = await mk("b");
      const p = new RpcPool({ endpoints: [spec("a", a), spec("b", b)], usageFile: null });
      const r1 = await p.call("getSlot", []);
      const r2 = await p.call("getSlot", []);
      add("429 moves the call to the next endpoint", r1 === "ok" && b.seen.length >= 1, `a saw ${a.seen.length}, b saw ${b.seen.length}`);
      add("a resting endpoint is not hit again", a.seen.length === 1 && r2 === "ok", `a saw ${a.seen.length}`);
    }

    // 2. refused methods never reach the endpoint
    {
      const a = await mk("a");
      const b = await mk("b");
      const p = new RpcPool({ endpoints: [spec("a", a, { deny: ["getProgramAccounts"] }), spec("b", b)], usageFile: null });
      await p.call("getProgramAccounts", []);
      add("refused method skips the endpoint", a.seen.length === 0 && b.seen.length === 1);
      const only = new RpcPool({ endpoints: [spec("a", a, { deny: ["getProgramAccounts"] })], usageFile: null });
      const msg = await only.call("getProgramAccounts", []).then(() => "no error", (e: Error) => e.message);
      add("no endpoint may serve it: fails at once", /no endpoint/.test(msg) && a.seen.length === 0, msg);
    }

    // 3. budget stops at 95% and falls over; usage survives a restart and resets in a new month
    {
      const a = await mk("a");
      const b = await mk("b");
      const file = tmp();
      let t = Date.UTC(2026, 9, 17);
      const make = () => new RpcPool({ endpoints: [spec("a", a, { budget: 100, cost: 30 }), spec("b", b)], usageFile: file, nowMs: () => t, saveEveryMs: 0 });
      let p = make();
      for (let i = 0; i < 4; i++) await p.call("getSlot", []);
      add("budget: 3 calls of 30 fit under 95 of 100, the 4th goes elsewhere", a.seen.length === 3 && b.seen.length === 1, `a ${a.seen.length}, b ${b.seen.length}`);
      p = make();
      await p.call("getSlot", []);
      add("usage survives a restart", a.seen.length === 3 && b.seen.length === 2, `a ${a.seen.length}, b ${b.seen.length}`);
      t = Date.UTC(2026, 10, 1);
      p = make();
      await p.call("getSlot", []);
      add("usage resets in a new month", a.seen.length === 4, `a ${a.seen.length}`);
    }

    // 4. rate limit spaces calls
    {
      const a = await mk("a");
      const p = new RpcPool({ endpoints: [spec("a", a, { rps: 10 })], usageFile: null });
      await Promise.all([1, 2, 3, 4].map(() => p.call("getSlot", [])));
      const gaps = a.times.slice(1).map((x, i) => x - a.times[i]!);
      add("4 calls at 10 per second are at least 90 ms apart", gaps.length === 3 && gaps.every((g) => g >= 90), gaps.map((g) => g.toFixed(0)).join(", "));
    }

    // 5. a JSON-RPC error is thrown at once, never retried elsewhere
    {
      const a = await mk("a", () => rpcErr(-32602, "bad param"));
      const b = await mk("b");
      const p = new RpcPool({ endpoints: [spec("a", a), spec("b", b)], usageFile: null });
      const e = await p.call("getAccountInfo", []).then(() => null, (x) => x);
      add("JSON-RPC error is thrown, not retried", e instanceof RpcError && b.seen.length === 0 && a.seen.length === 1);
    }

    // 6. a plan refusal denies the method on that endpoint, not the endpoint
    {
      const a = await mk("a", (m) => (m === "getTokenLargestAccounts" ? rpcErr(-32099, "Method not available") : {}));
      const b = await mk("b");
      const p = new RpcPool({ endpoints: [spec("a", a), spec("b", b)], usageFile: null });
      await p.call("getTokenLargestAccounts", []);
      await p.call("getTokenLargestAccounts", []);
      await p.call("getSlot", []);
      add("-32099 moves on and the method is not sent there again", count(a, "getTokenLargestAccounts") === 1 && count(b, "getTokenLargestAccounts") === 2);
      add("-32099 does not rest the endpoint", a.seen.at(-1) === "getSlot");
      const c = await mk("c", (m) => (m === "getTokenLargestAccounts" ? rpcErr(-32601, "only available on dedicated nodes") : {}));
      const d = await mk("d");
      const q = new RpcPool({ endpoints: [spec("c", c), spec("d", d)], usageFile: null });
      await q.call("getTokenLargestAccounts", []);
      await q.call("getTokenLargestAccounts", []);
      add("-32601 (dedicated nodes only) also denies the method there", count(c, "getTokenLargestAccounts") === 1 && count(d, "getTokenLargestAccounts") === 2);
    }

    // 7. send* is refused
    {
      const a = await mk("a");
      const p = new RpcPool({ endpoints: [spec("a", a)], usageFile: null });
      const msg = await p.call("sendTransaction", []).then(() => "no error", (e: Error) => e.message);
      add("send methods are refused by the pool", /not through the pool/.test(msg) && a.seen.length === 0, msg);
    }

    // 8. errors never echo the URL or key
    {
      const a = await mk(SECRET, () => ({ status: 500 }));
      const p = new RpcPool({ endpoints: [spec("a", a)], usageFile: null, maxTries: 2 });
      const msg = await p.call("getSlot", []).then(() => "no error", (e: Error) => e.message);
      add("failure message names the endpoint, never the key", msg.includes("a:") && !msg.includes(SECRET) && !msg.includes("127.0.0.1"), msg);
      const h = await p.health();
      add("health output has names only", !JSON.stringify(h).includes(SECRET));
    }

    for (const f of fakes) f.close();
    return { checks, metrics: { cases: checks.length } };
  },
};
