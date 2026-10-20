// Three fee sweeps (one empty) on the mocked chain: the split matches chain amounts to the lamport, base capital is not
// profit, the ledger still reconciles, and a sweep that crashed half way is finished without paying twice (docs/EXECUTION.md).

import { balances, hourOf, reconcile } from "../../../../services/core/src/treasury/books.ts";
import { type SweepDeps, sweep } from "../../../../services/core/src/treasury/sweep.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";
import { SOL, world } from "../../lib/world.ts";

export const suite: Suite = {
  name: "sweep",
  tier: "fast",
  covers: ["services/core/src/treasury/sweep.ts"],
  proves: "Three sweeps match chain amounts to the lamport; the 50/50 split and the agent runway cap hold; a half-landed sweep is resumed without a second payment; the books still reconcile.",
  async run() {
    const w = await world("sweep", { runwaySol: 0.3 }); // the Signer holds the same runway target as the Treasurer
    const checks: Check[] = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
    try {
      await w.fund(w.wallets.trade, 0.2);
      await w.fund(w.wallets.creator, 0.0001, "fund-creator");
      const operator = w.wallets.operator;
      const deps: SweepDeps = { tape: w.tape, clock: w.clock, chain: w.chain, builder: w.builder, signer: w.treasurySigner, wallets: { trade: w.wallets.trade, creator: w.wallets.creator, agent: w.wallets.agent, operator }, mint: w.mint, runwayLamports: () => 0.3 * SOL };
      const bal = (x: string) => w.chain.balance(x);

      // sweep 1: 1 SOL waiting
      w.chain.creatorVault = 1 * SOL;
      const t0 = await bal(w.wallets.trade);
      const c0 = await bal(w.wallets.creator);
      const s1 = await sweep(deps, "sp_1");
      const total1 = s1.collected_lamports - 5000 - 20_000; // collect fee 5000, split reserve 20000
      check("sweep 1 collected what the vault held", s1.collected_lamports === SOL, `${s1.collected_lamports} lamports`);
      check("sweep 1: half to the trade wallet, exactly", s1.to_trade_lamports === Math.floor(total1 / 2) && (await bal(w.wallets.trade)) - t0 === s1.to_trade_lamports, `${s1.to_trade_lamports} = floor(${total1}/2)`);
      check("sweep 1: agent filled to its runway (0.3 SOL), the rest to the operator", s1.to_agent_lamports === 0.3 * SOL && s1.to_operator_lamports === total1 - s1.to_trade_lamports - s1.to_agent_lamports && (await bal(operator)) === s1.to_operator_lamports, `agent ${s1.to_agent_lamports}, operator ${s1.to_operator_lamports}`);
      check("sweep 1: creator wallet keeps only the fee reserve", (await bal(w.wallets.creator)) === c0 + SOL - 5000 - total1 - 5000, `${await bal(w.wallets.creator)} lamports left`);

      // sweep 2: nothing to collect: record 0, no split, no estimates
      const sends = w.chain.sends;
      const s2 = await sweep(deps, "sp_2");
      check("sweep 2 (empty) records 0 and sends no split", s2.collected_lamports === 0 && s2.split_sig === null && w.chain.sends === sends + 1, `collected ${s2.collected_lamports}, sends +${w.chain.sends - sends}`);

      // sweep 3: 0.3 SOL, agent already at its runway: the whole non-trading half goes to the operator
      w.chain.creatorVault = 0.3 * SOL;
      const opBefore = await bal(operator);
      const s3 = await sweep(deps, "sp_3");
      const total3 = s3.collected_lamports - 5000 - 20_000;
      check("sweep 3: agent already full gets nothing", s3.to_agent_lamports === 0 && (await bal(w.wallets.agent)) === 0.3 * SOL, `agent ${await bal(w.wallets.agent)}`);
      check("sweep 3: operator gets the rest, trade gets half", s3.to_trade_lamports === Math.floor(total3 / 2) && (await bal(operator)) - opBefore === total3 - Math.floor(total3 / 2), `trade ${s3.to_trade_lamports}`);

      // fees.swept events match what the chain did
      await w.tape.flush();
      const events = (await w.topic("fees.swept")).map((e) => e.body as { sweep_id: string; collected_lamports: number; to_trade_lamports: number; to_agent_lamports: number; to_operator_lamports: number });
      check("three fees.swept events, one per sweep id", events.length === 3 && new Set(events.map((e) => e.sweep_id)).size === 3, events.map((e) => e.sweep_id).join(","));
      check("each sweep: collected - reserve - fees = trade + agent + operator", events.filter((e) => e.collected_lamports > 0).every((e) => e.to_trade_lamports + e.to_agent_lamports + e.to_operator_lamports === e.collected_lamports - 5000 - 20_000), "sums match");

      // half-landed sweep: the split lands, the confirmation is lost, the sweep throws; the next try finishes without paying again
      w.chain.creatorVault = 0.1 * SOL;
      w.chain.confirmThrowsFor = "asimog:sp_crash:split";
      const tBefore = await bal(w.wallets.trade);
      let crashed = false;
      try {
        await sweep(deps, "sp_crash");
      } catch {
        crashed = true;
      }
      const afterCrash = await bal(w.wallets.trade);
      const sendsBefore = w.chain.sends;
      const done = await sweep(deps, "sp_crash");
      const total4 = done.collected_lamports - 5000 - 20_000;
      check("the crash happened after the split landed", crashed && afterCrash - tBefore === Math.floor(total4 / 2), `trade +${afterCrash - tBefore}`);
      check("the retry sends nothing new", w.chain.sends === sendsBefore && (await bal(w.wallets.trade)) === afterCrash, `sends +${w.chain.sends - sendsBefore}`);
      check("the retry reports the amounts that landed", done.to_trade_lamports === afterCrash - tBefore && done.split_sig !== null, `${done.to_trade_lamports}`);

      // books: reconcile, base capital is not profit
      await w.settle();
      const rec = await reconcile(w.sql, w.tape, w.chain, w.books, [w.wallets.trade, w.wallets.creator, w.wallets.agent], hourOf(w.clock.iso()));
      check("ledger equals chain for trade, creator and agent wallets", rec?.ok === true, JSON.stringify(rec?.wallets.map((x) => [x.ledger_lamports, x.chain_lamports])));
      const b = await balances(w.sql);
      const gross = events.reduce((s, e) => s + e.collected_lamports, 0) + done.collected_lamports;
      check("creator fee income in the ledger equals everything collected", -(b["inc:creator_fees"] ?? 0) === gross, `${-(b["inc:creator_fees"] ?? 0)} vs ${gross}`);
      const [real] = await w.sql`select count(*)::int n from books.realized`;
      check("sweeps book no trading profit (base capital is not PnL)", real!.n === 0 && (b["pnl:trading"] ?? 0) === 0, `${real!.n} realized rows`);
      const [dups] = await w.sql`select count(*)::int n from (select body->>'sweep_id' s from tape.events where topic = 'fees.swept' group by 1 having count(*) > 1) x`;
      check("no sweep id recorded twice", dups!.n === 0, "unique");
    } finally {
      await w.close();
    }
    return { checks, metrics: {} };
  },
};
