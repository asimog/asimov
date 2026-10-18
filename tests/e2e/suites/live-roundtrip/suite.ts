// live-roundtrip (docs/14): 0.01 SOL buy then sell on a real coin, token account closed, rent back, books reconcile.
// SKIPPED unless the owner has set LIVE_TEST=1 and supplied keys. Needs: the Signer process running with the owner's
// trade key, TX_SEND_URL, WALLET_TRADE, SIGNER_CLIENT_TOKEN_SWAP, LIVE_TEST_MINT (a liquid coin the owner picks; this
// suite never creates a coin). It runs the real consumers through the Risk Gate. It never reads or prints a key.
import { FunBlock } from "../../../../services/core/src/hands/builder.ts";
import { RpcChain } from "../../../../services/core/src/hands/chain.ts";
import { orderGate } from "../../../../services/core/src/hands/order-gate.ts";
import { HttpSigner } from "../../../../services/core/src/hands/signer-client.ts";
import { trader } from "../../../../services/core/src/hands/trader.ts";
import { liveClock } from "../../../../services/core/src/lib/clock.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import { drain } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import { books, hourOf, reconcile, recordDeposit } from "../../../../services/core/src/treasury/books.ts";
import { kill } from "../../../../services/core/src/treasury/kill.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const NEEDED = ["TX_SEND_URL", "WALLET_TRADE", "SIGNER_CLIENT_TOKEN_SWAP", "LIVE_TEST_MINT"];

export const suite: Suite = {
  name: "live-roundtrip",
  proves: "With the owner's keys: 0.01 SOL buy and sell through the Risk Gate, Signer and chain; real fills; token account closed and rent back; books reconcile to the lamport.",
  async run() {
    const missing = NEEDED.filter((k) => !env.opt(k));
    if (process.env.LIVE_TEST !== "1" || missing.length)
      return { checks: [{ name: "skipped: needs LIVE_TEST=1 and the owner's keys", pass: true, detail: process.env.LIVE_TEST !== "1" ? "LIVE_TEST is not 1" : `missing env: ${missing.join(", ")}` }], metrics: { skipped: true } };

    const db = await freshDb("live");
    const clock = liveClock("live");
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
    try {
      const trade = env.str("WALLET_TRADE");
      const mint = env.str("LIVE_TEST_MINT");
      const chain = new RpcChain();
      const builder = new FunBlock();
      const bk = books(tape, { trade });
      const tr = trader({ sql: db.sql, tape, clock, chain, builder, swapSigner: new HttpSigner(env.str("SIGNER_CLIENT_TOKEN_SWAP")), wallet: trade, confirmMs: 45_000 });
      const consumers = [bk, kill(tape, null), orderGate(tape, clock, { trade }, { live: () => true, strategies: () => new Set(["sr_live"]) }), tr];
      const settle = async () => {
        await tape.flush();
        for (let i = 0; i < 6; i++) {
          let moved = 0;
          for (const c of consumers) moved += await drain(db.sql, c);
          moved += await tr.retry();
          if (!moved) break;
        }
      };

      const start = await chain.balance(trade);
      await recordDeposit(tape, trade, start, "live-start");
      check("trade wallet holds enough to pass the free-SOL floor", start >= 0.11e9, `${start / 1e9} SOL`);

      // a real price for the quote: what the builder would give 0.01 SOL right now
      const probe = await fetch(`${env.str("FUN_BLOCK_URL")}/agents/swap`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputMint: "So11111111111111111111111111111111111111112", outputMint: mint, amount: "10000000", user: trade, slippagePct: 3, encoding: "base64" }),
      }).then((r) => r.json() as Promise<{ pumpMintInfo?: { expectedOutAmount?: string; hasGraduated?: boolean } }>);
      const out = Number(probe.pumpMintInfo?.expectedOutAmount ?? 0) / 1e6;
      check("fun-block quoted the coin", out > 0, `${out} tokens for 0.01 SOL`);
      const send = (side: "buy" | "sell") => {
        tape.emit("trade.curve", { mint, tx: `live-quote-${side}`, slot_index_id: null, ts: clock.iso(), side: "buy", wallet: trade, sol: 0.01, usd: null, tokens: out, price_sol: 0.01 / out, price_usd: null, mcap_usd: null, on_curve: !probe.pumpMintInfo?.hasGraduated, program: null }, { source: "nats", subject: mint });
        const id = clock.id("intent");
        tape.emit("intent.created", { strategy_id: "sr_live", mint, side, size_sol: side === "buy" ? 0.01 : null, fraction: side === "sell" ? 1 : null, reason: ["live test"], score: 1, board: {} }, { source: "strategies", subject: id });
        tape.emit("intent.ghost_filled", { intent_id: id, strategy_id: "sr_live", mint, side, sol: 0.01, tokens: out, price_sol: 0.01 / out, fee_sol: 0, rent_sol: 0, slippage_bps: 0 }, { source: "strategies", subject: id });
      };

      send("buy");
      await settle();
      const buy = (await db.sql`select body from tape.events where topic = 'order.filled' order by seen_time`)[0]?.body as { tokens: number; sol: number; fee_sol: number; tx_sig: string } | undefined;
      check("buy filled with real numbers from the transaction", !!buy && buy.tokens > 0 && Math.abs(buy.sol - 0.01) < 0.0015, buy ? `${buy.tokens} tokens for ${buy.sol} SOL, fee ${buy.fee_sol}` : "no fill");

      send("sell");
      await settle();
      const fills = await db.sql`select body from tape.events where topic = 'order.filled' order by seen_time`;
      check("sell filled", fills.length === 2, `${fills.length} fills`);
      const pos = (await db.sql`select body from tape.events where topic = 'position.changed' order by seen_time`).map((r) => r.body as { closed: boolean; account_closed: boolean; rent_back_sol: number });
      check("full exit closed the token account and the rent came back", pos[1]?.closed === true && pos[1]?.account_closed === true && pos[1].rent_back_sol > 0.001, JSON.stringify(pos[1]));

      const rec = await reconcile(db.sql, tape, chain, bk, [trade], hourOf(clock.iso()));
      check("ledger equals chain to the lamport", rec?.ok === true, JSON.stringify(rec?.wallets));
      const end = await chain.balance(trade);
      check("round trip cost at most 0.002 SOL (fees and spread)", start - end < 0.002e9 + 0.0002e9, `${(start - end) / 1e9} SOL`);
    } finally {
      await tape.close();
      await db.done();
    }
    return { checks, metrics: {} };
  },
};
