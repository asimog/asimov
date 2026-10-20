// How the core asks the Signer (docs/EXECUTION.md). One client per capability token; the tests use an in-process implementation.
import { env } from "../lib/env.ts";

export type SignCtx = { max_lamports?: number; order_id?: string; side?: "buy" | "sell"; max_tokens?: number; total_lamports?: number; agent_room_lamports?: number; mint?: string };
export type SignReply = { ok: true; signed: string; signature: string } | { ok: false; reason: string; detail?: string };

export interface SignerClient {
  sign(endpoint: string, tx: string, ctx?: SignCtx): Promise<SignReply>;
}

export class HttpSigner implements SignerClient {
  constructor(private token: string, private base = `http://${env.opt("SIGNER_HOST") ?? "127.0.0.1"}:${env.int("SIGNER_PORT")}`) {}
  async sign(endpoint: string, tx: string, ctx: SignCtx = {}): Promise<SignReply> {
    const res = await fetch(`${this.base}${endpoint}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` }, body: JSON.stringify({ tx, ctx }), signal: AbortSignal.timeout(5000) });
    const j = (await res.json()) as { ok: boolean; signed?: string; signature?: string; reason?: string; detail?: string };
    return j.ok ? { ok: true, signed: j.signed!, signature: j.signature! } : { ok: false, reason: j.reason ?? `http ${res.status}`, detail: j.detail };
  }
}
