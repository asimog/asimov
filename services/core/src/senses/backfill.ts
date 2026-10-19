// Backfill (S2.7, docs/PIPELINE.md): when a coin enters the watched set, read its recent trades from RPC and write the ones
// the Tape lacks as `trade.curve` with source `rpc`. Pump `TradeEvent`s come from `Program data:` log lines.
// `event_time` is when the trade happened; `seen_time` is when we learned it, so nothing leaks back.

import type { Trade } from "@asimog/contracts";
import { PublicKey } from "@solana/web3.js";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { RpcPool } from "../lib/rpc.ts";
import type { Tape } from "../tape/tape.ts";
import { tradeKey } from "./chain-reader.ts";

// No pump SDK here: its ESM build imports the agent-payments SDK and fails to load. We need only the curve address and
// the event's fixed first fields (pump IDL: mint, sol_amount, token_amount, is_buy, user, timestamp, virtual reserves).
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const DISC = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]); // anchor discriminator of TradeEvent
const PREFIX = "Program data: ";

export const bondingCurvePda = (mint: string) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0];

/** The fields we use, at their byte offsets after the 8-byte discriminator. Throws on a short event. */
export function decodeTradeEvent(d: Buffer) {
  if (d.length < 113) throw new Error(`trade event too short: ${d.length}`);
  const u64 = (o: number) => Number(d.readBigUInt64LE(o));
  return {
    mint: new PublicKey(d.subarray(8, 40)).toBase58(),
    lamports: u64(40),
    rawTokens: u64(48),
    isBuy: d[56] === 1,
    user: new PublicKey(d.subarray(57, 89)).toBase58(),
    timestamp: Number(d.readBigInt64LE(89)),
    vSol: u64(97) / 1e9,
    vTok: u64(105) / 1e6,
  };
}

/** Every pump TradeEvent for `mint` in a transaction's logs, in log order. Pure. */
export function tradesFromLogs(mint: string, sig: string, slot: number, logs: string[]): Trade[] {
  const out: Trade[] = [];
  for (const line of logs) {
    if (!line.startsWith(PREFIX)) continue;
    const data = Buffer.from(line.slice(PREFIX.length), "base64");
    if (data.length < 8 || !data.subarray(0, 8).equals(DISC)) continue;
    const ev = decodeTradeEvent(data);
    if (ev.mint !== mint) continue;
    out.push({
      mint,
      tx: sig,
      slot_index_id: `${slot}:${out.length}`,
      ts: new Date(ev.timestamp * 1000).toISOString(),
      side: ev.isBuy ? "buy" : "sell",
      wallet: ev.user,
      sol: ev.lamports / 1e9,
      usd: null,
      tokens: ev.rawTokens / 1e6,
      price_sol: ev.vTok > 0 ? ev.vSol / ev.vTok : null,
      price_usd: null,
      mcap_usd: null,
      on_curve: true,
      program: "pump",
    });
  }
  return out;
}

export class Backfill {
  private queue: string[] = [];
  private queued = new Set<string>();
  private stopped = false;
  private hour = { bucket: -1, n: 0 };
  private readonly p = {
    sigs: env.int("RPC_BACKFILL_SIGS"),
    perHour: env.int("RPC_BACKFILL_TX_PER_HOUR"),
  };
  stats = { coins: 0, calls: 0, trades: 0, overlap: 0, skipped_null: 0, decode_errors: 0, queued: 0 };
  /** The Scout's post-promotion recheck: the trades this run read for a coin (docs/PIPELINE.md). */
  onRead: ((mint: string, trades: Trade[]) => void) | null = null;
  /** The pool paces each endpoint and falls back between them (docs/OPS.md); this class only counts its hourly budget. */
  constructor(private tape: Tape, private sql: Sql, private pool: RpcPool) {}

  start() {
    void this.loop();
  }

  stop() {
    this.stopped = true;
  }

  enqueue(mint: string) {
    if (this.queued.has(mint)) return;
    this.queued.add(mint);
    this.queue.push(mint);
    this.stats.queued = this.queue.length;
  }

