// Trader / Executor (docs/EXECUTION.md): order.created -> fun-block swap -> memo -> Signer -> simulate -> send -> confirm ->
// real fill from the transaction -> order.filled, position.changed; after a full exit, close the token account.
// Idempotent by order id and attempt: the memo names both, the signature is committed before we wait for the confirm,
// and an order with a stored signature is only ever confirmed again, never rebuilt (docs/SYSTEM.md 5.3). retry() drives
// unconfirmed orders, sells that failed and closes that failed.
import type { Envelope } from "@asimog/contracts";
import type { Clock } from "../lib/clock.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { type Limits, loadLimits } from "../mind/risk.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { killState } from "../treasury/kill.ts";
import { appendMemo, type Builder, closeAccountTx, LAMPORTS } from "./builder.ts";
import type { Chain, Parsed } from "./chain.ts";
import type { SignerClient } from "./signer-client.ts";

export type TraderDeps = { sql: Sql; tape: Tape; clock: Clock; chain: Chain; builder: Builder; swapSigner: SignerClient; wallet: string; confirmMs?: number };
type Order = { order_id: string; intent_id: string; strategy_id: string; mint: string; side: "buy" | "sell"; size_sol: number | null; fraction: number | null; max_slippage_bps: number };
export type Trader = Consumer & { retry(): Promise<number> };

const lam = (sol: number) => Math.round(sol * LAMPORTS);
const RENT_ALLOWANCE = () => env.int("TRADER_RENT_ALLOWANCE_LAMPORTS"); // a first buy also pays for the token account
const HEADROOM = () => env.int("TRADER_HEADROOM_LAMPORTS"); // priority fee and network fee room on top of the buy
const GIVE_UP_MS = () => env.int("TRADER_GIVE_UP_MS"); // past this a sent transaction's blockhash has expired: it can no longer land
const SELL_ATTEMPTS = () => env.int("TRADER_SELL_ATTEMPTS");
const RETRY_BASE_MS = () => env.int("TRADER_RETRY_BASE_MS");
const FULL_EXIT = 0.999; // a fraction this close to 1 sells the whole on-chain balance, so no dust holds the slot
const memoOf = (o: Order, attempt: number) => (attempt ? `asimog:${o.order_id}:r${attempt}` : `asimog:${o.order_id}`);

const limitsOf = (tx: Tx) => loadLimits(tx);

/** The Trader re-checks what it is told: size and slippage never pass the owner's limits, whatever the event says. */
function clamp(o: Order, L: Limits): Order {
  return { ...o, size_sol: o.size_sol === null ? null : Math.min(o.size_sol, L.max_order_sol), max_slippage_bps: Math.min(o.max_slippage_bps, L.max_slippage_bps) };
}

