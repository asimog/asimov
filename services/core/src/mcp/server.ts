// The core MCP server (docs/18): streamable HTTP, stateless. The bearer token picks one capability; the tool list and
// every call are filtered by it. A call outside the lane comes back as an error with code `out_of_lane`.
import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { log } from "../lib/log.ts";
import type { Toolbox } from "./toolbox.ts";

function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers.authorization ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : undefined;
}

export async function startMcp(box: Toolbox, port: number): Promise<{ port: number; url: string; close(): Promise<void> }> {
  const srv = http.createServer(async (req, res) => {
    try {
      const token = bearer(req);
      const cap = box.capOf(token);
      if (req.url !== "/mcp" || !cap) {
        res.writeHead(cap ? 404 : 401, { "content-type": "application/json" }).end(JSON.stringify({ error: cap ? "not found" : "unauthorized" }));
        return;
      }
      const mcp = new Server({ name: "asimog-core", version: "1" }, { capabilities: { tools: {} } });
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: box.list(cap).map((t) => ({ name: t.name, description: t.desc, inputSchema: z.toJSONSchema(t.input, { io: "input" }) as { type: "object" } })),
      }));
      mcp.setRequestHandler(CallToolRequestSchema, async (r) => {
        const out = await box.call(token, r.params.name, r.params.arguments);
        return out.ok
          ? { content: [{ type: "text", text: JSON.stringify(out.value) }] }
          : { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: out.code, message: out.message } }) }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => void transport.close());
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.method === "POST" ? await readBody(req) : undefined);
    } catch (err) {
      log.warn("mcp", { err: String(err) });
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  await new Promise<void>((ok) => srv.listen(port, "127.0.0.1", ok));
  const bound = (srv.address() as { port: number }).port;
  return { port: bound, url: `http://127.0.0.1:${bound}/mcp`, close: () => new Promise<void>((ok) => srv.close(() => ok())) };
}
