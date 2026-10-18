// Signer policy (docs/09): pure checks over a transaction. A request is signed only if the whole transaction fits
// the endpoint's shape. Everything unknown is refused with a reason code. No network, no keys, no clock here.
import crypto from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

export const PROGRAMS = {
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  amm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  fees: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  budget: "ComputeBudget111111111111111111111111111111",
  ata: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  system: "11111111111111111111111111111111",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token22: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  memo: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
} as const;
export const NATIVE_MINT = "So11111111111111111111111111111111111111112";

const disc = (name: string) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex");
/** instruction name -> byte offset of the u64 that caps the SOL it may spend (null: spends nothing) */
type Spec = Record<string, number | null>;
const PUMP: Spec = { buy: 16, buy_v2: 16, buy_v3: 16, buy_exact_sol_in: 8, buy_exact_quote_in_v2: 8, buy_exact_quote_in_v3: 8, sell: null, sell_v2: null, sell_v3: null, extend_account: null, init_user_volume_accumulator: null, sync_user_volume_accumulator: null };
const AMM: Spec = { buy: 16, buy_v2: 16, buy_exact_quote_in_v2: 8, sell: null, sell_v2: null, extend_account: null, init_user_volume_accumulator: null, sync_user_volume_accumulator: null };
const FEES: Spec = { get_fees: null };
const COLLECT_PUMP: Spec = { collect_creator_fee: null, collect_creator_fee_v2: null, distribute_creator_fees: null, distribute_creator_fees_v2: null, extend_account: null };
const COLLECT_AMM: Spec = { collect_coin_creator_fee: null, transfer_creator_fees_to_pump_v2: null, extend_account: null };
const table = (s: Spec) => new Map(Object.entries(s).map(([n, off]) => [disc(n), { name: n, off }]));
const T = { pump: table(PUMP), amm: table(AMM), fees: table(FEES), collectPump: table(COLLECT_PUMP), collectAmm: table(COLLECT_AMM) };

export type Verdict = { ok: true; detail?: Record<string, unknown> } | { ok: false; reason: string; detail?: string };
const no = (reason: string, detail?: string): Verdict => ({ ok: false, reason, detail });

export type Wallets = { trade?: string; creator?: string; agent?: string; operator?: string };
export type Rules = { feeRecipients: string[]; maxPriorityLamports: number; maxOrderLamports: number; coinMint?: string };
export type Ctx = { killed?: boolean; max_lamports?: number; order_id?: string; total_lamports?: number; agent_room_lamports?: number; mint?: string };

export function parse(b64: string): VersionedTransaction | null {
  try {
    return VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  } catch {
    return null;
  }
}

type Ix = { program: string; accounts: (string | null)[]; data: Buffer };
function instructions(tx: VersionedTransaction): { keys: string[]; ixs: Ix[] } {
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const ixs = tx.message.compiledInstructions.map((i) => ({
    program: keys[i.programIdIndex] ?? "?",
    accounts: i.accountKeyIndexes.map((x) => keys[x] ?? null), // null: an account from a lookup table
    data: Buffer.from(i.data),
  }));
  return { keys, ixs };
}

const ata = (owner: string, mint: string) => PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(PROGRAMS.token).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(PROGRAMS.ata))[0].toBase58();

/** shared pass: one signer, who is the fee payer; every program on the endpoint's list; compute budget within the cap */
function walk(tx: VersionedTransaction, who: string, allowed: string[], rules: Rules, each: (ix: Ix) => Verdict | null): Verdict {
  const { keys, ixs } = instructions(tx);
  if (keys[0] !== who) return no("wrong_signer", "fee payer is not the endpoint wallet");
  if (tx.message.header.numRequiredSignatures !== 1) return no("extra_signers", "transaction needs more than one signature");
  let price = 0;
  let limit: number | null = null;
  for (const ix of ixs) {
    if (!allowed.includes(ix.program)) return no("program_not_allowed", ix.program);
    if (ix.program === PROGRAMS.budget) {
      if (ix.data[0] === 2) limit = ix.data.readUInt32LE(1);
      else if (ix.data[0] === 3) price = Number(ix.data.readBigUInt64LE(1));
      else return no("budget_instruction", `tag ${ix.data[0]}`);
      continue;
    }
    const v = each(ix);
    if (v && !v.ok) return v;
  }
  const priority = Math.ceil((price * (limit ?? 1_400_000)) / 1e6);
  if (priority > rules.maxPriorityLamports) return no("priority_fee_too_high", `${priority} lamports`);
  return { ok: true, detail: { priority_lamports: priority } };
}

