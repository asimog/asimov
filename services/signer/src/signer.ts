// The Signer (docs/EXECUTION.md): one handler per endpoint, one capability per token, an audit line for every request.
// It signs and returns; it never sends. Keys are injected (main.ts loads them from files the owner sets).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Keypair } from "@solana/web3.js";
import { type Ctx, checkCloseAccount, checkCollectFees, checkMemo, checkSweepSplit, checkSwap, parse, type Rules, type Verdict, type Wallets } from "./policy.ts";

export const ENDPOINTS = ["/sign/swap", "/sign/close-account", "/sign/collect-fees", "/sign/sweep-split", "/sign/memo", "/sign/login", "/sign/bounty", "/sign/x402"] as const;
export type Endpoint = (typeof ENDPOINTS)[number];
/** which capability opens which endpoint (docs/SYSTEM.md) */
export const CAPS: Record<string, Endpoint[]> = {
  "cap:sign.swap": ["/sign/swap", "/sign/close-account"],
  "cap:sign.treasury": ["/sign/collect-fees", "/sign/sweep-split", "/sign/memo"],
  "cap:sign.login": ["/sign/login"],
};

export type Keys = { trade?: Keypair; creator?: Keypair; agent?: Keypair; operator?: string };
export type SignerOpts = {
  keys: Keys;
  tokens: Record<string, string>; // capability -> secret
  rules: Rules;
  auditFile: string;
  killFile: string;
  ratePerMin?: number;
  now?: () => number;
};
export type Reply = { status: number; body: { ok: boolean; reason?: string; detail?: string; signed?: string; signature?: string; info?: unknown } };

export class Signer {
  private prev = "genesis";
  private hits = new Map<string, number[]>();
  readonly wallets: Wallets;
  refusals = 0;

  constructor(private o: SignerOpts) {
    this.wallets = { trade: o.keys.trade?.publicKey.toBase58(), creator: o.keys.creator?.publicKey.toBase58(), agent: o.keys.agent?.publicKey.toBase58(), operator: o.keys.operator };
    fs.mkdirSync(path.dirname(o.auditFile), { recursive: true });
    if (fs.existsSync(o.auditFile)) {
      const last = fs.readFileSync(o.auditFile, "utf8").trim().split("\n").pop();
      if (last) this.prev = (JSON.parse(last) as { hash: string }).hash;
    }
  }

  private now() {
    return (this.o.now ?? Date.now)();
  }

  private audit(endpoint: string, cap: string | null, ok: boolean, reason: string | null, txSha: string | null, signature: string | null) {
    const line = { t: new Date(this.now()).toISOString(), endpoint, cap, ok, reason, tx_sha256: txSha, signature, prev: this.prev };
    const hash = crypto.createHash("sha256").update(JSON.stringify(line)).digest("hex");
    fs.appendFileSync(this.o.auditFile, `${JSON.stringify({ ...line, hash })}\n`);
    this.prev = hash;
    if (!ok) this.refusals++;
  }

  private capOf(endpoint: string, token: string | null): string | null {
    if (!token) return null;
    for (const [cap, secret] of Object.entries(this.o.tokens)) {
      const digest = (x: string) => crypto.createHash("sha256").update(x).digest(); // equal lengths: the compare leaks nothing about the token
      if (crypto.timingSafeEqual(digest(secret), digest(token)) && CAPS[cap]?.includes(endpoint as Endpoint)) return cap;
    }
    return null;
  }

  /** No file: running. "exit_only": sells only. Anything else, or a file we cannot read: halted. */
  private killState(): "running" | "exit_only" | "halted" {
    if (!fs.existsSync(this.o.killFile)) return "running";
    try {
      return fs.readFileSync(this.o.killFile, "utf8").trim() === "exit_only" ? "exit_only" : "halted";
    } catch {
      return "halted";
    }
  }

  private limited(endpoint: string) {
    const t = this.now();
    const recent = (this.hits.get(endpoint) ?? []).filter((x) => t - x < 60_000);
    recent.push(t);
    this.hits.set(endpoint, recent);
    return recent.length > (this.o.ratePerMin ?? 30);
  }

  async handle(endpoint: string, token: string | null, body: { tx?: string; ctx?: Ctx } | null): Promise<Reply> {
    const refuse = (status: number, reason: string, detail?: string, cap: string | null = null, sha: string | null = null): Reply => {
      this.audit(endpoint, cap, false, reason, sha, null);
      return { status, body: { ok: false, reason, detail } };
    };
    if (!(ENDPOINTS as readonly string[]).includes(endpoint)) return refuse(404, "unknown_endpoint");
    if (this.limited(endpoint)) return refuse(429, "rate_limited");
    const cap = this.capOf(endpoint, token);
    if (!cap) return refuse(401, "bad_capability");
    if (endpoint === "/sign/login" || endpoint === "/sign/bounty" || endpoint === "/sign/x402") return refuse(501, "endpoint_not_enabled", "arrives with S8 and S9", cap);
    const kill = this.killState();
    if (kill === "halted") return refuse(403, "kill_switch", "halted", cap);
    if (!body || typeof body.tx !== "string") return refuse(400, "bad_request", "tx missing", cap);
    const tx = parse(body.tx);
    if (!tx) return refuse(400, "bad_transaction", "cannot read transaction", cap);
    const sha = crypto.createHash("sha256").update(body.tx).digest("hex");
    const ctx = { ...(body.ctx ?? {}), killed: kill === "exit_only" }; // read here, never trusted from the caller
    const { rules, keys, wallets } = { rules: this.o.rules, keys: this.o.keys, wallets: this.wallets };
    let v: Verdict;
    let key: Keypair | undefined;
    switch (endpoint as Endpoint) {
      case "/sign/swap": ((v = checkSwap(tx, wallets, ctx, rules)), (key = keys.trade)); break;
      case "/sign/close-account": ((v = checkCloseAccount(tx, wallets, rules)), (key = keys.trade)); break;
      case "/sign/collect-fees": ((v = checkCollectFees(tx, wallets, ctx, rules)), (key = keys.creator)); break;
      case "/sign/sweep-split": ((v = checkSweepSplit(tx, wallets, ctx, rules)), (key = keys.creator)); break;
      case "/sign/memo": ((v = checkMemo(tx, wallets, rules)), (key = keys.agent)); break;
      default: return refuse(404, "unknown_endpoint", undefined, cap, sha);
    }
    if (!v.ok) return refuse(403, v.reason, v.detail, cap, sha);
    if (!key) return refuse(501, "endpoint_not_enabled", "key not loaded", cap, sha);
    tx.sign([key]);
    const sigB58 = bs58(tx.signatures[0]!);
    this.audit(endpoint, cap, true, null, sha, sigB58);
    return { status: 200, body: { ok: true, signed: Buffer.from(tx.serialize()).toString("base64"), signature: sigB58, info: v.detail ?? null } };
  }
}

const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bs58(buf: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(buf).toString("hex")}`);
  let s = "";
  while (n > 0n) {
    s = A[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = `1${s}`;
  }
  return s;
}

/** Verify the audit chain (used by tests and `ctl doctor`): every line hashes to its own hash and names the one before. */
export function verifyAudit(file: string): { ok: boolean; lines: number; bad?: number } {
  let prev = "genesis";
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [];
  for (let i = 0; i < lines.length; i++) {
    const { hash, ...rest } = JSON.parse(lines[i]!) as { hash: string; prev: string };
    if (rest.prev !== prev || crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex") !== hash) return { ok: false, lines: lines.length, bad: i };
    prev = hash;
  }
  return { ok: true, lines: lines.length };
}
