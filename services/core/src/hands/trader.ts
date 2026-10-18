// Trader / Executor (docs/09): order.created -> fun-block swap -> memo -> Signer -> simulate -> send -> confirm ->
// real fill from the transaction -> order.filled, position.changed; after a full exit, close the token account.
// Idempotent by order id: the order id is in the transaction memo, and before any send we look for that memo.
import type { Envelope } from "@asimog/contracts";
import { DEFAULT_LIMITS, type Limits } from "../mind/risk.ts";
import { env } from "../lib/env.ts";
import type { Clock } from "../lib/clock.ts";
import { log } from "../lib/log.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { killed } from "../treasury/kill.ts";
import { appendMemo, type Builder, closeAccountTx, LAMPORTS } from "./builder.ts";
import type { Chain, Parsed } from "./chain.ts";
import type { SignerClient } from "./signer-client.ts";

export type TraderDeps = { tape: Tape; clock: Clock; chain: Chain; builder: Builder; swapSigner: SignerClient; wallet: string; confirmMs?: number };
type Order = { order_id: string; intent_id: string; strategy_id: string; mint: string; side: "buy" | "sell"; size_sol: number | null; fraction: number | null; max_slippage_bps: number };

const lam = (sol: number) => Math.round(sol * LAMPORTS);
const RENT_ALLOWANCE = () => env.int("TRADER_RENT_ALLOWANCE_LAMPORTS", 2_100_000); // a first buy also pays for the token account
const HEADROOM = () => env.int("TRADER_HEADROOM_LAMPORTS", 100_000); // priority fee and network fee room on top of the buy