const tokenIx = (ix: Ix, who: string): Verdict | null => {
  const tag = ix.data[0];
  if (tag === 17 || tag === 18 || tag === 21) return null; // SyncNative, InitializeAccount3, InitializeImmutableOwner
  if (tag === 9) return ix.accounts[1] === who && ix.accounts[2] === who ? null : no("close_destination", "rent must return to the wallet");
  return no("token_instruction", `tag ${tag}`);
};
const ataIx = (ix: Ix, who: string): Verdict | null => {
  if (ix.data.length > 1 || (ix.data[0] ?? 0) > 1) return no("ata_instruction", "create only");
  return ix.accounts[0] === who && ix.accounts[2] === who ? null : no("ata_owner", "token accounts are created for the wallet only");
};
const sysTransfer = (ix: Ix): { from: string | null; to: string | null; lamports: number } | null =>
  ix.data.length === 12 && ix.data.readUInt32LE(0) === 2 ? { from: ix.accounts[0] ?? null, to: ix.accounts[1] ?? null, lamports: Number(ix.data.readBigUInt64LE(4)) } : null;

function named(ix: Ix, t: Map<string, { name: string; off: number | null }>): { name: string; off: number | null } | Verdict {
  const hit = t.get(ix.data.subarray(0, 8).toString("hex"));
  return hit ?? no("instruction_not_allowed", `${ix.program.slice(0, 6)} ${ix.data.subarray(0, 8).toString("hex")}`);
}
const isVerdict = (x: unknown): x is Verdict => typeof x === "object" && x !== null && "ok" in x;

export function checkSwap(tx: VersionedTransaction, w: Wallets, ctx: Ctx, rules: Rules): Verdict {
  if (!w.trade) return no("endpoint_not_enabled", "no trade key");
  const cap = Math.min(ctx.max_lamports ?? 0, rules.maxOrderLamports);
  if (!(cap > 0)) return no("no_cap", "request carries no spend cap");
  const allowed = [PROGRAMS.pump, PROGRAMS.amm, PROGRAMS.fees, PROGRAMS.budget, PROGRAMS.ata, PROGRAMS.system, PROGRAMS.token, PROGRAMS.token22, PROGRAMS.memo];
  const dests = new Set([w.trade, ata(w.trade, NATIVE_MINT), ...rules.feeRecipients]);
  let spend = 0;
  let buys = 0;
  let memo = false;
  const v = walk(tx, w.trade, allowed, rules, (ix) => {
    if (ix.program === PROGRAMS.system) {
      const t = sysTransfer(ix);
      if (!t) return no("system_instruction", "transfer only");
      if (t.from !== w.trade) return no("transfer_source", "transfers may only leave the trade wallet");
      if (!t.to || !dests.has(t.to)) return no("transfer_destination", t.to ?? "lookup table");
      if (rules.feeRecipients.includes(t.to)) spend += t.lamports; // a wrap into our own wSOL account is counted by the buy's cap
    } else if (ix.program === PROGRAMS.token || ix.program === PROGRAMS.token22) return tokenIx(ix, w.trade!);
    else if (ix.program === PROGRAMS.ata) return ataIx(ix, w.trade!);
    else if (ix.program === PROGRAMS.memo) {
      if (!ix.data.toString("utf8").startsWith("asimog:")) return no("memo_prefix", "memo must start with asimog:");
      memo = true;
    } else {
      const t = ix.program === PROGRAMS.pump ? T.pump : ix.program === PROGRAMS.amm ? T.amm : T.fees;
      const n = named(ix, t);
      if (isVerdict(n)) return n;
      if (n.name.startsWith("buy")) buys++;
      if (n.off != null) spend += Number(ix.data.readBigUInt64LE(n.off));
    }
    return null;
  });
  if (!v.ok) return v;
  if (ctx.killed && buys > 0) return no("kill_switch", "the kill switch allows exits only");
  if (spend > cap) return no("over_cap", `${spend} lamports over ${cap}`);
  if (ctx.order_id && !memo) return no("memo_missing", "order memo is required");
  return { ok: true, detail: { spend_lamports: spend } };
}

