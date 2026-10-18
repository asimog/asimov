// How a thinking process talks to core: the MCP server, with one capability token (docs/SYSTEM.md). Nothing else.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export class CoreRefused extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface Core {
  tools(): Promise<string[]>;
  call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

/** Parse a tool result: JSON in the first text block; `isError` becomes CoreRefused with the code core gave. */
export function unwrap<T>(res: { isError?: boolean; content?: unknown }): T {
  const first = (res.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text");
  const body = first?.text ? (JSON.parse(first.text) as T) : ({} as T);
  if (res.isError) {
    const e = (body as { error?: { code: string; message: string } }).error;
    throw new CoreRefused(e?.code ?? "error", e?.message ?? first?.text ?? "tool failed");
  }
  return body;
}

export async function connectCore(url: string, token: string): Promise<Core> {
  const client = new Client({ name: "asimog-lane", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return {
    async tools() {
      return (await client.listTools()).tools.map((t) => t.name).sort();
    },
    async call<T>(name: string, args: Record<string, unknown> = {}) {
      return unwrap<T>((await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: unknown });
    },
    close: () => client.close(),
  };
}
