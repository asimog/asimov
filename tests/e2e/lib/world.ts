// The test world for hands and treasury suites: a fresh database, a mocked chain, test keypairs made in memory, a real
// Signer (in process), and the real consumers wired the way runtime.ts wires them in live mode.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { putSignal } from "../../../services/core/src/board/board.ts";
import { orderGate } from "../../../services/core/src/hands/order-gate.ts";
import type { SignCtx, SignerClient, SignReply } from "../../../services/core/src/hands/signer-client.ts";
import { trader } from "../../../services/core/src/hands/trader.ts";
import { type Clock, liveClock } from "../../../services/core/src/lib/clock.ts";
import type { Sql } from "../../../services/core/src/lib/db.ts";
import { type Consumer, drain, type Tx } from "../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../services/core/src/tape/tape.ts";
import { books, recordDeposit } from "../../../services/core/src/treasury/books.ts";
import { kill } from "../../../services/core/src/treasury/kill.ts";
import { Signer } from "../../../services/signer/src/signer.ts";
import { freshDb } from "./freshdb.ts";
import { FakeBuilder, MockChain } from "./mockchain.ts";
import { type Keys, newKeys } from "./txs.ts";

export const SOL = 1e9;

/** the Signer in process, called the way HttpSigner calls it */
export class LocalSigner implements SignerClient {
  constructor(private s: Signer, private token: string) {}
  async sign(endpoint: string, tx: string, ctx: SignCtx = {}): Promise<SignReply> {
    const r = await this.s.handle(endpoint, this.token, { tx, ctx });
    return r.body.ok ? { ok: true, signed: r.body.signed!, signature: r.body.signature! } : { ok: false, reason: r.body.reason ?? "?", detail: r.body.detail };
  }
}

/**
 * The live leg as runtime.ts wires it: the real gate, Trader, books and kill, on the mock chain with an in-process Signer.
 * Each consumer gets its own clock stream, as buildConsumers gives the paper side.
 */
export function liveLeg(sql: Sql, tape: Tape, o: { keys: Keys; dir: string; live?: boolean; strategies: () => Set<string>; confirmMs?: number }) {
  const { keys } = o;
  const wallets = { trade: keys.trade.publicKey.toBase58(), creator: keys.creator.publicKey.toBase58(), agent: keys.agent.publicKey.toBase58(), operator: keys.operator };
  const killFile = path.join(o.dir, "KILL");
  const clock = tape.clock;
  const signer = new Signer({
    keys: { trade: keys.trade, creator: keys.creator, agent: keys.agent, operator: keys.operator },
    tokens: { "cap:sign.swap": "swap-secret", "cap:sign.treasury": "treasury-secret" },
    rules: { feeRecipients: [], maxPriorityLamports: 100_000, maxOrderLamports: 0.05 * SOL, coinMint: keys.mint },
    auditFile: path.join(o.dir, "audit.jsonl"), killFile, ratePerMin: 10_000, now: () => clock.now(),
  });
  const chain = new MockChain();
  const builder = new FakeBuilder(chain);
  const swapSigner = new LocalSigner(signer, "swap-secret");
  const treasurySigner = new LocalSigner(signer, "treasury-secret");
  const own = (name: string) => tape.for(clock.fork(name));
  const gt = own("order.gate");
  const gate = orderGate(gt, gt.clock, wallets, { live: () => o.live ?? true, strategies: o.strategies });
  const tt = own("trader");
  const tr = trader({ sql, tape: tt, clock: tt.clock, chain, builder, swapSigner, wallet: wallets.trade, confirmMs: o.confirmMs ?? 50 });
  const bk = books(own("books"), wallets);
  const kl = kill(own("kill"), killFile);
  const consumers: Consumer[] = [bk, kl, gate, tr];
  return { wallets, killFile, signer, chain, builder, swapSigner, treasurySigner, gate, trader: tr, books: bk, kill: kl, consumers };
}

