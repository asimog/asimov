// A mocked Solana for the hands and treasury suites (docs/14): enough of Pump to buy, sell, close accounts, collect fees
// and move SOL, with real serialized transactions in and real signatures checked. No network. The numbers are exact
// integers so suites can compare to the lamport. Failure hooks let a suite drop a confirmation or drift a balance.
import { PublicKey, type VersionedTransaction } from "../../../services/signer/src/web3.ts";
import { bs58 } from "../../../services/signer/src/signer.ts";
import { PROGRAMS } from "../../../services/signer/src/policy.ts";
import { type Builder, tokenAccountOf } from "../../../services/core/src/hands/builder.ts";
import type { Chain, Parsed, Sim } from "../../../services/core/src/hands/chain.ts";
import { budget, build, createAta, disc, pumpBuy, pumpNamed, pumpSell } from "./txs.ts";
import { parse } from "../../../services/signer/src/policy.ts";

export const ATA_RENT = 2_039_280;
const BASE_FEE = 5000;
type Applied = { ok: boolean; err: string | null; lamports: Map<string, number>; tokens: { wallet: string; mint: string; delta: number; post: number; created: boolean }[]; fee: number; memos: string[]; payer: string };

export class MockChain implements Chain {
  lamports = new Map<string, number>();
  raw = new Map<string, number>(); // `${wallet}|${mint}` -> raw token units (6 decimals); a key exists while the token account exists
  prices = new Map<string, number>(); // SOL per whole token
  creatorVault = 0; // pending creator fees in lamports
  slot = 100;
  landed: { sig: string; applied: Applied; slot: number }[] = [];
  confirmDrops = 0; // the next N confirm calls return null (timeout)
  confirmThrowsFor: string | null = null; // confirm throws once for a transaction whose memo contains this
  sends = 0;
  private bh = 0;
  private seq = 0;

  set(wallet: string, lamports: number) {
    this.lamports.set(wallet, lamports);
  }
  drift(wallet: string, by: number) {
    this.lamports.set(wallet, (this.lamports.get(wallet) ?? 0) + by);
  }
  tokensOf(wallet: string, mint: string) {
    return this.raw.get(`${wallet}|${mint}`);
  }

  async balance(w: string) {
    return this.lamports.get(w) ?? 0;
  }
  async blockhash() {
    return new PublicKey(Buffer.from(`bh${++this.bh}`.padEnd(32, "x"))).toBase58();
  }
  async mintProgram() {
    return PROGRAMS.token;
  }

  private apply(tx: VersionedTransaction, commit: boolean): Applied {
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    const L = new Map(this.lamports);
    const R = new Map(this.raw);
    const delta = new Map<string, number>();
    const tokens: Applied["tokens"] = [];
    const add = (w: string, n: number) => {
      L.set(w, (L.get(w) ?? 0) + n);
      delta.set(w, (delta.get(w) ?? 0) + n);
    };
    const payer = keys[0]!;
    let err: string | null = null;
    if (!tx.signatures[0] || tx.signatures[0].every((b) => b === 0)) err = "SignatureVerificationFailure";
    let price = 0;
    let limit = 200_000;
    const memos: string[] = [];
    const made = new Set<string>();
    const token = (w: string, m: string, d: number, created: boolean) => {
      const k = `${w}|${m}`;
      const t = tokens.find((x) => x.wallet === w && x.mint === m);
      if (t) {
        t.delta += d / 1e6;
        t.post = (R.get(k) ?? 0) / 1e6;
        t.created ||= created;
      } else tokens.push({ wallet: w, mint: m, delta: d / 1e6, post: (R.get(k) ?? 0) / 1e6, created });
    };
    for (const ix of tx.message.compiledInstructions) {
      if (err) break;
      const prog = keys[ix.programIdIndex]!;
      const acc = ix.accountKeyIndexes.map((i) => keys[i]!);
      const data = Buffer.from(ix.data);
      if (prog === PROGRAMS.budget) {
        if (data[0] === 2) limit = data.readUInt32LE(1);
        else price = Number(data.readBigUInt64LE(1));
      } else if (prog === PROGRAMS.memo) memos.push(data.toString("utf8"));
      else if (prog === PROGRAMS.ata) {
        const [, , owner, mint] = acc as [string, string, string, string];
        if (!R.has(`${owner}|${mint}`)) {
          R.set(`${owner}|${mint}`, 0);
          add(payer, -ATA_RENT);
          made.add(`${owner}|${mint}`);
          token(owner, mint, 0, true);
        }
      } else if (prog === PROGRAMS.system) {
        const n = Number(data.readBigUInt64LE(4));
        if ((L.get(acc[0]!) ?? 0) < n) err = "InsufficientFunds";
        else {
          add(acc[0]!, -n);
          add(acc[1]!, n);
        }
      } else if (prog === PROGRAMS.pump && data.subarray(0, 8).equals(disc("buy"))) {
        const [user, mint] = acc as [string, string];
        const amount = Number(data.readBigUInt64LE(8));
        const maxSol = Number(data.readBigUInt64LE(16));
        const cost = Math.round((amount / 1e6) * (this.prices.get(mint) ?? 0) * 1e9);
        const total = cost + Math.round(cost * 0.01);
        if (!R.has(`${user}|${mint}`)) err = "AccountNotInitialized";
        else if (total > maxSol) err = "SlippageExceeded";
        else {
          add(user, -total);
          R.set(`${user}|${mint}`, R.get(`${user}|${mint}`)! + amount);
          token(user, mint, amount, made.has(`${user}|${mint}`));
        }
      } else if (prog === PROGRAMS.pump && data.subarray(0, 8).equals(disc("sell"))) {
        const [user, mint] = acc as [string, string];
        const amount = Number(data.readBigUInt64LE(8));
        const minSol = Number(data.readBigUInt64LE(16));
        const got = Math.round((amount / 1e6) * (this.prices.get(mint) ?? 0) * 1e9 * 0.99);
        if ((R.get(`${user}|${mint}`) ?? 0) < amount) err = "InsufficientTokens";
        else if (got < minSol) err = "SlippageExceeded";
        else {
          add(user, got);
          R.set(`${user}|${mint}`, R.get(`${user}|${mint}`)! - amount);
          token(user, mint, -amount, false);
        }
      } else if (prog === PROGRAMS.pump && data.subarray(0, 8).equals(disc("collect_creator_fee"))) {
        add(acc[0]!, this.creatorVault);
        if (commit) this.creatorVault = 0;
      } else if (prog === PROGRAMS.token && data[0] === 9) {
        const hit = [...R.keys()].find((k) => tokenAccountOf(k.split("|")[0]!, k.split("|")[1]!, PROGRAMS.token) === acc[0]);
        if (!hit) err = "AccountNotFound";
        else if (R.get(hit)! !== 0) err = "NonZeroTokenBalance";
        else {
          R.delete(hit);
          add(acc[1]!, ATA_RENT);
        }
      } else err = `UnknownInstruction:${prog.slice(0, 6)}`;
    }
    const fee = BASE_FEE + Math.ceil((price * limit) / 1e6);
    add(payer, -fee);
    if (!err && (L.get(payer) ?? 0) < 0) err = "InsufficientFundsForFee";
    if (err) return { ok: false, err, lamports: new Map([[payer, -fee]]), tokens: [], fee, memos, payer };
    if (commit) {
      this.lamports = L;
      this.raw = R;
    }
    return { ok: true, err: null, lamports: delta, tokens, fee, memos, payer };
  }

