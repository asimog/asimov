// A lane is one thinking lane's door to a model (docs/SYSTEM.md): its own OpenRouter key, its own hourly USD limit, checked
// before every call. `models` is the chain from config/models.json (E4): the first uses LLM_KEY_<LANE>, the rest are free
// fallbacks on LLM_FALLBACK_KEY, tried in order when a call fails. `LLM_STUB=1` (or a stub passed in) swaps the model for a scripted one, so everything runs offline.

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import type { ZodType } from "zod";
import { loadEnv, need, num } from "./env.ts";

export * from "./core-client.ts";
export * from "./embed.ts";
export { loadEnv, need, num } from "./env.ts";
export const LANES = ["SYNTH", "SWARM", "EXTRACT", "THINK", "OPS", "BUILD"] as const;
export type LaneName = (typeof LANES)[number];

export class BudgetExceeded extends Error {
  constructor(readonly lane: string, readonly spent: number, readonly cap: number) {
    super(`lane ${lane} is over its limit: $${spent.toFixed(4)} of $${cap} this hour`);
  }
}
export class NoLaneKey extends Error {}

export interface SpendStore {
  get(lane: string, hour: string): Promise<number>;
  add(lane: string, hour: string, usd: number): Promise<void>;
}
export class MemorySpend implements SpendStore {
  private m = new Map<string, number>();
  async get(lane: string, hour: string) {
    return this.m.get(`${lane}|${hour}`) ?? 0;
  }
  async add(lane: string, hour: string, usd: number) {
    this.m.set(`${lane}|${hour}`, (this.m.get(`${lane}|${hour}`) ?? 0) + usd);
  }
}

export type Request = { system: string; user: string; maxTokens?: number };
/** What a stub answers: a function of the request, so tests script a lane by looking at the prompt. */
export type Responder = (req: Request & { lane: string }) => string;

class StubChat extends BaseChatModel {
  constructor(private lane: string, private responder: Responder) {
    super({});
  }
  _llmType() {
    return "stub";
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const text = (m: BaseMessage) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
    const system = messages.filter((m) => m.getType() === "system").map(text).join("\n");
    const user = messages.filter((m) => m.getType() !== "system").map(text).join("\n");
    const out = this.responder({ lane: this.lane, system, user });
    const msg = new AIMessage({ content: out, usage_metadata: { input_tokens: Math.ceil((system.length + user.length) / 4), output_tokens: Math.ceil(out.length / 4), total_tokens: 0 } });
    return { generations: [{ text: out, message: msg }] };
  }
}

