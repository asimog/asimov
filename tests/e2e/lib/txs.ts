// Test transactions for the Signer and the Trader: real serialized transactions built with test keypairs.
// Keypairs are generated in memory; nothing here touches a real key.
import crypto from "node:crypto";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "../../../services/signer/src/web3.ts";
import { NATIVE_MINT, PROGRAMS } from "../../../services/signer/src/policy.ts";

export const pk = (s: string) => new PublicKey(s);
export const disc = (name: string) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
export const u64 = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
export const ix = (program: string, keys: { pubkey: string; signer?: boolean; writable?: boolean }[], data: Buffer) =>
  new TransactionInstruction({ programId: pk(program), keys: keys.map((k) => ({ pubkey: pk(k.pubkey), isSigner: !!k.signer, isWritable: k.writable ?? true })), data });

export const budget = (units: number, microLamports: number) => [
  ix(PROGRAMS.budget, [], Buffer.concat([Buffer.from([2]), Buffer.from(new Uint32Array([units]).buffer)])),
  ix(PROGRAMS.budget, [], Buffer.concat([Buffer.from([3]), u64(microLamports)])),
];
export const transfer = (from: string, to: string, lamports: number) =>
  ix(PROGRAMS.system, [{ pubkey: from, signer: true }, { pubkey: to }], Buffer.concat([Buffer.from(new Uint32Array([2]).buffer), u64(lamports)]));
export const memo = (text: string) => ix(PROGRAMS.memo, [], Buffer.from(text));
export const closeAccount = (account: string, dest: string, owner: string, program: string = PROGRAMS.token) =>
  ix(program, [{ pubkey: account }, { pubkey: dest }, { pubkey: owner, signer: true }], Buffer.from([9]));
export const tokenTransfer = (src: string, dst: string, owner: string, amount: number) =>
  ix(PROGRAMS.token, [{ pubkey: src }, { pubkey: dst }, { pubkey: owner, signer: true }], Buffer.concat([Buffer.from([3]), u64(amount)]));
export const pumpBuy = (user: string, mint: string, tokens: number, maxSol: number, program: string = PROGRAMS.pump) =>
  ix(program, [{ pubkey: user, signer: true }, { pubkey: mint }], Buffer.concat([disc("buy"), u64(tokens), u64(maxSol), Buffer.from([0, 0])]));
export const pumpSell = (user: string, mint: string, tokens: number, minSol: number) =>
  ix(PROGRAMS.pump, [{ pubkey: user, signer: true }, { pubkey: mint }], Buffer.concat([disc("sell"), u64(tokens), u64(minSol)]));
export const pumpNamed = (program: string, name: string, user: string, args: Buffer = Buffer.alloc(0)) =>
  ix(program, [{ pubkey: user, signer: true }], Buffer.concat([disc(name), args]));
export const createAta = (payer: string, owner: string, mint: string) =>
  ix(PROGRAMS.ata, [{ pubkey: payer, signer: true }, { pubkey: payer }, { pubkey: owner }, { pubkey: mint }], Buffer.from([1]));

export function build(payer: string, ixs: TransactionInstruction[], extraSigners: string[] = [], blockhash: string = PROGRAMS.system): { tx: VersionedTransaction; b64: string } {
  void extraSigners;
  const msg = new TransactionMessage({ payerKey: pk(payer), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  return { tx, b64: Buffer.from(tx.serialize()).toString("base64") };
}

export const newKeys = () => ({ trade: Keypair.generate(), creator: Keypair.generate(), agent: Keypair.generate(), operator: Keypair.generate().publicKey.toBase58(), stranger: Keypair.generate(), mint: Keypair.generate().publicKey.toBase58(), fee: Keypair.generate().publicKey.toBase58() });
export { NATIVE_MINT, PROGRAMS };
