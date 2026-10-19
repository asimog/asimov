// HTTP client for one engine's /asimog/runs contract. Engines bind to localhost; the URL and the worker's bearer token come from env.
import type { RunRequest, RunStatus } from "./types.ts";

export class EngineClient {
  constructor(readonly name: string, private base: string, private token: string, private timeoutMs = 15_000) {}

  private headers(json = false): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, ...(json ? { "content-type": "application/json" } : {}) };
  }

  /** Start a run. A job id the worker already knows (409) answers with that run: never a second one. */
  async start(req: RunRequest): Promise<string> {
    const r = await fetch(`${this.base}/asimog/runs`, { method: "POST", headers: this.headers(true), body: JSON.stringify(req), signal: AbortSignal.timeout(this.timeoutMs) });
    if (!r.ok && r.status !== 409) throw new Error(`${this.name} start: http ${r.status} ${(await r.text()).slice(0, 120)}`);
    return ((await r.json()) as { run_id: string }).run_id;
  }

  async status(runId: string): Promise<RunStatus> {
    const r = await fetch(`${this.base}/asimog/runs/${encodeURIComponent(runId)}`, { headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs) });
    if (!r.ok) throw new Error(`${this.name} status: http ${r.status}`);
    return (await r.json()) as RunStatus;
  }

  /** Stop a run at its next model call; the worker finishes it `failed: cancelled`. */
  async cancel(runId: string): Promise<void> {
    await fetch(`${this.base}/asimog/runs/${encodeURIComponent(runId)}`, { method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs) }).catch(() => undefined);
  }

  async healthy(): Promise<boolean> {
    return fetch(`${this.base}/asimog/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
  }
}
