// Kill switch (docs/15): a live roundtrip works; the owner's kill and each automatic trigger stop new orders and pending
// orders, the Signer refuses swaps on its own, senses keep recording; resume needs the admin token. Mocked chain.
import fs from "node:fs";
import { ownerKill, resume } from "../../../../services/core/src/treasury/kill.ts";
import { reconcile, hourOf } from "../../../../services/core/src/treasury/books.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";
import { world, type World } from "../../lib/world.ts";

const state = async (w: World) => {
  const [r] = await w.sql`select on_, by from ops.kill where id = 1`;
  return { on: r!.on_ as boolean, by: r!.by as string | null };
};
const count = async (w: World, topic: string) => ((await w.sql`select count(*)::int n from tape.events where topic = ${topic}`)[0]!.n as number);

export const suite: Suite = {
  name: "kill",
  proves: "The owner's kill and every automatic trigger stop new and pending orders while senses keep recording; the Signer refuses swaps by itself; resume needs the admin token; the live gate is off by default.",
  async run() {
    const checks: Check[] = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
    const off = await world("kill-off", { live: false });
    const w = await world("kill");
    try {
      // 0. default: nothing live, nothing happens
      await off.fund(off.wallets.trade, 0.2);
      await off.intent("buy");
      await off.settle();
      check("live gate off by default: an intent makes no order and no rejection", (await count(off, "order.created")) === 0 && (await count(off, "order.rejected")) === 0, "0 orders, 0 rejections");

      // 1. roundtrip before any kill
      await w.fund(w.wallets.trade, 0.2);
      await w.intent("buy");
      const errors = await w.settle();
      await w.intent("sell");
      errors.push(...(await w.settle()));
      const filled = (await w.topic("order.filled")).map((e) => e.body.side);
      check("roundtrip before the kill: buy, sell, account closed", errors.length === 0 && filled.join() === "buy,sell" && w.chain.tokensOf(w.wallets.trade, w.mint) === undefined, `${filled.join()} ${errors.join(";")}`);

      // 2. owner kill
      ownerKill(w.tape, "test");
      await w.settle();
      let s = await state(w);
      check("owner kill: state on, kill file written", s.on && s.by === "owner" && fs.existsSync(w.killFile), JSON.stringify(s));
      await w.intent("buy");
      await w.settle();
      const rej = (await w.topic("order.rejected")).filter((e) => e.body.reason_code === "kill_switch");
      check("a new buy is rejected with kill_switch and makes no order", rej.length === 1 && (await count(w, "order.created")) === 2, `${rej.length} rejection, ${await count(w, "order.created")} orders in all`);
      await w.intent("sell");
      await w.settle();
      check("exits are stopped too (kill stops all hands)", (await w.topic("order.rejected")).filter((e) => e.body.reason_code === "kill_switch").length === 2, "2 kill_switch rejections");
      const built = await w.builder.swap({ side: "buy", mint: w.mint, wallet: w.wallets.trade, amount: "10000000", slippagePct: 3 });
      const direct = await w.swapSigner.sign("/sign/swap", (await import("../../../../services/core/src/hands/builder.ts")).appendMemo(built.tx, "asimog:direct"), { max_lamports: 20_000_000, order_id: "direct" });
      check("the Signer refuses swaps on its own while killed", !direct.ok && direct.reason === "kill_switch", direct.ok ? "signed" : direct.reason);
      // a pending order that was created just before the kill is failed, not sent
      const sendsBefore = w.chain.sends;
      w.tape.emit("order.created", { order_id: "or_pending", intent_id: "in_pending", strategy_id: "sr_live", mint: w.mint, side: "buy", size_sol: 0.01, fraction: null, max_slippage_bps: 300, limits_version: 0 }, { source: "riskgate", subject: "or_pending" });
      await w.settle();
      const failed = (await w.topic("order.failed")).filter((e) => e.body.order_id === "or_pending");
      check("a pending order is failed as killed and nothing is sent", failed.length === 1 && failed[0]!.body.error === "killed" && failed[0]!.body.retryable === false && w.chain.sends === sendsBefore, `${failed[0]?.body.error}, sends +${w.chain.sends - sendsBefore}`);
      const trades = await count(w, "trade.curve");
      w.tape.emit("trade.curve", { mint: w.mint, tx: "during-kill", slot_index_id: null, ts: w.clock.iso(), side: "buy", wallet: w.wallets.creator, sol: 1, usd: null, tokens: 1, price_sol: 4e-8, price_usd: null, mcap_usd: null, on_curve: true, program: null }, { source: "nats", subject: w.mint });
      await w.settle();
      check("senses keep recording while killed", (await count(w, "trade.curve")) === trades + 1, "trade written during the kill");

      // 3. resume needs the admin token
      let bad = 0;
      for (const t of [undefined, "wrong"]) try { resume(w.tape, t, "admin-secret"); } catch { bad++; }
      check("resume refuses a missing or wrong admin token", bad === 2, `${bad} of 2 refused`);
      resume(w.tape, "admin-secret", "admin-secret");
      await w.settle();
      s = await state(w);
      check("resume with the token: state off, kill file removed", !s.on && !fs.existsSync(w.killFile), JSON.stringify(s));
      await w.intent("buy");
      await w.settle();
      check("orders flow again after resume", (await w.topic("order.filled")).length === 3, `${(await w.topic("order.filled")).length} fills`);
      await w.intent("sell");
      await w.settle();

      // 4. each automatic trigger, from a clean state
      const resumeNow = async () => {
        resume(w.tape, "admin-secret", "admin-secret");
        await w.settle();
      };
      w.tape.emit("order.rejected", { intent_id: "in_x", reason_code: "daily_loss_stop", detail: "lost 0.05 SOL today" }, { source: "riskgate", subject: "in_x" });
      await w.settle();
      s = await state(w);
      check("trigger: daily loss stop", s.on && s.by === "daily_loss", JSON.stringify(s));
      await resumeNow();

      const fail = (n: number) => w.tape.emit("order.failed", { order_id: `or_f${n}`, tx_sig: null, error: "signer_refused:over_cap", retryable: false }, { source: "trader", subject: `or_f${n}` });
      fail(1);
      fail(2);
      await w.settle();
      s = await state(w);
      check("trigger: two signer refusals do not trip it", !s.on, JSON.stringify(s));
      fail(3);
      await w.settle();
      s = await state(w);
      check("trigger: three signer refusals in 10 minutes", s.on && s.by === "signer_refusals", JSON.stringify(s));
      await resumeNow();

      const gap = (min: number) => w.tape.emit("system.gap", { source: "feed", scope: null, from: new Date(w.clock.now() - min * 60_000).toISOString(), to: w.clock.iso(), reason: "test" }, { source: "system" });
      gap(6);
      await w.settle();
      check("trigger: feed gap with no positions open does nothing", !(await state(w)).on, "off");
      await w.intent("buy");
      await w.settle();
      gap(2);
      await w.settle();
      check("trigger: a 2 minute gap with a position open does nothing", !(await state(w)).on, "off");
      gap(6);
      await w.settle();
      s = await state(w);
      check("trigger: feed gap of 6 minutes with a position open", s.on && s.by === "feed_gap", JSON.stringify(s));
      await resumeNow();

      w.chain.drift(w.wallets.trade, 7);
      await reconcile(w.sql, w.tape, w.chain, w.books, [w.wallets.trade], hourOf(w.clock.iso()));
      await w.settle();
      s = await state(w);
      check("trigger: ledger and chain differ", s.on && s.by === "books", JSON.stringify(s));
      const [changes] = await w.sql`select count(*)::int n from tape.events where topic = 'kill.changed'`;
      check("every kill and resume is on the Tape with its cause", changes!.n >= 9, `${changes!.n} kill.changed events`);
    } finally {
      await off.close();
      await w.close();
    }
    return { checks, metrics: {} };
  },
};
