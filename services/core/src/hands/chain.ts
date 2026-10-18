// The Chain seam (docs/09): everything the Trader and Treasurer need from Solana. One real implementation on ONE
// endpoint (TX_SEND_URL), because sends never go through RpcPool (it refuses send*). Tests use an in-memory chain.
import { env } from "../lib/env.ts";

export type TokenDelta = { account: string; owner: string | null; mint: string; delta: number; post: number; created: boolean; rent_lamports: number };
export type Parsed = {
  sig: string;
  slot: number;
  err: string | null;
  fee: number; // lamports: network fee + priority fee paid by the fee payer
  lamports: Record<string, number>; // net lamport change per account
  tokens: TokenDelta[]; // token balance change per token account, in whole tokens
};
export type Sim = { err: string | null; sol_delta: number }; // lamport change of the wallet if the transaction lands

export interface Chain {
  balance(wallet: string): Promise<number>;
  blockhash(): Promise<string>;
  mintProgram(mint: string): Promise<string>;
  simulate(b64: string, wallet: string): Promise<Sim>;
  send(b64: string): Promise<string>;
  /** the transaction once it is confirmed, or null at timeout */
  confirm(sig: string, timeoutMs: number): Promise<Parsed | null>;
  /** the signature of a recent transaction of `wallet` with exactly this memo (`asimog:<id>` never matches `asimog:<id>:close`) */
  findByMemo(wallet: string, memo: string): Promise<string | null>;
  /** raw token units `wallet` holds of `mint` right now */
  tokenBalance(wallet: string, mint: string): Promise<number>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RpcChain implements Chain {
  private id = 0;
  constructor(private url = env.str("TX_SEND_URL")) {}

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }), signal: AbortSignal.timeout(env.int("TX_RPC_TIMEOUT_MS", 10_000)) });
    const j = (await res.json()) as { result?: T; error?: { message: string } };
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result as T;
  }

  async balance(wallet: string) {
    return (await this.rpc<{ value: number }>("getBalance", [wallet, { commitment: "confirmed" }])).value;
  }
  async blockhash() {
    return (await this.rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }])).value.blockhash;
  }
  async mintProgram(mint: string) {
    const r = await this.rpc<{ value: { owner: string } | null }>("getAccountInfo", [mint, { encoding: "base64", commitment: "confirmed" }]);
    if (!r.value) throw new Error("mint account not found");
    return r.value.owner; // never trust the API's token_program (docs/09)
  }
  async simulate(b64: string, wallet: string): Promise<Sim> {
    const before = await this.balance(wallet);
    const r = await this.rpc<{ value: { err: unknown; accounts: ({ lamports: number } | null)[] | null } }>("simulateTransaction", [b64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: [wallet] } }]);
    const after = r.value.accounts?.[0]?.lamports ?? before;
    return { err: r.value.err ? JSON.stringify(r.value.err) : null, sol_delta: after - before };
  }
  async send(b64: string) {
    return this.rpc<string>("sendTransaction", [b64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
  }
  async confirm(sig: string, timeoutMs: number): Promise<Parsed | null> {
    for (let waited = 0; waited < timeoutMs; waited += 600) { // bounded by attempts: no wall time in hands
      const t = await this.rpc<RawTx | null>("getTransaction", [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]).catch(() => null);
      if (t) return parseRaw(sig, t);
      await sleep(600);
    }
    return null;
  }
  async findByMemo(wallet: string, memo: string) {
    const rows = await this.rpc<{ signature: string; memo: string | null; err: unknown }[]>("getSignaturesForAddress", [wallet, { limit: 50, commitment: "confirmed" }]);
    // the RPC joins memos with "; " and prefixes each with its byte length, as in "[19] asimog:or_1"
    return rows.find((r) => r.memo?.split("; ").some((m) => m.replace(/^\[\d+\] /, "") === memo))?.signature ?? null;
  }
  async tokenBalance(wallet: string, mint: string) {
    const r = await this.rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    return r.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.amount), 0);
  }
}

type Bal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };
export type RawTx = {
  slot: number;
  transaction: { message: { accountKeys: string[] } };
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: Bal[]; postTokenBalances?: Bal[]; loadedAddresses?: { writable: string[]; readonly: string[] } };
};

/** Real fills come from the transaction, never from the quote (docs/09). */
export function parseRaw(sig: string, t: RawTx): Parsed {
  const keys = [...t.transaction.message.accountKeys, ...(t.meta.loadedAddresses?.writable ?? []), ...(t.meta.loadedAddresses?.readonly ?? [])];
  const lamports: Record<string, number> = {};
  keys.forEach((k, i) => {
    lamports[k] = (t.meta.postBalances[i] ?? 0) - (t.meta.preBalances[i] ?? 0);
  });
  const pre = new Map((t.meta.preTokenBalances ?? []).map((b) => [b.accountIndex, b]));
  const tokens: TokenDelta[] = (t.meta.postTokenBalances ?? []).map((p) => {
    const a = pre.get(p.accountIndex);
    const scale = 10 ** p.uiTokenAmount.decimals;
    return { account: keys[p.accountIndex]!, owner: p.owner ?? null, mint: p.mint, delta: (Number(p.uiTokenAmount.amount) - Number(a?.uiTokenAmount.amount ?? 0)) / scale, post: Number(p.uiTokenAmount.amount) / scale, created: !a, rent_lamports: a ? 0 : (t.meta.postBalances[p.accountIndex] ?? 0) };
  });
  for (const a of t.meta.preTokenBalances ?? []) // a closed account has a pre balance and no post balance
    if (!(t.meta.postTokenBalances ?? []).some((p) => p.accountIndex === a.accountIndex)) tokens.push({ account: keys[a.accountIndex]!, owner: a.owner ?? null, mint: a.mint, delta: -Number(a.uiTokenAmount.amount) / 10 ** a.uiTokenAmount.decimals, post: 0, created: false, rent_lamports: 0 });
  return { sig, slot: t.slot, err: t.meta.err ? JSON.stringify(t.meta.err) : null, fee: t.meta.fee, lamports, tokens };
}
