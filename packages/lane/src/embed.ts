// The embedder (E5): text to vectors through the OpenAI-compatible `/embeddings` endpoint (OpenRouter), metered like a lane:
// its own hourly USD limit under the lane name `EMBED`, checked before every call. Model, URL and key come from env
// (EMBEDDING_MODEL, EMBEDDING_BASE_URL, EMBEDDING_API_KEY), the same ones MiroShark reads. `LLM_STUB=1` returns a
// deterministic hashed vector, so tests and offline runs need no network.
import crypto from "node:crypto";
import { loadEnv, need, num } from "./env.ts";
import { BudgetExceeded, MemorySpend, type SpendStore } from "./index.ts";

export const EMBED_LANE = "EMBED";
const STUB_DIM = 64;

/** A unit vector from the hash of each word, so texts sharing words land near each other. Pure. */
export function stubVector(text: string): number[] {
  const v = new Array<number>(STUB_DIM).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const h = crypto.createHash("sha256").update(w).digest();
    v[h[0]! % STUB_DIM]! += h[1]! & 1 ? 1 : -1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export interface EmbedderOpts {
  env?: NodeJS.ProcessEnv;
  spend?: SpendStore;
  now?: () => number;
  fetch?: typeof fetch;
}

export class Embedder {
  readonly model: string;
  readonly stubbed: boolean;
  private readonly cap: number;
  private readonly pricePerM: number;
  private readonly spend: SpendStore;
  private readonly now: () => number;
  usd = 0;
  calls = 0;

  constructor(private o: EmbedderOpts = {}) {
    const e = o.env ?? loadEnv();
    this.stubbed = ["1", "true"].includes(e.LLM_STUB ?? "");
    if (this.stubbed && e.ASIMOG_MODE === "live") throw new Error("embedder: LLM_STUB is refused when ASIMOG_MODE=live");
    this.model = this.stubbed ? "stub" : need(e, "EMBEDDING_MODEL");
    this.cap = num(e, `LLM_USD_HOUR_${EMBED_LANE}`, 0.05);
    this.pricePerM = num(e, "EMBEDDING_PRICE_PER_M", 0.02);
    this.spend = o.spend ?? new MemorySpend();
    this.now = o.now ?? (() => Date.now());
  }

  private hour(): string {
    return new Date(Math.floor(this.now() / 3_600_000) * 3_600_000).toISOString();
  }

  /** One call for a batch of texts. Refuses before the call when the lane is over its hourly limit. */
  async embed(texts: string[]): Promise<{ vectors: number[][]; usd: number }> {
    if (!texts.length) return { vectors: [], usd: 0 };
    const hour = this.hour();
    const spent = await this.spend.get(EMBED_LANE, hour);
    if (spent >= this.cap) throw new BudgetExceeded(EMBED_LANE, spent, this.cap);
    let vectors: number[][];
    let tokens: number;
    if (this.stubbed) {
      vectors = texts.map(stubVector);
      tokens = texts.reduce((a, t) => a + Math.ceil(t.length / 4), 0);
    } else {
      const e = this.o.env ?? loadEnv();
      const res = await (this.o.fetch ?? fetch)(`${need(e, "EMBEDDING_BASE_URL")}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${need(e, "EMBEDDING_API_KEY")}` },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
      if (!res.ok) throw new Error(`embedder: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { data: { index: number; embedding: number[] }[]; usage?: { prompt_tokens?: number } };
      vectors = [...j.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length !== texts.length) throw new Error(`embedder: asked ${texts.length}, got ${vectors.length}`);
      tokens = j.usage?.prompt_tokens ?? texts.reduce((a, t) => a + Math.ceil(t.length / 4), 0);
    }
    const usd = (tokens * this.pricePerM) / 1e6;
    await this.spend.add(EMBED_LANE, hour, usd);
    this.usd += usd;
    this.calls++;
    return { vectors, usd };
  }
}
