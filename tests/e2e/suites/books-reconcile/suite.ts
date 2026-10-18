// A scripted day on the mocked chain: deposit, buys, sells, rent, close. The ledger must equal the chain to the lamport,
// FIFO PnL and NAV must match hand computation, a 1-lamport drift must fail the hour and trip the kill switch, the ledger
// must rebuild identically from the Tape, and the proof chain must verify (docs/EXECUTION.md, docs/OPS.md).
import crypto from "node:crypto";
import { balances, hourOf, nav, reconcile } from "../../../../services/core/src/treasury/books.ts";
import { killState } from "../../../../services/core/src/treasury/kill.ts";
import { publishProof, verifyProofs } from "../../../../services/core/src/treasury/proofs.ts";
import { drain } from "../../../../services/core/src/tape/consumer.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";
import { SOL, world } from "../../lib/world.ts";

const hash = (x: unknown) => crypto.createHash("sha256").update(JSON.stringify(x, Object.keys(x as object).sort())).digest("hex");

export const suite: Suite = {
  name: "books-reconcile",
  proves: "A scripted day reconciles to the lamport; FIFO PnL and NAV match hand computation; drift is caught and kills; the ledger rebuilds from the Tape; the proof chain verifies.",
  async run() {
    const w = await world("books");
    const checks: Check[] = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
    try {
      await w.fund(w.wallets.trade, 0.2);
      // the day: two buys of one coin at different prices, a partial sell, a second coin, full exits
      const mint2 = w.keys.stranger.publicKey.toBase58();
      w.chain.prices.set(mint2, 5e-8);
      await w.intent("buy", { size_sol: 0.01 });
      await w.settle();
      w.chain.prices.set(w.mint, 6e-8);
      await w.intent("buy", { size_sol: 0.01 });
      await w.settle();
      w.chain.prices.set(w.mint, 9e-8);
      await w.intent("sell", { fraction: 0.8 });
      await w.settle();
      await w.intent("buy", { size_sol: 0.015, mint: mint2 });
      await w.settle();
      const mid = await nav(w.sql, { [w.mint]: 9e-8, [mint2]: 5e-8 });
      await w.intent("sell", { fraction: 1, mint: mint2 });
      await w.settle();
      await w.intent("sell", { fraction: 1 });
      const errors = await w.settle();
      check("no consumer errors during the day", errors.length === 0, errors.join("; ") || "clean");

      const fills = (await w.topic("order.filled")).map((e) => e.body as { side: string; mint: string; tokens: number; sol: number; fee_sol: number; rent_sol: number; strategy_id: string });
      check("six fills landed", fills.length === 6, `${fills.length} fills`);
      check("both token accounts closed, rent back", w.chain.tokensOf(w.wallets.trade, w.mint) === undefined && w.chain.tokensOf(w.wallets.trade, mint2) === undefined, "no token account left on chain");

      // 1. ledger equals chain, to the lamport
      const rec = await reconcile(w.sql, w.tape, w.chain, w.books, [w.wallets.trade], hourOf(w.clock.iso()));
      check("ledger equals chain to the lamport", rec?.ok === true, JSON.stringify(rec?.wallets));
      const b = await balances(w.sql);
      check("every ledger entry balances (sum of all accounts is zero)", Object.values(b).reduce((s, v) => s + v, 0) === 0, `sum ${Object.values(b).reduce((s, v) => s + v, 0)}`);
      check("positions and rent are back to zero", Object.entries(b).filter(([a]) => a.startsWith("pos:") || a.startsWith("rent:")).every(([, v]) => v === 0), "pos and rent accounts empty");

      // 2. FIFO PnL by hand: sell of coin A took 80% of 2 lots: all of lot 1 is not enough, so lot 1 + a part of lot 2
      const A = fills.filter((f) => f.mint === w.mint);
      const buys = A.filter((f) => f.side === "buy");
      const sells = A.filter((f) => f.side === "sell");
      const L = Math.round;
      const cost1 = L(buys[0]!.sol * SOL) + L(buys[0]!.fee_sol * SOL);
      const cost2 = L(buys[1]!.sol * SOL) + L(buys[1]!.fee_sol * SOL);
      const t1 = buys[0]!.tokens;
      const t2 = buys[1]!.tokens;
      const s1 = sells[0]!.tokens;
      const first = Math.min(s1, t1);
      const costFirst = cost1 * (first / t1) + cost2 * ((s1 - first) / t2);
      const net1 = L(sells[0]!.sol * SOL) - L(sells[0]!.fee_sol * SOL);
      const costRest = cost1 * ((t1 - first) / t1) + cost2 * ((t2 - (s1 - first)) / t2);
      const net2 = L(sells[1]!.sol * SOL) - L(sells[1]!.fee_sol * SOL);
      const expectedA = (net1 - costFirst + (net2 - costRest)) / SOL;
      const [real] = await w.sql`select coalesce(sum(realized_sol), 0)::float r from books.realized where strategy_id = 'sr_live'`;
      const B = fills.filter((f) => f.mint === mint2);
      const expectedB = (L(B[1]!.sol * SOL) - L(B[1]!.fee_sol * SOL) - (L(B[0]!.sol * SOL) + L(B[0]!.fee_sol * SOL))) / SOL;
      check("FIFO realized PnL matches hand computation", Math.abs((real!.r as number) - (expectedA + expectedB)) < 2e-9, `books ${(real!.r as number).toFixed(9)} vs hand ${(expectedA + expectedB).toFixed(9)} SOL`);
      const closeFees = (await w.topic("ledger.entry")).filter((e) => e.body.kind === "close_account").reduce((s, e) => s + ((e.body.legs as { account: string; lamports: number }[]).find((l) => l.account === "exp:fees")?.lamports ?? 0), 0);
      const final = await w.chain.balance(w.wallets.trade);
      check("wallet = deposit + realized PnL - close fees (cross-check against the chain)", Math.abs(final - (0.2 * SOL + (real!.r as number) * SOL - closeFees)) < 3, `chain ${final} vs ${Math.round(0.2 * SOL + (real!.r as number) * SOL - closeFees)}`);

      // 3. NAV by hand, taken mid-day (coin A open at 9e-8 and coin B open at cost)
      const remainA = t1 + t2 - s1;
      const mid2 = mid;
      const handNav = mid2.sol + remainA * 9e-8 + B[0]!.tokens * 5e-8 + mid2.rent_sol;
      check("NAV mid-day matches SOL + tokens at price + rent", Math.abs(mid2.nav_sol - handNav) < 1e-9, `nav ${mid2.nav_sol.toFixed(9)} vs ${handNav.toFixed(9)}`);

      // 4. rebuild from the Tape gives the same books
      const before = hash(await balances(w.sql));
      await w.sql`truncate books.entries, books.balances, books.lots, books.realized`;
      await w.sql`delete from tape.consumer_offsets where consumer = 'books'`;
      await drain(w.sql, w.books);
      check("ledger rebuilds identically from the Tape", hash(await balances(w.sql)) === before, `hash ${before.slice(0, 12)}`);
      const [again] = await w.sql`select count(*)::int n from books.entries`;
      await w.sql`delete from tape.consumer_offsets where consumer = 'books'`;
      await drain(w.sql, w.books);
      const [twice] = await w.sql`select count(*)::int n from books.entries`;
      check("replaying the same events twice posts nothing twice", again!.n === twice!.n && hash(await balances(w.sql)) === before, `${twice!.n} entries`);

      // 5. an unbalanced entry is refused and recorded; the same entry id is applied once
      w.tape.emit("ledger.entry", { entry_id: "bad:1", kind: "fee", tx_sig: null, legs: [{ account: "exp:fees", lamports: 5 }] }, { source: "treasurer" });
      w.tape.emit("ledger.entry", { entry_id: "dup:1", kind: "fee", tx_sig: null, legs: [{ account: "exp:fees", lamports: 5 }, { account: "ext:world", lamports: -5 }] }, { source: "treasurer" });
      w.tape.emit("ledger.entry", { entry_id: "dup:1", kind: "fee", tx_sig: null, legs: [{ account: "exp:fees", lamports: 5 }, { account: "ext:world", lamports: -5 }] }, { source: "treasurer" });
      await w.settle();
      const after = await balances(w.sql);
      const notes = (await w.topic("system.note")).filter((e) => e.body.kind === "ledger_unbalanced");
      const [badRow] = await w.sql`select count(*)::int n from books.entries where entry_id = 'bad:1'`;
      check("unbalanced entry rejected and noted", notes.length === 1 && badRow!.n === 0, `${notes.length} note`);
      check("duplicate entry id applied once", (after["exp:fees"] ?? 0) - (b["exp:fees"] ?? 0) === 5, `exp:fees +${(after["exp:fees"] ?? 0) - (b["exp:fees"] ?? 0)}`);

      // 6. proofs: two hours chain; the memo is on chain; tampering is found
      const h1 = hourOf(w.clock.iso());
      const h0 = new Date(Date.parse(h1) + 3_600_000).toISOString();
      w.chain.set(w.wallets.agent, 1_000_000);
      const p1 = await publishProof({ sql: w.sql, tape: w.tape, chain: w.chain, signer: w.treasurySigner, agent: w.wallets.agent }, h1);
      const p2 = await publishProof({ sql: w.sql, tape: w.tape, chain: w.chain, signer: w.treasurySigner, agent: w.wallets.agent }, h0);
      const v1 = await verifyProofs(w.sql);
      check("proof chain verifies", v1.ok && v1.segments === 2 && p2.n === 2, `${v1.segments} segments, head ${p2.sha256.slice(0, 12)}`);
      const [seg2] = await w.sql`select prev_sha256 from books.proofs where n = 2`;
      check("segment 2 names the hash of segment 1", seg2!.prev_sha256 === p1.sha256, p1.sha256.slice(0, 12));
      const [seg1] = await w.sql`select body from books.proofs where n = 1`;
      check("segment 1 carries the fills and the reconciliation", (seg1!.body as { fills: unknown[]; reconciliation: { ok: boolean } | null }).fills.length === 6 && (seg1!.body as { reconciliation: { ok: boolean } | null }).reconciliation?.ok === true, "6 fills, ok");
      await w.sql`update books.proofs set body = jsonb_set(body, '{balances,exp:fees}', '1') where n = 1`;
      const v2 = await verifyProofs(w.sql);
      check("a tampered segment is found", !v2.ok && v2.bad === 1, `bad segment ${v2.bad}`);
      check("the proof hash is on chain as a memo from the agent wallet", !!p1.memo_sig && w.chain.memosOf(p1.memo_sig).includes(`asimog:proof:${p1.sha256}`), String(p1.memo_sig).slice(0, 12));

      // 7. one lamport of drift: the hour fails, the kill switch trips, and the next order is refused
      w.chain.drift(w.wallets.trade, 1);
      const bad = await reconcile(w.sql, w.tape, w.chain, w.books, [w.wallets.trade], `${h1.slice(0, 11)}23:00:00Z`);
      check("1 lamport of drift fails reconciliation", bad?.ok === false && bad.wallets[0]!.chain_lamports - bad.wallets[0]!.ledger_lamports === 1, JSON.stringify(bad?.wallets));
      await w.settle();
      check("failed reconciliation trips the kill switch", (await killState(w.sql)) === "exit_only", "ops.kill exit_only");
      await w.intent("buy");
      await w.settle();
      const rej = (await w.topic("order.rejected")).filter((e) => e.body.reason_code === "kill_switch");
      check("no new order after the kill", rej.length === 1, `${rej.length} rejection with kill_switch`);
    } finally {
      await w.close();
    }
    return { checks, metrics: { fills: 6 } };
  },
};