export function trader(d: TraderDeps): Consumer {
  const { tape, chain, wallet } = d;
  const confirmMs = d.confirmMs ?? env.int("TRADER_CONFIRM_MS", 30_000);

  async function setState(tx: Tx, o: Order, state: string, sig: string | null) {
    await tx`insert into hands.orders (order_id, intent_id, state, tx_sig, memo, mint, strategy_id) values (${o.order_id}, ${o.intent_id}, ${state}, ${sig}, ${`asimog:${o.order_id}`}, ${o.mint}, ${o.strategy_id})
      on conflict (order_id) do update set state = excluded.state, tx_sig = coalesce(excluded.tx_sig, hands.orders.tx_sig), updated_at = now()`;
  }

  async function fail(tx: Tx, e: Envelope, o: Order, error: string, retryable: boolean, sig: string | null = null) {
    await setState(tx, o, "failed", sig);
    await tape.emitIn(tx, "order.failed", { order_id: o.order_id, tx_sig: sig, error, retryable }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
  }

  /** Close the wallet's empty token account and book the rent that came back. */
  async function closeAccount(tx: Tx, e: Envelope, o: Order): Promise<{ closed: boolean; rent_back: number }> {
    try {
      const built = await closeAccountTx(chain, wallet, o.mint, o.order_id);
      const signed = await d.swapSigner.sign("/sign/close-account", built.tx, { order_id: o.order_id });
      if (!signed.ok) throw new Error(`signer_refused:${signed.reason}`);
      const sig = await chain.send(signed.signed);
      const p = await chain.confirm(sig, confirmMs);
      if (!p || p.err) throw new Error(p?.err ?? "close not confirmed");
      const delta = p.lamports[wallet] ?? 0;
      const back = delta + p.fee;
      await tape.emitIn(tx, "ledger.entry", { entry_id: `close:${o.order_id}`, kind: "close_account", tx_sig: sig, legs: [{ account: `sol:${wallet}`, lamports: delta }, { account: `rent:${wallet}`, lamports: -back }, { account: "exp:fees", lamports: p.fee }] }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
      await tx`update hands.orders set close_pending = false where order_id = ${o.order_id}`;
      return { closed: true, rent_back: back / LAMPORTS };
    } catch (err) {
      log.warn("trader", { close_failed: o.order_id, err: String(err).slice(0, 160) });
      await tx`update hands.orders set close_pending = true where order_id = ${o.order_id}`;
      return { closed: false, rent_back: 0 };
    }
  }

  async function settle(tx: Tx, e: Envelope, o: Order, p: Parsed) {
    const mine = p.tokens.filter((t) => t.owner === wallet && t.mint === o.mint);
    const tokenDelta = mine.reduce((s, t) => s + t.delta, 0);
    const post = mine.reduce((s, t) => s + t.post, 0);
    const rent = mine.reduce((s, t) => s + t.rent_lamports, 0);
    const delta = p.lamports[wallet] ?? 0;
    const tokens = Math.abs(tokenDelta);
    const solLam = o.side === "buy" ? -delta - p.fee - rent : delta + p.fee; // what the coin cost or paid, before the network fee and rent
    if (!(tokens > 0) || solLam <= 0) return fail(tx, e, o, "empty_fill", false, p.sig);
    await tape.emitIn(tx, "order.filled", { order_id: o.order_id, intent_id: o.intent_id, strategy_id: o.strategy_id, mint: o.mint, side: o.side, tx_sig: p.sig, tokens, sol: solLam / LAMPORTS, fee_sol: p.fee / LAMPORTS, price_sol: solLam / LAMPORTS / tokens, slot: p.slot, rent_sol: rent / LAMPORTS }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
    await setState(tx, o, "filled", p.sig);
    const full = o.side === "sell" && post <= 1e-9;
    const c = full ? await closeAccount(tx, e, o) : { closed: false, rent_back: 0 };
    await tape.emitIn(tx, "position.changed", { order_id: o.order_id, strategy_id: o.strategy_id, mint: o.mint, tokens: post, closed: full, account_closed: c.closed, rent_back_sol: c.rent_back }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
  }

  async function run(tx: Tx, e: Envelope) {
    const o = e.body as Order;
    const memo = `asimog:${o.order_id}`;
    const [have] = await tx`select state, tx_sig from hands.orders where order_id = ${o.order_id}`;
    if (have && (have.state === "filled" || have.state === "failed")) return;
    if (o.side === "buy" && (await killed(tx))) return fail(tx, e, o, "killed", false);
    let sig = (have?.tx_sig as string | null) ?? (await chain.findByMemo(wallet, memo));
    if (!sig && o.side === "buy") { // docs/09 Executor step 1: re-read the quote; the Risk Gate checked it once already
      const [lim] = await tx`select body from mind.limits order by version desc limit 1`;
      const maxAge = ({ ...DEFAULT_LIMITS, ...((lim?.body as Partial<Limits> | undefined) ?? {}) }).max_quote_age_ms;
      const [q] = await tx`select seen_time from tape.events where subject = ${o.mint} and topic in ('trade.curve', 'trade.amm') and body->>'price_sol' is not null order by seen_time desc, id desc limit 1`;
      const age = q ? d.clock.now() - (q.seen_time as Date).getTime() : Number.POSITIVE_INFINITY;
      if (age > maxAge) return fail(tx, e, o, `stale_quote:${Number.isFinite(age) ? Math.round(age) : "none"} ms`, true);
    }
    if (!sig) {
      let amount: string;
      if (o.side === "buy") amount = String(lam(o.size_sol ?? 0));
      else {
        const [held] = await tx`select coalesce(sum(tokens), 0)::float t from books.lots where strategy_id = ${o.strategy_id} and mint = ${o.mint}`;
        const raw = Math.floor((held!.t as number) * (o.fraction ?? 1) * 1e6);
        if (raw <= 0) return fail(tx, e, o, "no_position", false);
        amount = String(raw);
      }
      let built: { tx: string; route: "curve" | "amm" };
      try {
        built = await d.builder.swap({ side: o.side, mint: o.mint, wallet, amount, slippagePct: o.max_slippage_bps / 100 });
      } catch (err) {
        return fail(tx, e, o, `builder_failed:${String(err).slice(0, 80)}`, true);
      }
      const withMemo = appendMemo(built.tx, memo);
      const cap = o.side === "buy" ? Math.ceil(lam(o.size_sol ?? 0) * (1 + o.max_slippage_bps / 10_000)) + HEADROOM() : HEADROOM();
      const signed = await d.swapSigner.sign("/sign/swap", withMemo, { max_lamports: cap, order_id: o.order_id });
      if (!signed.ok) return fail(tx, e, o, `signer_refused:${signed.reason}`, false);
      const sim = await chain.simulate(signed.signed, wallet);
      if (sim.err) return fail(tx, e, o, `simulation_failed:${sim.err.slice(0, 80)}`, true);
      if (o.side === "buy") {
        const want = lam(o.size_sol ?? 0);
        if (-sim.sol_delta > want * (1 + o.max_slippage_bps / 10_000) + HEADROOM() + RENT_ALLOWANCE()) return fail(tx, e, o, `simulation_deviates:${-sim.sol_delta} vs ${want}`, false);
      } else if (sim.sol_delta < -HEADROOM()) return fail(tx, e, o, "simulation_deviates:sell costs SOL", false);
      try {
        sig = await chain.send(signed.signed);
      } catch (err) {
        return fail(tx, e, o, `send_failed:${String(err).slice(0, 80)}`, true);
      }
      await setState(tx, o, "submitted", sig);
      await tape.emitIn(tx, "order.submitted", { order_id: o.order_id, tx_sig: sig, route: built.route, submitted_at: d.clock.iso() }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
    }
    const p = await chain.confirm(sig, confirmMs);
    if (!p) throw new Error(`order ${o.order_id}: not confirmed yet; retry finds it by memo`); // rolls back; never resends blindly
    if (p.err) return fail(tx, e, o, `onchain_error:${p.err.slice(0, 80)}`, true, sig);
    await settle(tx, e, o, p);
  }

  return {
    name: "trader",
    topics: ["order.created"],
    batch: 1,
    startAtHead: true,
    async handle(events, tx) {
      for (const e of events) await run(tx, e);
    },
  };
}