  async simulate(b64: string, wallet: string): Promise<Sim> {
    const tx = parse(b64);
    if (!tx) return { err: "BadTransaction", sol_delta: 0 };
    const a = this.apply(tx, false);
    return { err: a.err, sol_delta: a.lamports.get(wallet) ?? 0 };
  }
  async send(b64: string) {
    const tx = parse(b64);
    if (!tx) throw new Error("bad transaction");
    const sig = bs58(tx.signatures[0]!);
    if (this.landed.some((l) => l.sig === sig)) throw new Error("AlreadyProcessed");
    this.sends++;
    const a = this.apply(tx, true);
    this.landed.push({ sig, applied: a, slot: ++this.slot });
    return sig;
  }
  async confirm(sig: string): Promise<Parsed | null> {
    const l = this.landed.find((x) => x.sig === sig);
    if (!l) return null;
    if (this.confirmDrops > 0) {
      this.confirmDrops--;
      return null;
    }
    if (this.confirmThrowsFor && l.applied.memos.some((m) => m.includes(this.confirmThrowsFor!))) {
      this.confirmThrowsFor = null;
      throw new Error("rpc dropped the connection");
    }
    const a = l.applied;
    return {
      sig, slot: l.slot, err: a.err, fee: a.fee, lamports: Object.fromEntries(a.lamports),
      tokens: a.tokens.map((t) => ({ account: tokenAccountOf(t.wallet, t.mint, PROGRAMS.token), owner: t.wallet, mint: t.mint, delta: t.delta, post: t.post, created: t.created, rent_lamports: t.created ? ATA_RENT : 0 })),
    };
  }
  async findByMemo(wallet: string, memo: string) {
    return [...this.landed].reverse().find((l) => l.applied.payer === wallet && l.applied.memos.some((m) => m.includes(memo)))?.sig ?? null;
  }
  memosOf(sig: string) {
    return this.landed.find((l) => l.sig === sig)?.applied.memos ?? [];
  }
  next() {
    return ++this.seq;
  }
}

/** Stands in for fun-block: builds the same shapes with the mock's price. */
export class FakeBuilder implements Builder {
  constructor(private chain: MockChain) {}
  async swap(a: { side: "buy" | "sell"; mint: string; wallet: string; amount: string; slippagePct: number }) {
    const price = this.chain.prices.get(a.mint) ?? 0;
    const bh = await this.chain.blockhash();
    void bh;
    const ixs = [...budget(200_000, 100_000)];
    if (a.side === "buy") {
      const spend = Number(a.amount);
      const tokens = Math.floor(((spend * 0.99) / 1e9 / price) * 1e6);
      if (!this.chain.raw.has(`${a.wallet}|${a.mint}`)) ixs.push(createAta(a.wallet, a.wallet, a.mint));
      ixs.push(pumpBuy(a.wallet, a.mint, tokens, Math.floor(spend * (1 + a.slippagePct / 100))));
    } else ixs.push(pumpSell(a.wallet, a.mint, Number(a.amount), 0));
    return { tx: build(a.wallet, ixs, [], await this.chain.blockhash()).b64, route: "curve" as const };
  }
  async collectFees(a: { mint: string; user: string }) {
    return { tx: build(a.user, [pumpNamed(PROGRAMS.pump, "collect_creator_fee", a.user)], [], await this.chain.blockhash()).b64 };
  }
}