  /** The hourly count (RPC_BACKFILL_TX_PER_HOUR). */
  private spend(n = 1) {
    const b = Math.floor(this.tape.clock.now() / 3_600_000);
    if (b !== this.hour.bucket) this.hour = { bucket: b, n: 0 };
    this.hour.n += n;
    this.stats.calls += n;
  }

  /** Read one coin now (the suite drives this; the loop calls it too). */
  async fill(mint: string) {
    await this.coin(mint);
  }

  private budgetLeft() {
    const b = Math.floor(this.tape.clock.now() / 3_600_000);
    return b !== this.hour.bucket ? this.p.perHour : this.p.perHour - this.hour.n;
  }

  private async loop() {
    while (!this.stopped) {
      const mint = this.queue.shift();
      this.stats.queued = this.queue.length;
      if (!mint) {
        await sleep(500);
        continue;
      }
      try {
        await this.coin(mint);
      } catch (err) {
        log.warn("backfill", { mint, err: String(err) });
      }
    }
  }

  private async coin(mint: string) {
    const started = this.tape.clock.iso();
    const calls0 = this.stats.calls;
    this.spend(); // getSignaturesForAddress
    const sigs = await this.pool.call<{ signature: string; slot: number; err: unknown; blockTime: number | null }[]>("getSignaturesForAddress", [
      bondingCurvePda(mint).toBase58(),
      { limit: this.p.sigs, commitment: "confirmed" },
    ]);
    // our own rollups already folded every trade up to idx.coin.last_at; RPC is asked only for the gap after it
    const [c] = await this.sql`select last_at from idx.coin where mint = ${mint}`;
    const cutoff = c?.last_at ? (c.last_at as Date).getTime() : null;
    const known = new Set((await this.sql`select body->>'tx' tx from tape.events where subject = ${mint} and topic in ('trade.curve', 'trade.amm')`).map((r) => r.tx as string));
    const todo = sigs.filter((s) => !s.err && !known.has(s.signature) && (cutoff === null || (s.blockTime ?? 0) * 1000 > cutoff)); // newest first: the minutes before the watch matter most
    this.stats.overlap += sigs.length - todo.length;
    let unread: { from: string; to: string } | null = null;
    const budget = Math.max(0, this.budgetLeft());
    const batch = todo.slice(0, budget);
    if (batch.length < todo.length) {
      const t = (x: { blockTime: number | null } | undefined) => (x?.blockTime ? new Date(x.blockTime * 1000).toISOString() : started);
      unread = { from: t(todo.at(-1)), to: t(batch.at(-1) ?? todo[0]) };
    }
    const read: Trade[] = [];
    if (batch.length) {
      // every healthy provider takes a share, in parallel, under its own rate and budget
      this.spend(batch.length);
      const txs = await this.pool.fanOut<{ meta: { logMessages: string[] | null } | null } | null>(
        "getTransaction",
        batch.map((s) => [s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 }]),
      );
      for (const [i, s] of batch.entries()) {
        let tx = txs[i] ?? null;
        if (!tx) {
          await sleep(2000);
          this.spend();
          tx = await this.pool.call("getTransaction", [s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 }]);
        }
        if (!tx?.meta?.logMessages) {
          this.stats.skipped_null++;
          continue;
        }
        let trades: Trade[];
        try {
          trades = tradesFromLogs(mint, s.signature, s.slot, tx.meta.logMessages);
        } catch {
          this.stats.decode_errors++;
          continue;
        }
        for (const t of trades) {
          this.tape.emit("trade.curve", t, { source: "rpc", subject: mint, eventTime: t.ts, dedupe: tradeKey(t) });
          this.stats.trades++;
        }
        read.push(...trades);
      }
    }
    if (read.length) this.onRead?.(mint, read);
    this.stats.coins++;
    this.tape.emit("budget.spent", { analyzer: "backfill", units: "rpc", amount: this.stats.calls - calls0, job_event_id: null }, { source: "rpc", subject: mint });
    if (unread) this.tape.emit("system.gap", { source: "rpc", scope: mint, ...unread, reason: "rpc backfill hour budget spent" }, { source: "rpc", subject: mint });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
