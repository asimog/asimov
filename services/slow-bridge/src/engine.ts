// HTTP client for one engine's /asimog/runs contract. Engines bind to localhost; the URL comes from env.
import type { RunRequest, RunStatus } from "./types.ts";

export class EngineClient {
  constructor(readonly name: string, private base: string, private timeoutMs = 15_000) {}

  async start(req: RunRequest): Promise<string> {
    const r = await fetch(`${this.base}/asimog/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal: AbortSignal.timeout(this.timeoutMs) });
    if (!r.ok) throw new Error(`${this.name} start: http ${r.status}`);
    return ((await r.json()) as { run_id: string }).run_id;
  }

  async status(runId: string): Promise<RunStatus> {
    const r = await fetch(`${this.base}/asimog/runs/${encodeURIComponent(runId)}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!r.ok) throw new Error(`${this.name} status: http ${r.status}`);
    return (await r.json()) as RunStatus;
  }

  async healthy(): Promise<boolean> {
    return fetch(`${this.base}/asimog/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
  }
}