export async function world(tag: string, o: { live?: boolean; strategies?: string[]; confirmMs?: number } = {}) {
  const db = await freshDb(tag);
  const clock: Clock = liveClock("live");
  const tape = new Tape(db.sql, clock);
  const keys = newKeys();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `world-${tag}-`));
  const leg = liveLeg(db.sql, tape, { keys, dir, live: o.live, strategies: () => new Set(o.strategies ?? ["sr_live"]), confirmMs: o.confirmMs });
  const { wallets, killFile, signer, chain, builder, swapSigner, treasurySigner, gate, trader: tr, books: bk, kill: kl, consumers } = leg;
  chain.prices.set(keys.mint, 4e-8);

  /** drain every consumer until nothing moves; a consumer that throws (confirm timeout) is reported, not hidden */
  async function settle(rounds = 12): Promise<string[]> {
    const errors: string[] = [];
    for (let i = 0; i < rounds; i++) {
      await tape.flush();
      let moved = 0;
      for (const c of consumers) {
        try {
          moved += await drain(db.sql, c);
        } catch (err) {
          errors.push(`${c.name}: ${String(err).slice(0, 120)}`);
        }
      }
      moved += await tr.retry();
      if (!moved) break;
    }
    return errors;
  }

  async function fund(wallet: string, sol: number, sig = `fund-${wallet.slice(0, 6)}`) {
    chain.set(wallet, Math.round(sol * SOL));
    await recordDeposit(tape, wallet, Math.round(sol * SOL), sig);
  }

  /** a trade on the coin (so the gate has a fresh quote) then an intent from the live strategy */
  async function intent(side: "buy" | "sell", o2: { size_sol?: number; fraction?: number; strategy?: string; mint?: string; ghost?: boolean; risk?: false } = {}) {
    const mint = o2.mint ?? keys.mint;
    if (o2.risk !== false) // the rug checks the Index would have run: a clean coin
      await putSignal(db.sql as unknown as Tx, clock, { kind: "risk.state", subject: mint, value: { bundle_share: 0, top10_share: 0.1, creator_sold: 0 }, confidence: 0.9, validMs: 3_600_000, inputs: [], analyzer: "test" });
    const price = chain.prices.get(mint)!;
    tape.emit("trade.curve", { mint, tx: `t${chain.next()}`, slot_index_id: null, ts: clock.iso(), side: "buy", wallet: keys.stranger.publicKey.toBase58(), sol: 1, usd: null, tokens: 1e6, price_sol: price, price_usd: null, mcap_usd: null, on_curve: true, program: null }, { source: "nats", subject: mint });
    await tape.flush();
    const id = clock.id("intent");
    const strategy_id = o2.strategy ?? "sr_live";
    tape.emit("intent.created", { strategy_id, mint, side, size_sol: side === "buy" ? (o2.size_sol ?? 0.01) : null, fraction: side === "sell" ? (o2.fraction ?? 1) : null, reason: ["test"], score: 1, board: {} }, { source: "strategies", subject: id });
    if (o2.ghost !== false) // the live gate acts only on a paper fill (docs/SYSTEM.md 5.2)
      tape.emit("intent.ghost_filled", { intent_id: id, strategy_id, mint, side, sol: o2.size_sol ?? 0.01, tokens: 1, price_sol: price, fee_sol: 0, rent_sol: 0, slippage_bps: 0 }, { source: "strategies", subject: id });
    return id;
  }

  const topic = async (t: string) => (await db.sql`select id, subject, seen_time, body from tape.events where topic = ${t} order by seen_time, id`) as unknown as { id: string; subject: string | null; seen_time: Date; body: Record<string, unknown> }[];

  return { db, sql: db.sql, clock, tape, keys, wallets, dir, killFile, signer, chain, builder, swapSigner, treasurySigner, gate, trader: tr, books: bk, kill: kl, consumers, settle, fund, intent, topic, mint: keys.mint, async close() { await tape.close(); await db.done(); } };
}
export type World = Awaited<ReturnType<typeof world>>;
