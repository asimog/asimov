// Books (docs/EXECUTION.md): double-entry ledger as a projection of Tape events, hourly reconciliation against the chain, NAV.
// Every entry's legs sum to zero (debits positive, credits negative, in lamports). The account `sol:<wallet>` is the
// wallet's chain balance, so reconciliation compares one number per wallet. Rebuildable from the Tape at any time.
import type { Envelope } from "@asimog/contracts";
import { LAMPORTS } from "../hands/builder.ts";
import type { Chain } from "../hands/chain.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { type Consumer, drain, type Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";

type Leg = { account: string; lamports: number };
const lam = (sol: number) => Math.round(sol * LAMPORTS);

async function post(tx: Tx, id: string, at: string, kind: string, sig: string | null, legs: Leg[]): Promise<boolean> {
  const [row] = await tx`insert into books.entries (entry_id, seen_time, kind, tx_sig, legs) values (${id}, ${at}, ${kind}, ${sig}, ${tx.json(legs as never)})
    on conflict do nothing returning entry_id`;
  if (!row) return false; // already posted: replays and restarts are safe
  for (const l of legs)
    await tx`insert into books.balances (account, lamports) values (${l.account}, ${l.lamports}) on conflict (account) do update set lamports = books.balances.lamports + excluded.lamports`;
  return true;
}

/** FIFO: take `tokens` from the oldest lots; returns the SOL cost consumed. */
async function consume(tx: Tx, strategy: string, mint: string, tokens: number): Promise<number> {
  let left = tokens;
  let cost = 0;
  const lots = await tx`select seq, tokens, cost_sol from books.lots where strategy_id = ${strategy} and mint = ${mint} order by seq for update`;
  for (const l of lots) {
    if (left <= 1e-9) break;
    const take = Math.min(left, l.tokens as number);
    const c = (l.cost_sol as number) * (take / (l.tokens as number));
    cost += c;
    left -= take;
    if (take >= (l.tokens as number) - 1e-9) await tx`delete from books.lots where seq = ${l.seq}`;
    else await tx`update books.lots set tokens = tokens - ${take}, cost_sol = cost_sol - ${c} where seq = ${l.seq}`;
  }
  return cost;
}

export function books(tape: Tape, wallets: { trade: string }): Consumer {
  return {
    name: "books",
    topics: ["order.filled", "ledger.entry"],
    batch: 200,
    async handle(events: Envelope[], tx: Tx) {
      for (const e of events) {
        if (e.topic === "ledger.entry") {
          const b = e.body as { entry_id: string; kind: string; tx_sig: string | null; legs: Leg[] };
          if (b.legs.reduce((s, l) => s + l.lamports, 0) !== 0) {
            log.warn("books", { unbalanced: b.entry_id });
            await tape.emitIn(tx, "system.note", { kind: "ledger_unbalanced", detail: b }, { source: "system", subject: b.entry_id, causes: [e.id], after: e.seen_time });
            continue;
          }
          await post(tx, b.entry_id, e.seen_time, b.kind, b.tx_sig, b.legs);
          continue;
        }
        const f = e.body as { order_id: string; strategy_id: string; mint: string; side: "buy" | "sell"; tx_sig: string; tokens: number; sol: number; fee_sol: number; rent_sol: number };
        const T = `sol:${wallets.trade}`;
        const day = e.seen_time.slice(0, 10);
        if (f.side === "buy") {
          // the buy fee stays in the lot's cost, so it lands in realized PnL when the lot is sold, as the sell fee does: the daily
          // loss stop sees every fee (expensing it here would make losses look smaller)
          const cost = lam(f.sol) + lam(f.fee_sol);
          const legs: Leg[] = [
            { account: T, lamports: -(cost + lam(f.rent_sol)) },
            { account: `pos:${f.mint}`, lamports: cost },
            { account: `rent:${wallets.trade}`, lamports: lam(f.rent_sol) },
          ].filter((l) => l.lamports !== 0);
          if (await post(tx, `fill:${f.order_id}`, e.seen_time, "buy", f.tx_sig, legs))
            await tx`insert into books.lots (strategy_id, mint, tokens, cost_sol) values (${f.strategy_id}, ${f.mint}, ${f.tokens}, ${cost / LAMPORTS})`;
        } else {
          // the cost leaving the position is known only after FIFO, so the entry is built inside the same transaction
          const [seen] = await tx`select 1 from books.entries where entry_id = ${`fill:${f.order_id}`}`;
          if (seen) continue;
          const cost = lam(await consume(tx, f.strategy_id, f.mint, f.tokens));
          const net = lam(f.sol) - lam(f.fee_sol);
          const legs: Leg[] = [
            { account: T, lamports: net },
            { account: "exp:fees", lamports: lam(f.fee_sol) },
            { account: `pos:${f.mint}`, lamports: -cost },
            { account: "pnl:trading", lamports: -(lam(f.sol) - cost) },
          ].filter((l) => l.lamports !== 0);
          await post(tx, `fill:${f.order_id}`, e.seen_time, "sell", f.tx_sig, legs);
          await tx`insert into books.realized (strategy_id, day, realized_sol) values (${f.strategy_id}, ${day}, ${(net - cost) / LAMPORTS})
            on conflict (strategy_id, day) do update set realized_sol = books.realized.realized_sol + excluded.realized_sol`;
        }
      }
    },
  };
}

