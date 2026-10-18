// RugCheck client (docs/15): token risk summaries. Reports are untrusted data and feed the Index, never an order.
// RUGCHECK_URL holds the key as ?key=...; the key goes in the X-API-KEY header instead, so it stays out of logs and error text.
import { env } from "./env.ts";

export type RugSummary = { score: number; score_normalised: number; lpLockedPct: number; risks: { name: string; level: string; score: number }[]; tokenProgram: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RugCheck {
  private readonly base = (env.opt("RUGCHECK_URL") ?? "https://api.rugcheck.xyz").split("?")[0]!.replace(/\/$/, "");
  private readonly key = env.opt("RUGCHECK_API_KEY");
  private readonly gapMs = 1000 / env.num("RUGCHECK_RPS", 2);
  private nextAt = 0;
  private restUntil = 0;

  async summary(mint: string): Promise<RugSummary | null> {
    const t = performance.now();
    const at = Math.max(t, this.nextAt, this.restUntil);
    this.nextAt = at + this.gapMs;
    if (at > t) await sleep(at - t);
    const r = await fetch(`${this.base}/v1/tokens/${encodeURIComponent(mint)}/report/summary`, {
      headers: this.key ? { "X-API-KEY": this.key } : {},
      signal: AbortSignal.timeout(env.int("RPC_TIMEOUT_MS", 8000)),
    });
    if (r.status === 429) {
      this.restUntil = performance.now() + Math.max(2000, Number(r.headers.get("retry-after") ?? 0) * 1000);
      return null;
    }
    if (!r.ok) return null; // 400/404: unknown token; a 5xx is the same to the caller: no report
    return (await r.json()) as RugSummary;
  }
}