export function checkCollectFees(tx: VersionedTransaction, w: Wallets, ctx: Ctx, rules: Rules): Verdict {
  if (!w.creator) return no("endpoint_not_enabled", "no creator key");
  if (!rules.coinMint) return no("endpoint_not_enabled", "COIN_MINT is not set");
  if (ctx.mint !== rules.coinMint) return no("wrong_mint", "only our coin");
  const allowed = [PROGRAMS.pump, PROGRAMS.amm, PROGRAMS.fees, PROGRAMS.budget, PROGRAMS.ata, PROGRAMS.system, PROGRAMS.token, PROGRAMS.token22, PROGRAMS.memo];
  const dests = new Set([w.creator, ata(w.creator, NATIVE_MINT)]);
  return walk(tx, w.creator, allowed, rules, (ix) => {
    if (ix.program === PROGRAMS.memo) return ix.data.toString("utf8").startsWith("asimog:") ? null : no("memo_prefix", "memo must start with asimog:");
    if (ix.program === PROGRAMS.system) {
      const t = sysTransfer(ix);
      if (!t) return no("system_instruction", "transfer only");
      return t.from === w.creator && t.to && dests.has(t.to) ? null : no("transfer_destination", "collect pays the creator wallet only");
    }
    if (ix.program === PROGRAMS.token || ix.program === PROGRAMS.token22) return tokenIx(ix, w.creator!);
    if (ix.program === PROGRAMS.ata) return ataIx(ix, w.creator!);
    const n = named(ix, ix.program === PROGRAMS.pump ? T.collectPump : ix.program === PROGRAMS.amm ? T.collectAmm : T.fees);
    return isVerdict(n) ? n : null;
  });
}

export function checkCloseAccount(tx: VersionedTransaction, w: Wallets, rules: Rules): Verdict {
  if (!w.trade) return no("endpoint_not_enabled", "no trade key");
  let closes = 0;
  const v = walk(tx, w.trade, [PROGRAMS.budget, PROGRAMS.token, PROGRAMS.token22, PROGRAMS.memo], rules, (ix) => {
    if (ix.program === PROGRAMS.memo) return ix.data.toString("utf8").startsWith("asimog:") ? null : no("memo_prefix", "memo must start with asimog:");
    if (ix.data[0] !== 9) return no("token_instruction", "close only");
    closes++;
    return tokenIx(ix, w.trade!);
  });
  if (!v.ok) return v;
  return closes > 0 ? v : no("nothing_to_close", "no CloseAccount instruction");
}

export function checkMemo(tx: VersionedTransaction, w: Wallets, rules: Rules): Verdict {
  if (!w.agent) return no("endpoint_not_enabled", "no agent key");
  let memos = 0;
  const v = walk(tx, w.agent, [PROGRAMS.budget, PROGRAMS.memo], rules, (ix) => {
    memos++;
    return /^asimog:proof:[0-9a-f]{64}$/.test(ix.data.toString("utf8")) ? null : no("memo_format", "asimog:proof:<sha256>");
  });
  if (!v.ok) return v;
  return memos === 1 ? v : no("memo_count", "exactly one memo");
}

/** Sweep (docs/10): 50% (rounded down) to the trade wallet; the rest to the agent wallet up to its room, exactly; the remainder to the operator. */
export function checkSweepSplit(tx: VersionedTransaction, w: Wallets, ctx: Ctx, rules: Rules): Verdict {
  if (!w.creator || !w.trade || !w.agent || !w.operator) return no("endpoint_not_enabled", "wallets are not all set");
  const total = ctx.total_lamports ?? 0;
  if (!(total > 0)) return no("no_total", "request carries no total");
  const got = new Map<string, number>();
  const v = walk(tx, w.creator, [PROGRAMS.budget, PROGRAMS.system, PROGRAMS.memo], rules, (ix) => {
    if (ix.program === PROGRAMS.memo) return ix.data.toString("utf8").startsWith("asimog:") ? null : no("memo_prefix", "memo must start with asimog:");
    const t = sysTransfer(ix);
    if (!t || t.from !== w.creator || !t.to) return no("system_instruction", "transfers from the creator wallet only");
    if (![w.trade, w.agent, w.operator].includes(t.to)) return no("transfer_destination", "trade, agent or operator only");
    got.set(t.to, (got.get(t.to) ?? 0) + t.lamports);
    return null;
  });
  if (!v.ok) return v;
  const toTrade = got.get(w.trade) ?? 0;
  const toAgent = got.get(w.agent) ?? 0;
  const toOp = got.get(w.operator) ?? 0;
  if (toTrade !== Math.floor(total / 2)) return no("split_trade", `${toTrade} is not half of ${total}`);
  const rest = total - toTrade;
  const wantAgent = Math.min(rest, Math.max(0, ctx.agent_room_lamports ?? 0));
  if (toAgent !== wantAgent) return no("split_agent", `${toAgent} to the agent wallet, want ${wantAgent} (its room up to the runway target)`);
  if (toTrade + toAgent + toOp !== total) return no("split_total", "legs do not add up to the total");
  return { ok: true, detail: { to_trade: toTrade, to_agent: toAgent, to_operator: toOp } };
}