/** The first JSON value in a model answer (it may sit in a code fence or after a sentence). */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "");
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "{" && t[i] !== "[") continue;
    const open = t[i]!;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j]!;
      if (inStr) {
        if (c === "\\") j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try {
          return JSON.parse(t.slice(i, j + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error("no JSON in the model answer");
}

export interface LaneOpts {
  env?: NodeJS.ProcessEnv;
  stub?: Responder;
  spend?: SpendStore;
  capUsdHour?: number;
  now?: () => number;
  /** primary model, then fallbacks (config `modelChain`); required unless stubbed */
  models?: string[];
}

export class Lane {
  readonly stubbed: boolean;
  private readonly spend: SpendStore;
  private readonly cap: number;
  private readonly price: { inM: number; outM: number };
  private readonly now: () => number;
  usd = 0;
  calls = 0;

  constructor(readonly name: LaneName | string, private o: LaneOpts = {}) {
    const e = o.env ?? loadEnv();
    this.spend = o.spend ?? new MemorySpend();
    this.cap = o.capUsdHour ?? num(e, `LLM_USD_HOUR_${name}`, 0.2);
    this.price = { inM: num(e, "LLM_PRICE_IN_PER_M", 0.032), outM: num(e, "LLM_PRICE_OUT_PER_M", 0.144) };
    this.now = o.now ?? (() => Date.now());
    this.stubbed = !!o.stub || ["1", "true"].includes(e.LLM_STUB ?? "");
    if (this.stubbed && e.ASIMOG_MODE === "live") throw new Error(`lane ${name}: LLM_STUB is refused when ASIMOG_MODE=live`); // fix plan 5.14
    if (this.stubbed) console.warn(JSON.stringify({ lane: name, llm: "stub", note: "LLM_STUB is on: answers are canned, not a model" }));
  }

  private models(maxTokens?: number): { model: string; chat: BaseChatModel | Error }[] {
    if (this.stubbed) return [{ model: "stub", chat: new StubChat(this.name, this.o.stub ?? (() => "{}")) }];
    const e = this.o.env ?? loadEnv();
    const ids = this.o.models ?? [];
    if (!ids.length) throw new Error(`lane ${this.name}: no models (config/models.json)`);
    return ids.map((model, i) => {
      const keyName = i === 0 ? `LLM_KEY_${this.name}` : "LLM_FALLBACK_KEY";
      const apiKey = e[keyName];
      if (!apiKey) return { model, chat: new NoLaneKey(`no key: set ${keyName} in .env.local`) };
      // no client retries: a failure moves down the chain at once
      return { model, chat: new ChatOpenAI({ apiKey, model, temperature: 0.2, maxTokens, maxRetries: 0, configuration: { baseURL: need(e, "LLM_BASE_URL") } }) };
    });
  }

  /** The first model in the chain that answers; throws naming every model's failure. */
  private async invoke(req: Request) {
    const msgs = [new SystemMessage(req.system), new HumanMessage(req.user)];
    const failed: string[] = [];
    for (const { model, chat } of this.models(req.maxTokens)) {
      if (chat instanceof Error) {
        failed.push(`${model}: ${chat.message}`);
        continue;
      }
      try {
        const res = await chat.invoke(msgs);
        if (failed.length) console.warn(JSON.stringify({ lane: this.name, fallback: model, failed }));
        return res;
      } catch (err) {
        failed.push(`${model}: ${String((err as Error).message ?? err).slice(0, 160)}`);
      }
    }
    throw new Error(`lane ${this.name}: every model failed (${failed.join("; ")})`);
  }

  private hour(): string {
    return new Date(Math.floor(this.now() / 3_600_000) * 3_600_000).toISOString();
  }

  spentThisHour(): Promise<number> {
    return this.spend.get(this.name, this.hour());
  }

  /** One model call. Refuses before the call when the lane is over its hourly limit. */
  async ask(req: Request): Promise<{ text: string; usd: number }> {
    const hour = this.hour();
    const spent = await this.spend.get(this.name, hour);
    if (spent >= this.cap) throw new BudgetExceeded(this.name, spent, this.cap);
    const res = await this.invoke(req);
    const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    const u = (res as AIMessage).usage_metadata;
    const usd = ((u?.input_tokens ?? Math.ceil((req.system.length + req.user.length) / 4)) * this.price.inM + (u?.output_tokens ?? Math.ceil(text.length / 4)) * this.price.outM) / 1e6;
    await this.spend.add(this.name, hour, usd);
    this.usd += usd;
    this.calls++;
    return { text, usd };
  }

  /** A call whose answer must match a schema. One repair attempt that quotes the problem back. */
  async askJson<T>(req: Request, schema: ZodType<T>): Promise<{ value: T; usd: number }> {
    let usd = 0;
    let problem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.ask(attempt ? { ...req, user: `${req.user}\n\nYour last answer was refused: ${problem}\nAnswer again with valid JSON only.` } : req);
      usd += r.usd;
      try {
        const parsed = schema.safeParse(extractJson(r.text));
        if (parsed.success) return { value: parsed.data, usd };
        problem = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      } catch (err) {
        problem = String(err);
      }
    }
    throw new Error(`lane ${this.name}: no valid JSON after a repair attempt (${problem})`);
  }
}

/** Untrusted text goes into a prompt only inside this fence, trimmed, with the fence markers removed from it. */
export function fence(text: string, max = 400): string {
  return `<untrusted>${text.replace(/<\/?untrusted>/gi, "").replace(/\s+/g, " ").trim().slice(0, max)}</untrusted>`;
}