export async function balances(sql: Sql): Promise<Record<string, number>> {
  const rows = await sql`select account, lamports from books.balances`;
  return Object.fromEntries(rows.map((r) => [r.account as string, Number(r.lamports)]));
}

/** Balances as the entries stood before `to`: a proof for an hour describes that hour, not the moment it was published. */
export async function balancesAt(sql: Sql, to: string): Promise<Record<string, number>> {
  const rows = await sql`select leg->>'account' account, sum((leg->>'lamports')::bigint)::text lamports from books.entries, jsonb_array_elements(legs) leg
    where seen_time < ${to} group by 1 having sum((leg->>'lamports')::bigint) <> 0`;
  return Object.fromEntries(rows.map((r) => [r.account as string, Number(r.lamports)]));
}

/** NAV: SOL balances plus open lots marked at `prices` (SOL per token). A lot with no price is marked at cost. */
export async function nav(sql: Sql, prices: Record<string, number>) {
  const b = await balances(sql);
  const sum = (p: string) => Object.entries(b).filter(([a]) => a.startsWith(p)).reduce((s, [, v]) => s + v, 0) / LAMPORTS;
  const lots = await sql`select mint, sum(tokens)::float tokens, sum(cost_sol)::float cost from books.lots group by 1`;
  const positions = lots.reduce((s, l) => s + (prices[l.mint as string] != null ? (l.tokens as number) * prices[l.mint as string]! : (l.cost as number)), 0);
  const sol = sum("sol:");
  const rent = sum("rent:");
  return { sol, positions_sol: positions, rent_sol: rent, nav_sol: sol + positions + rent };
}

export async function recordDeposit(tape: Tape, wallet: string, lamports: number, sig: string) {
  return tape.emit("ledger.entry", { entry_id: `deposit:${sig}`, kind: "deposit", tx_sig: sig, legs: [{ account: `sol:${wallet}`, lamports }, { account: "ext:world", lamports: -lamports }] }, { source: "treasurer", dedupe: `deposit:${sig}` });
}

export const hourOf = (iso: string) => `${iso.slice(0, 13)}:00:00Z`;

/**
 * Hourly: ledger balance of every wallet must equal its chain balance to the lamport. Skipped while an order is in flight, but only
 * for TRADER_GIVE_UP_MS: an order stuck longer is reported and the check runs anyway, so one stuck order never hides real drift.
 */
export async function reconcile(sql: Sql, tape: Tape, chain: Chain, consumer: Consumer, wallets: string[], hour: string) {
  const young = new Date(tape.clock.now() - env.int("TRADER_GIVE_UP_MS")).toISOString();
  const [inflight] = await sql`select count(*) filter (where updated_at > ${young})::int fresh, count(*) filter (where updated_at <= ${young})::int stale,
    min(order_id) filter (where updated_at <= ${young}) first from hands.orders where state in ('submitted', 'retry') or (state = 'filled' and close_pending)`;
  if (inflight!.fresh > 0) return null;
  if (inflight!.stale > 0)
    tape.emit("ops.alert", { severity: "warn", text: `${inflight!.stale} orders in flight past TRADER_GIVE_UP_MS, first ${inflight!.first}; reconciling anyway`, finding: "order.stale" }, { source: "treasurer", subject: inflight!.first as string, dedupe: `stale:${hour}` });
  await drain(sql, consumer);
  const b = await balances(sql);
  const rows: { wallet: string; ledger_lamports: number; chain_lamports: number }[] = [];
  let degraded = false;
  for (const w of wallets) {
    let c: number | null = null;
    for (let i = 0; i < 3 && c === null; i++) c = await chain.balance(w).catch(() => null);
    if (c === null) degraded = true;
    rows.push({ wallet: w, ledger_lamports: b[`sol:${w}`] ?? 0, chain_lamports: c ?? -1 });
  }
  const ok = !degraded && rows.every((r) => r.ledger_lamports === r.chain_lamports);
  tape.emit("books.reconciled", { hour, ok, degraded: degraded || undefined, wallets: rows }, { source: "treasurer", dedupe: `recon:${hour}` });
  await tape.flush();
  return { ok, degraded, wallets: rows };
}
