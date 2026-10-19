// HTTP face of the Signer: private network only. Binding to a public address is refused at start.

import net from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Signer } from "./signer.ts";

/** loopback and private ranges only (docs/OPS.md: no ingress) */
export function isPrivateHost(h: string): boolean {
  if (h === "localhost" || h === "::1") return true;
  if (net.isIPv4(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

export function app(signer: Signer) {
  const a = new Hono();
  a.get("/health", (c) => c.json({ ok: true, wallets: signer.wallets }));
  a.post("/sign/:name", async (c) => {
    const token = c.req.header("authorization")?.replace(/^Bearer /, "") ?? null;
    const body = await c.req.json().catch(() => null);
    const r = await signer.handle(`/sign/${c.req.param("name")}`, token, body);
    return c.json(r.body, r.status as 200);
  });
  a.all("*", (c) => c.json({ ok: false, reason: "unknown_endpoint" }, 404));
  return a;
}

export function listen(signer: Signer, host: string, port: number) {
  if (!isPrivateHost(host)) throw new Error(`signer refuses to bind ${host}: private addresses only`);
  const server = serve({ fetch: app(signer).fetch, hostname: host, port });
  server.on("error", (err) => {
    console.error(JSON.stringify({ signer: "refused to start", host, port, error: String(err) })); // a taken port could mean core talks to another process
    process.exit(1);
  });
  return server;
}
