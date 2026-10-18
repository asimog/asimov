// Holder snapshot (docs/PIPELINE.md section 3): the 20 largest token accounts of a promoted coin, accounts owned by programs
// (the bonding curve, AMM pools, lockers) left out. Written as `holders.snapshot`, so replays see it.
import { PublicKey } from "@solana/web3.js";
import type { RpcPool } from "../lib/rpc.ts";
import { bondingCurvePda } from "../senses/backfill.ts";
import type { Tape } from "../tape/tape.ts";

const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN22 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** The curve's token account under both token programs: we exclude whichever exists. */
export function curveAccounts(mint: string, known: string | null): string[] {
  const curve = bondingCurvePda(mint);
  const ata = (prog: PublicKey) => PublicKey.findProgramAddressSync([curve.toBuffer(), prog.toBuffer(), new PublicKey(mint).toBuffer()], ATA)[0].toBase58();
  return [...new Set([...(known ? [known] : []), ata(TOKEN), ata(TOKEN22)])];
}

type Largest = { value: { address: string; uiAmount: number | null }[] };
type Supply = { value: { uiAmount: number | null } };
type Parsed = { value: ({ data: { parsed?: { info?: { owner?: string } } } } | null)[] };

/**
 * Top-10 share of the whole supply held by people. Accounts owned by a program (an off-curve address: the bonding
 * curve, an AMM pool vault, a locker) are excluded, and so is the curve's token account even before it is parsed.
 */
export async function snapshotHolders(pool: RpcPool, tape: Tape, mint: string, curveAccount: string | null, causes: string[]) {
  const [largest, supply] = await Promise.all([pool.call<Largest>("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]), pool.call<Supply>("getTokenSupply", [mint])]);
  const accounts = largest.value.map((a) => a.address);
  // RPC Fast and QuickNode free plans take at most 5 keys per getMultipleAccounts
  const parsed: Parsed = { value: [] };
  for (let i = 0; i < accounts.length; i += 5) parsed.value.push(...(await pool.call<Parsed>("getMultipleAccounts", [accounts.slice(i, i + 5), { encoding: "jsonParsed" }])).value);
  const programOwned = new Set(accounts.filter((_, i) => {
    const owner = parsed.value[i]?.data.parsed?.info?.owner;
    return owner ? !PublicKey.isOnCurve(new PublicKey(owner).toBytes()) : false;
  }));
  const excluded = [...new Set([...curveAccounts(mint, curveAccount), ...programOwned])];
  const total = supply.value.uiAmount ?? 1e9;
  const top = largest.value.map((a) => ({ account: a.address, amount: a.uiAmount ?? 0 })).filter((a) => !excluded.includes(a.account));
  const top10 = top.slice(0, 10).reduce((s, a) => s + a.amount, 0);
  tape.emit("holders.snapshot", { mint, supply: total, top, excluded, top10_share: Math.min(1, top10 / Math.max(1, total)) }, { source: "rpc", subject: mint, causes });
}
