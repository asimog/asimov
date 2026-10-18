// A belt is the set of core tools one agent may use, loaded from the core MCP server with @langchain/mcp-adapters.
// Calling a tool outside the belt throws LaneViolation before anything is sent; core refuses it again by token.
import { CoreRefused } from "@asimog/lane";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

export class LaneViolation extends Error {
  constructor(readonly tool: string, readonly agent: string) {
    super(`${agent} may not call ${tool}`);
  }
}

export interface Belt {
  names: string[];
  call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

const textOf = (out: unknown): string => {
  if (typeof out === "string") return out;
  if (Array.isArray(out)) return out.map(textOf).join("");
  if (out && typeof out === "object" && "text" in out) return String((out as { text: unknown }).text);
  return JSON.stringify(out);
};

export async function loadBelt(agent: string, url: string, token: string, allow: string[]): Promise<Belt> {
  const client = new MultiServerMCPClient({
    mcpServers: { core: { transport: "http", url, headers: { authorization: `Bearer ${token}` } } },
    prefixToolNameWithServerName: false,
    throwOnLoadError: true,
  });
  const tools = new Map((await client.getTools()).filter((t) => allow.includes(t.name)).map((t) => [t.name, t]));
  return {
    names: [...tools.keys()].sort(),
    async call<T>(name: string, args: Record<string, unknown> = {}) {
      const t = tools.get(name);
      if (!t) throw new LaneViolation(name, agent);
      try {
        const out = await t.invoke(JSON.parse(JSON.stringify(args)));
        return JSON.parse(textOf(out)) as T;
      } catch (err) {
        const m = /\{"error":\{"code":"([^"]+)","message":"((?:[^"\\]|\\.)*)"\}\}/.exec(String(err instanceof Error ? err.message : err));
        if (m) throw new CoreRefused(m[1]!, m[2]!);
        throw err;
      }
    },
    close: () => client.close(),
  };
}