export function trader(d: TraderDeps): Trader {
  const { tape, chain, wallet } = d;
  const confirmMs = d.confirmMs ?? env.int("TRADER_CONFIRM_MS");
  const at = () => d.clock.iso();

  async function setState(tx: Tx | Sql, o: Order, state: string, sig: string | null, attempt: number, nextAt: string | null = null) {
    await tx`insert into hands.orders (order_id, intent_id, state, tx_sig, memo, mint, strategy_id, attempts, next_at, created_at, updated_at)
      values (${o.order_id}, ${o.intent_id}, ${state}, ${sig}, ${memoOf(o, attempt)}, ${o.mint}, ${o.strategy_id}, ${attempt}, ${nextAt}, ${at()}, ${at()})
      on conflict (order_id) do update set state = excluded.state, tx_sig = excluded.tx_sig, memo = excluded.memo, attempts = excluded.attempts, next_at = excluded.next_at, updated_at = excluded.updated_at`;
  }

  async function fail(tx: Tx, e: Envelope, o: Order, error: string, retryable: boolean, sig: string | null, attempt: number) {
    await setState(tx, o, "failed", sig, attempt);
    await tape.emitIn(tx, "order.failed", { order_id: o.order_id, tx_sig: sig, error, retryable }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
  }

  /** A sell must close its position: a retryable failure schedules another attempt with backoff. Buys are never retried. */
  async function failOrRetry(tx: Tx, e: Envelope, o: Order, error: string, sig: string | null, attempt: number) {
    if (o.side !== "sell" || attempt + 1 >= SELL_ATTEMPTS()) return fail(tx, e, o, error, o.side === "sell", sig, attempt);
    const next = new Date(d.clock.now() + RETRY_BASE_MS() * 2 ** attempt).toISOString();
    await setState(tx, o, "retry", null, attempt + 1, next);
    await tape.emitIn(tx, "order.failed", { order_id: o.order_id, tx_sig: sig, error: `${error} (attempt ${attempt + 1}, retrying)`, retryable: true }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
  }

  /** Close the wallet's empty token account and book the rent that came back. A failure leaves close_pending for retry(). */
  async function closeAccount(tx: Tx, e: Envelope, o: Order): Promise<{ closed: boolean; rent_back: number }> {
    try {
      const memo = `asimog:${o.order_id}:close`;
      let sig = await chain.findByMemo(wallet, memo);
      if (!sig) {
        const built = await closeAccountTx(chain, wallet, o.mint, o.order_id);
        const signed = await d.swapSigner.sign("/sign/close-account", built.tx, { order_id: o.order_id });
        if (!signed.ok) throw new Error(`signer_refused:${signed.reason}`);
        sig = await chain.send(signed.signed);
      }
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

  async function settle(tx: Tx, e: Envelope, o: Order, p: Parsed, attempt: number) {
    const mine = p.tokens.filter((t) => t.owner === wallet && t.mint === o.mint);
    const tokenDelta = mine.reduce((s, t) => s + t.delta, 0);
    const post = mine.reduce((s, t) => s + t.post, 0);
    const rent = mine.reduce((s, t) => s + t.rent_lamports, 0);
    const delta = p.lamports[wallet] ?? 0;
    const tokens = Math.abs(tokenDelta);
    const solLam = o.side === "buy" ? -delta - p.fee - rent : delta + p.fee; // what the coin cost or paid, before the network fee and rent
    if (!(tokens > 0) || solLam <= 0) return fail(tx, e, o, "empty_fill", false, p.sig, attempt);
    await tape.emitIn(tx, "order.filled", { order_id: o.order_id, intent_id: o.intent_id, strategy_id: o.strategy_id, mint: o.mint, side: o.side, tx_sig: p.sig, tokens, sol: solLam / LAMPORTS, fee_sol: p.fee / LAMPORTS, price_sol: solLam / LAMPORTS / tokens, slot: p.slot, rent_sol: rent / LAMPORTS }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
    await setState(tx, o, "filled", p.sig, attempt);
    const full = o.side === "sell" && post <= 1e-9;
    const c = full ? await closeAccount(tx, e, o) : { closed: false, rent_back: 0 };
    await tape.emitIn(tx, "position.changed", { order_id: o.order_id, strategy_id: o.strategy_id, mint: o.mint, tokens: post, closed: full, account_closed: c.closed, rent_back_sol: c.rent_back }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
  }

  /** Confirm a stored signature. Not landed yet: leave it submitted for retry(); expired: count it as failed. */
  async function confirm(tx: Tx, e: Envelope, o: Order, sig: string, attempt: number, submittedMs: number) {
    const p = await chain.confirm(sig, confirmMs);
    if (p) return p.err ? failOrRetry(tx, e, o, `onchain_error:${p.err.slice(0, 80)}`, sig, attempt) : settle(tx, e, o, p, attempt);
    if (d.clock.now() - submittedMs > GIVE_UP_MS()) return failOrRetry(tx, e, o, "confirm_timeout", sig, attempt);
  }

  async function held(tx: Tx, o: Order, fraction: number) {
    const [h] = await tx`select coalesce(sum(tokens), 0)::float t from books.lots where strategy_id = ${o.strategy_id} and mint = ${o.mint}`;
    return Math.floor((h!.t as number) * fraction * 1e6);
  }

  /** One attempt: build, sign, simulate, send, commit the signature, confirm. */
  async function attempt(tx: Tx, e: Envelope, o: Order, n: number) {
    const k = await killState(tx);
    if (o.side === "buy" && k !== "running") return fail(tx, e, o, "killed", false, null, n);
    if (k === "halted") return failOrRetry(tx, e, o, "killed", null, n);
    const memo = memoOf(o, n);
    const found = await chain.findByMemo(wallet, memo); // sent before a crash that lost our commit
    if (found) return confirm(tx, e, o, found, n, d.clock.now());
    const L = await limitsOf(tx);
    if (o.side === "buy") { // docs/EXECUTION.md Executor step 1: re-read the quote; the Risk Gate checked it once already
      const [q] = await tx`select seen_time from tape.events where subject = ${o.mint} and topic in ('trade.curve', 'trade.amm') and body->>'price_sol' is not null order by seen_time desc, id desc limit 1`;
      const age = q ? d.clock.now() - (q.seen_time as Date).getTime() : Number.POSITIVE_INFINITY;
      if (age > L.max_quote_age_ms) return fail(tx, e, o, `stale_quote:${Number.isFinite(age) ? Math.round(age) : "none"} ms`, true, null, n);
    }
    let amount: string;
    if (o.side === "buy") amount = String(lam(o.size_sol ?? 0));
    else {
      const fraction = o.fraction ?? 1;
      const raw = fraction >= FULL_EXIT ? await chain.tokenBalance(wallet, o.mint) : await held(tx, o, fraction);
      if (raw <= 0) return fail(tx, e, o, "no_position", false, null, n);
      amount = String(raw);
    }
    let built: { tx: string; route: "curve" | "amm" };
    try {
      built = await d.builder.swap({ side: o.side, mint: o.mint, wallet, amount, slippagePct: o.max_slippage_bps / 100 });
    } catch (err) {
      return failOrRetry(tx, e, o, `builder_failed:${String(err).slice(0, 80)}`, null, n);
    }
    const withMemo = appendMemo(built.tx, memo);
    const cap = o.side === "buy" ? Math.ceil(lam(o.size_sol ?? 0) * (1 + o.max_slippage_bps / 10_000)) + HEADROOM() : HEADROOM();
    const signed = await d.swapSigner.sign("/sign/swap", withMemo, { max_lamports: cap, order_id: o.order_id });
    if (!signed.ok) return fail(tx, e, o, `signer_refused:${signed.reason}`, false, null, n);
    const sim = await chain.simulate(signed.signed, wallet);
    if (sim.err) return failOrRetry(tx, e, o, `simulation_failed:${sim.err.slice(0, 80)}`, null, n);
    if (o.side === "buy") {
      const want = lam(o.size_sol ?? 0);
      if (-sim.sol_delta > want * (1 + o.max_slippage_bps / 10_000) + HEADROOM() + RENT_ALLOWANCE()) return fail(tx, e, o, `simulation_deviates:${-sim.sol_delta} vs ${want}`, false, null, n);
    } else if (sim.sol_delta < -HEADROOM()) return fail(tx, e, o, "simulation_deviates:sell costs SOL", false, null, n);
    let sig: string;
    try {
      sig = await chain.send(signed.signed);
    } catch (err) {
      return failOrRetry(tx, e, o, `send_failed:${String(err).slice(0, 80)}`, null, n);
    }
    await setState(d.sql, o, "submitted", sig, n); // its own commit: a rollback of this batch must never forget a sent transaction
    await tape.emitIn(tx, "order.submitted", { order_id: o.order_id, tx_sig: sig, route: built.route, submitted_at: at() }, { source: "trader", subject: o.order_id, causes: [e.id], after: e.seen_time });
    return confirm(tx, e, o, sig, n, d.clock.now());
  }

  async function run(tx: Tx, e: Envelope) {
    const o = clamp(e.body as Order, await limitsOf(tx));
    const [have] = await tx`select 1 from hands.orders where order_id = ${o.order_id}`;
    if (have) return; // already started: retry() owns it from here
    await attempt(tx, e, o, 0);
  }

  async function orderEvent(tx: Tx, orderId: string): Promise<Envelope | null> {
    const [r] = await tx`select id, topic, v, event_time, seen_time, source, subject, causes, mode, body from tape.events where topic = 'order.created' and subject = ${orderId} limit 1`;
    return r ? ({ ...r, seen_time: (r.seen_time as Date).toISOString(), event_time: (r.event_time as Date).toISOString() } as unknown as Envelope) : null;
  }

  return {
    name: "trader",
    topics: ["order.created"],
    batch: 1,
    startAtHead: true,
    ownLoop: true,
    async handle(events, tx) {
      for (const e of events)
        try {
          await tx.savepoint((sp) => run(sp as unknown as Tx, e));
        } catch (err) { // one bad event must not block every later order
          log.error("trader", { dead_letter: e.id, err: String(err).slice(0, 200) });
          await tx`insert into hands.dead_letters (event_id, consumer, error, at) values (${e.id}, 'trader', ${String(err).slice(0, 500)}, ${at()}) on conflict do nothing`;
        }
    },
    async retry() {
      const rows = await d.sql`select order_id, state, tx_sig, attempts, next_at, updated_at from hands.orders
        where state in ('submitted', 'retry') or (state = 'filled' and close_pending) order by updated_at`;
      let n = 0;
      for (const r of rows) {
        if (r.state === "retry" && (r.next_at as Date).getTime() > d.clock.now()) continue;
        await d.sql
          .begin(async (tx) => {
            const e = await orderEvent(tx, r.order_id as string);
            if (!e) return;
            const o = clamp(e.body as Order, await limitsOf(tx));
            if (r.state === "filled") await closeAccount(tx, e, o);
            else if (r.state === "submitted") await confirm(tx, e, o, r.tx_sig as string, r.attempts as number, (r.updated_at as Date).getTime());
            else await attempt(tx, e, o, r.attempts as number);
            n++;
          })
          .catch((err) => log.warn("trader", { retry: r.order_id, err: String(err).slice(0, 160) }));
      }
      return n;
    },
  };
}
