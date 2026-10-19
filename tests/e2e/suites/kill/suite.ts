// Kill state (docs/OPS.md, docs/SYSTEM.md 5.2 to 5.4) and the live leg, on a mocked chain: a live order exists only for a paper fill;
// halted stops everything, exit_only stops buys and lets exits run; the Signer reads the kill file on its own; a failed
// sell is retried until it closes; a confirm timeout never sends twice; resume needs the admin token.
import fs from "node:fs";
import { appendMemo } from "../../../../services/core/src/hands/builder.ts";
import { F } from "../../../../services/core/src/mind/fill.ts";
import { hourOf, reconcile } from "../../../../services/core/src/treasury/books.ts";
import { ownerKill, resume } from "../../../../services/core/src/treasury/kill.ts";
import type { Check } from "../../lib/checks.ts";
import { ATA_RENT } from "../../lib/mockchain.ts";
import type { Suite } from "../../lib/suite.ts";
import { type World, world } from "../../lib/world.ts";

const state = async (w: World) => {
  const [r] = await w.sql`select state, by from ops.kill where id = 1`;
  return { state: r!.state as string, by: r!.by as string | null };
};
const count = async (w: World, topic: string) => ((await w.sql`select count(*)::int n from tape.events where topic = ${topic}`)[0]!.n as number);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const suite: Suite = {
  name: "kill",
  tier: "fast",
  covers: ["services/core/src/treasury/kill.ts"],
  proves: "A live order exists only for a paper fill. halted stops every order and the Signer refuses on its own; exit_only refuses buys and lets exits close positions; only live events trip it; a failed sell is retried until it closes; a confirm timeout never sends twice; resume needs the admin token; the live gate is off by default.",
  async run() {
    const checks: Check[] = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
    const off = await world("kill-off", { live: false });
    const w = await world("kill");
    const directBuy = async () => {
      const built = await w.builder.swap({ side: "buy", mint: w.mint, wallet: w.wallets.trade, amount: "10000000", slippagePct: 3 });
      return w.swapSigner.sign("/sign/swap", appendMemo(built.tx, `asimog:direct${w.chain.next()}`), { max_lamports: 20_000_000, order_id: "direct" });
    };
    const fills = async () => (await w.topic("order.filled")).map((e) => e.body.side).join();
    check("the paper fill model charges the same token account rent as the chain", Math.round(F.rentSol * 1e9) === ATA_RENT, `${F.rentSol} SOL vs ${ATA_RENT} lamports`);
    try {
      // 0. default: nothing live, nothing happens
      await off.fund(off.wallets.trade, 0.2);
      await off.intent("buy");
      await off.settle();
      check("live gate off by default: an intent makes no order and no rejection", (await count(off, "order.created")) === 0 && (await count(off, "order.rejected")) === 0, "0 orders, 0 rejections");

      // 1. a live leg exists only for a paper fill
      await w.fund(w.wallets.trade, 0.2);
      await w.intent("buy", { ghost: false });
      await w.settle();
      check("a buy the paper desk did not fill never becomes a live order", (await count(w, "order.created")) === 0, `${await count(w, "order.created")} orders`);
      await w.intent("buy");
      const errors = await w.settle();
      await w.intent("sell");
      errors.push(...(await w.settle()));
      check("roundtrip: buy, sell, account closed", errors.length === 0 && (await fills()) === "buy,sell" && w.chain.tokensOf(w.wallets.trade, w.mint) === undefined, `${await fills()} ${errors.join(";")}`);

      // 2. owner kill: halted
      await w.intent("buy");
      await w.settle();
      ownerKill(w.tape, "test", w.killFile);
      check("ctl kill writes the Signer's file before core sees the event", fs.readFileSync(w.killFile, "utf8") === "halted", "file says halted");
      await w.settle();
      let s = await state(w);
      check("owner kill: halted", s.state === "halted" && s.by === "owner", JSON.stringify(s));
      await w.intent("buy");
      await w.intent("sell");
      await w.settle();
      const rej = (await w.topic("order.rejected")).filter((e) => e.body.reason_code === "kill_switch");
      check("halted: a new buy and a sell are both rejected", rej.length === 2 && (await count(w, "order.created")) === 3, `${rej.length} rejections, ${await count(w, "order.created")} orders`);
      const d1 = await directBuy();
      check("halted: the Signer refuses on its own", !d1.ok && d1.reason === "kill_switch", d1.ok ? "signed" : d1.reason);
      const sendsBefore = w.chain.sends;
      w.tape.emit("order.created", { order_id: "or_pending", intent_id: "in_pending", strategy_id: "sr_live", mint: w.mint, side: "buy", size_sol: 0.01, fraction: null, max_slippage_bps: 300, limits_version: 0 }, { source: "riskgate.live", subject: "or_pending" });
      await w.settle();
      const failed = (await w.topic("order.failed")).filter((e) => e.body.order_id === "or_pending");
      check("a pending buy is failed as killed and nothing is sent", failed.length === 1 && failed[0]!.body.error === "killed" && failed[0]!.body.retryable === false && w.chain.sends === sendsBefore, `${failed[0]?.body.error}, sends +${w.chain.sends - sendsBefore}`);
      const trades = await count(w, "trade.curve");
      w.tape.emit("trade.curve", { mint: w.mint, tx: "during-kill", slot_index_id: null, ts: w.clock.iso(), side: "buy", wallet: w.wallets.creator, sol: 1, usd: null, tokens: 1, price_sol: 4e-8, price_usd: null, mcap_usd: null, on_curve: true, program: null, pool_sol: null }, { source: "nats", subject: w.mint });
      await w.settle();
      check("senses keep recording while killed", (await count(w, "trade.curve")) === trades + 1, "trade written during the kill");

      // 3. resume needs the admin token
      let bad = 0;
      for (const t of [undefined, "wrong"]) try { resume(w.tape, t, "admin-secret"); } catch { bad++; }
      check("resume refuses a missing or wrong admin token", bad === 2, `${bad} of 2 refused`);
      resume(w.tape, "admin-secret", "admin-secret", w.killFile);
      await w.settle();
      s = await state(w);
      check("resume with the token: running, kill file removed", s.state === "running" && !fs.existsSync(w.killFile), JSON.stringify(s));
      const resumeNow = async () => {
        resume(w.tape, "admin-secret", "admin-secret", w.killFile);
        await w.settle();
      };

      // 4. exit_only from a live trigger, with the position from step 2 still open
      w.tape.emit("order.rejected", { intent_id: "in_p", reason_code: "daily_loss_stop", detail: "a paper strategy lost 0.05 SOL today" }, { source: "riskgate.paper", subject: "in_p" });
      await w.settle();
      check("a paper strategy's daily loss stop leaves the firm running", (await state(w)).state === "running", JSON.stringify(await state(w)));
      w.tape.emit("order.rejected", { intent_id: "in_x", reason_code: "daily_loss_stop", detail: "lost 0.05 SOL today" }, { source: "riskgate.live", subject: "in_x" });
      await w.settle();
      s = await state(w);
      check("trigger: a live daily loss stop moves to exit_only", s.state === "exit_only" && s.by === "daily_loss" && fs.readFileSync(w.killFile, "utf8") === "exit_only", JSON.stringify(s));
      await w.intent("buy");
      await w.settle();
      check("exit_only: a new buy is rejected", (await w.topic("order.rejected")).filter((e) => e.body.reason_code === "kill_switch").length === 3, "3 kill_switch rejections in all");
      const d2 = await directBuy();
      check("exit_only: the Signer refuses a buy on its own", !d2.ok && d2.reason === "kill_switch", d2.ok ? "signed" : d2.reason);
      await w.intent("sell");
      const sellErrors = await w.settle();
      check("exit_only: an exit passes and closes the open position", sellErrors.length === 0 && (await fills()) === "buy,sell,buy,sell" && w.chain.tokensOf(w.wallets.trade, w.mint) === undefined, `${await fills()} ${sellErrors.join(";")}`);
      await resumeNow();

      // 5. a confirm timeout never sends twice; a failed sell is retried until it closes
      await w.intent("buy");
      await w.settle();
      w.chain.confirmDrops = 2;
      const sends0 = w.chain.sends;
      await w.intent("sell");
      await w.settle(1);
      check("a confirm timeout leaves the sell submitted with its signature committed", (await w.sql`select 1 from hands.orders where state = 'submitted' and tx_sig is not null`).length === 1, "1 submitted order");
      await w.settle();
      check("the stored signature is confirmed later and never sent twice", (await fills()) === "buy,sell,buy,sell,buy,sell" && w.chain.sends - sends0 === 2, `${await fills()}, sends +${w.chain.sends - sends0} (sell and close)`);
      await w.intent("buy");
      await w.settle();
      const realSim = w.chain.simulate.bind(w.chain);
      let simFails = 1;
      w.chain.simulate = async (b64: string, wallet: string) => (simFails-- > 0 ? { err: "BlockhashNotFound", sol_delta: 0 } : realSim(b64, wallet));
      await w.intent("sell");
      await w.settle();
      const retrying = await w.sql`select attempts from hands.orders where state = 'retry'`;
      check("a sell that fails is scheduled for another attempt", retrying.length === 1 && retrying[0]!.attempts === 1, `${retrying.length} retrying`);
      await sleep(2_100);
      await w.settle();
      w.chain.simulate = realSim;
      check("the retried sell fills and the position closes", (await fills()).split(",").length === 8 && (await fills()).endsWith("buy,sell") && w.chain.tokensOf(w.wallets.trade, w.mint) === undefined, await fills());

      // 6. the other automatic triggers, each from running
      const fail = (n: number) => w.tape.emit("order.failed", { order_id: `or_f${n}`, tx_sig: null, error: "signer_refused:over_cap", retryable: false }, { source: "trader", subject: `or_f${n}` });
      fail(1);
      fail(2);
      await w.settle();
      check("trigger: two signer refusals do not trip it", (await state(w)).state === "running", JSON.stringify(await state(w)));
      fail(3);
      await w.settle();
      s = await state(w);
      check("trigger: three signer refusals in 10 minutes", s.state === "exit_only" && s.by === "signer_refusals", JSON.stringify(s));
      await resumeNow();

      const gap = (min: number) => w.tape.emit("system.gap", { source: "feed", scope: null, from: new Date(w.clock.now() - min * 60_000).toISOString(), to: w.clock.iso(), reason: "test" }, { source: "system" });
      gap(6);
      await w.settle();
      check("trigger: feed gap with no positions open does nothing", (await state(w)).state === "running", "running");
      await w.intent("buy");
      await w.settle();
      gap(2);
      await w.settle();
      check("trigger: a 2 minute gap with a position open does nothing", (await state(w)).state === "running", "running");
      gap(6);
      await w.settle();
      s = await state(w);
      check("trigger: feed gap of 6 minutes with a position open", s.state === "exit_only" && s.by === "feed_gap", JSON.stringify(s));
      await resumeNow();

      w.tape.emit("ops.stop_requested", { action: "pause", scope: "all", reason: "test stop" }, { source: "agents", subject: "all" });
      await w.settle();
      s = await state(w);
      check("the Ops agent's stop request moves to exit_only", s.state === "exit_only" && s.by === "ops_stop", JSON.stringify(s));
      await resumeNow();

      w.chain.drift(w.wallets.trade, 7);
      await reconcile(w.sql, w.tape, w.chain, w.books, [w.wallets.trade], hourOf(w.clock.iso()));
      await w.settle();
      s = await state(w);
      check("trigger: ledger and chain differ", s.state === "exit_only" && s.by === "books", JSON.stringify(s));
      const [changes] = await w.sql`select count(*)::int n from tape.events where topic = 'kill.changed'`;
      check("every kill and resume is on the Tape with its cause", changes!.n >= 11, `${changes!.n} kill.changed events`);
    } finally {
      await off.close();
      await w.close();
    }
    return { checks, metrics: {} };
  },
};
