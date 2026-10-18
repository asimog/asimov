// Signer process. Reads keypair files the owner set in env; never prints them. See docs/09.
import { Keypair } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { listen } from "./server.ts";
import { Signer } from "./signer.ts";

const root = path.resolve(import.meta.dirname, "../../..");
function dotenv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [".env.example", ".env.local"]) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split("\n")) {
      const i = l.indexOf("=");
      if (i > 0 && !l.trim().startsWith("#") && l.slice(i + 1).trim()) out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
  }
  return { ...out, ...(process.env as Record<string, string>) };
}
const E = dotenv();
function num(name: string, fallback: number): number {
  const v = E[name];
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got ${v}`);
  return n;
}
const load = (name: string) => (E[name] ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(E[name]!, "utf8")) as number[])) : undefined);

const tokens = Object.fromEntries((E.SIGNER_TOKENS ?? "").split(",").filter(Boolean).map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]));
const signer = new Signer({
  keys: { trade: load("SIGNER_KEYPAIR_TRADE"), creator: load("SIGNER_KEYPAIR_CREATOR"), agent: load("SIGNER_KEYPAIR_AGENT"), operator: E.WALLET_OPERATOR },
  tokens,
  rules: {
    feeRecipients: (E.SIGNER_FEE_RECIPIENTS ?? "").split(",").filter(Boolean),
    maxPriorityLamports: num("SIGNER_MAX_PRIORITY_LAMPORTS", 200_000),
    maxOrderLamports: Math.round(num("SIGNER_MAX_ORDER_SOL", 0.05) * 1e9),
    coinMint: E.COIN_MINT,
  },
  auditFile: path.join(root, "artifacts", "signer-audit.jsonl"),
  killFile: path.join(root, "artifacts", "KILL"),
  ratePerMin: num("SIGNER_RATE_PER_MIN", 30),
});
listen(signer, E.SIGNER_HOST ?? "127.0.0.1", num("SIGNER_PORT", 7410));
console.log(JSON.stringify({ signer: "up", wallets: signer.wallets, capabilities: Object.keys(tokens) }));
