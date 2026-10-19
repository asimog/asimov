// Funder links (docs/PIPELINE.md section 3): the wallet that sent a fresh wallet its first SOL. Wallets that share a
// funder are one actor, which is how bundles and second wallets are joined. Recorded slice:
// tests/e2e/fixtures/rpc/funder-slice.json. A wallet with a full page of signatures is not fresh: its first transaction is
// out of one page's reach, so its funder stays unknown rather than guessed.
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import type { RpcPool } from "../lib/rpc.ts";

const PAGE = 1000;

type Ix = { program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; newAccount?: string } } };
export type ParsedTx = { transaction: { message: { instructions: Ix[] } }; meta: { err: unknown; innerInstructions?: { instructions: Ix[] }[] | null } | null };

/** The funder in a wallet's oldest transaction: the source of a system transfer (or account creation) into it. */
export function funderIn(tx: ParsedTx | null, wallet: string): string | null {
  if (!tx || tx.meta?.err) return null;
  const all = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions)];
  for (const i of all) {
    const p = i.parsed;
    if (i.program !== "system" || !p?.info?.source || p.info.source === wallet) continue;
    if ((p.type === "transfer" || p.type === "transferWithSeed") && p.info.destination === wallet) return p.info.source;
    if (p.type === "createAccount" && p.info.newAccount === wallet) return p.info.source;
  }
  return null;
}

/** One wallet's funder from the chain; null when the wallet is not fresh or its first transaction funds it from nowhere. */
export async function lookupFunder(pool: RpcPool, wallet: string): Promise<{ funder: string | null; signature: string | null }> {
  const sigs = await pool.call<{ signature: string }[]>("getSignaturesForAddress", [wallet, { limit: PAGE, commitment: "confirmed" }]);
  const oldest = sigs.length < PAGE ? sigs.at(-1) : undefined;
  if (!oldest) return { funder: null, signature: null };
  const tx = await pool.call<ParsedTx | null>("getTransaction", [oldest.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]);
  return { funder: funderIn(tx, wallet), signature: oldest.signature };
}

/** Look up the funders of early-slot buyers that have none yet, at most FUNDER_LOOKUPS_PER_RUN per run. */
export async function linkFunders(sql: Sql, pool: RpcPool, now: string) {
  const want = await sql`select distinct w.wallet from (select wallet, early_slot from idx.wallet_coin union all select wallet, early_slot from idx.wallet_coin_all) w
    where w.early_slot and not exists (select 1 from idx.funder f where f.wallet = w.wallet) order by w.wallet limit ${env.int("FUNDER_LOOKUPS_PER_RUN")}`;
  let linked = 0;
  for (const { wallet } of want) {
    const r = await lookupFunder(pool, wallet as string);
    await sql`insert into idx.funder (wallet, funder, signature, at) values (${wallet as string}, ${r.funder}, ${r.signature}, ${now}) on conflict (wallet) do nothing`;
    if (r.funder) linked++;
  }
  return { looked: want.length, linked };
}
