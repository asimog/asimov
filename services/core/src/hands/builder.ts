// Transaction builders (docs/09): the fun-block API for swaps and fee collection, local code for the small ones
// (order memo, close account, SOL transfers, proof memo). The Signer checks every result; nothing here is trusted.
import { MessageV0, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { env } from "../lib/env.ts";
import type { Chain } from "./chain.ts";

export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const NATIVE_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS = 1_000_000_000;

export interface Builder {
  swap(a: { side: "buy" | "sell"; mint: string; wallet: string; amount: string; slippagePct: number }): Promise<{ tx: string; route: "curve" | "amm" }>;
  collectFees(a: { mint: string; user: string }): Promise<{ tx: string }>;
}

export class FunBlock implements Builder {
  constructor(private base = env.str("FUN_BLOCK_URL")) {}
  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(body as object), encoding: "base64" }), signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`fun-block ${path} ${res.status}`);
    return (await res.json()) as T;
  }
  async swap(a: { side: "buy" | "sell"; mint: string; wallet: string; amount: string; slippagePct: number }) {
    const buy = a.side === "buy";
    const r = await this.post<{ transaction: string; pumpMintInfo?: { hasGraduated?: boolean } }>("/agents/swap", {
      inputMint: buy ? NATIVE_MINT : a.mint, outputMint: buy ? a.mint : NATIVE_MINT, amount: a.amount, user: a.wallet, feePayer: a.wallet, slippagePct: a.slippagePct, frontRunningProtection: false,
    });
    return { tx: r.transaction, route: r.pumpMintInfo?.hasGraduated ? ("amm" as const) : ("curve" as const) };
  }
  async collectFees(a: { mint: string; user: string }) {
    const r = await this.post<{ transaction: string }>("/agents/collect-fees", { mint: a.mint, user: a.user, frontRunningProtection: false });
    return { tx: r.transaction };
  }
}

const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");
const memoIx = (text: string) => new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from(text) });

/** Add the order memo to a built transaction (idempotency key, docs/09). The memo program joins the static keys; table indexes shift by one. */
export function appendMemo(txB64: string, text: string): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(txB64, "base64"));
  const m = tx.message;
  const keys = [...m.staticAccountKeys];
  const n = keys.length;
  let at = keys.findIndex((k) => k.toBase58() === MEMO_PROGRAM);
  const shift = at < 0;
  if (shift) {
    keys.push(new PublicKey(MEMO_PROGRAM));
    at = n;
  }
  const fix = (i: number) => (shift && i >= n ? i + 1 : i);
  const ixs = m.compiledInstructions.map((i) => ({ programIdIndex: fix(i.programIdIndex), accountKeyIndexes: i.accountKeyIndexes.map(fix), data: i.data }));
  ixs.push({ programIdIndex: at, accountKeyIndexes: [], data: Buffer.from(text) });
  const header = { ...m.header, numReadonlyUnsignedAccounts: m.header.numReadonlyUnsignedAccounts + (shift ? 1 : 0) };
  const msg = new MessageV0({ header, staticAccountKeys: keys, recentBlockhash: m.recentBlockhash, compiledInstructions: ixs, addressTableLookups: m.addressTableLookups });
  return b64(new VersionedTransaction(msg));
}

async function unsigned(chain: Chain, payer: string, ixs: TransactionInstruction[]) {
  const msg = new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: await chain.blockhash(), instructions: ixs }).compileToV0Message();
  return b64(new VersionedTransaction(msg));
}

export const tokenAccountOf = (owner: string, mint: string, program: string) =>
  PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(program).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0].toBase58();

/** Close the wallet's empty token account for `mint`; the rent comes back to the wallet. The mint's owner program is read on chain. */
export async function closeAccountTx(chain: Chain, wallet: string, mint: string, orderId: string) {
  const program = await chain.mintProgram(mint);
  const account = tokenAccountOf(wallet, mint, program);
  const close = new TransactionInstruction({ programId: new PublicKey(program), keys: [{ pubkey: new PublicKey(account), isSigner: false, isWritable: true }, { pubkey: new PublicKey(wallet), isSigner: false, isWritable: true }, { pubkey: new PublicKey(wallet), isSigner: true, isWritable: false }], data: Buffer.from([9]) });
  return { tx: await unsigned(chain, wallet, [close, memoIx(`asimog:${orderId}:close`)]), account };
}

export async function transfersTx(chain: Chain, from: string, legs: { to: string; lamports: number }[], memo: string) {
  const ixs = legs.filter((l) => l.lamports > 0).map((l) => {
    const d = Buffer.alloc(12);
    d.writeUInt32LE(2, 0);
    d.writeBigUInt64LE(BigInt(l.lamports), 4);
    return new TransactionInstruction({ programId: new PublicKey("11111111111111111111111111111111"), keys: [{ pubkey: new PublicKey(from), isSigner: true, isWritable: true }, { pubkey: new PublicKey(l.to), isSigner: false, isWritable: true }], data: d });
  });
  return unsigned(chain, from, [...ixs, memoIx(memo)]);
}

export const proofMemoTx = (chain: Chain, agent: string, sha256: string) => unsigned(chain, agent, [memoIx(`asimog:proof:${sha256}`)]);
