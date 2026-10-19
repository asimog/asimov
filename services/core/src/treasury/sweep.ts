// Fee sweep (docs/EXECUTION.md), every 10 minutes: collect creator fees, measure what arrived, split 50% to W_trade (base capital,
// never profit), the rest to W_agent up to its runway room and then W_operator. Idempotent by sweep id: the memos
// `asimog:<id>:collect` and `asimog:<id>:split` are searched on chain before anything is sent again.

import { appendMemo, type Builder, LAMPORTS, transfersTx } from "../hands/builder.ts";
import type { Chain, Parsed } from "../hands/chain.ts";
import type { SignerClient } from "../hands/signer-client.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import type { Tape } from "../tape/tape.ts";

export type SweepDeps = {
  tape: Tape;
  clock: Clock;
  chain: Chain;
  builder: Builder;
  signer: SignerClient; // cap:sign.treasury
  wallets: { trade: string; creator: string; agent: string; operator: string };
  mint: string;
  /** SOL the agent wallet should hold: 30 days of measured running costs (docs/EXECUTION.md) */
  runwayLamports: () => number;
};

const SPLIT_RESERVE = () => env.int("SWEEP_FEE_RESERVE_LAMPORTS"); // the creator wallet pays the split's fee out of what it collected
export const sweepIdAt = (ms: number) => `sp_${Math.floor(ms / (env.num("SWEEP_EVERY_MIN") * 60_000))}`;

async function once(d: SweepDeps, memo: string, make: () => Promise<{ tx: string; endpoint: string; ctx: object } | null>): Promise<Parsed | null> {
  const have = await d.chain.findByMemo(d.wallets.creator, memo);
  if (have) return d.chain.confirm(have, 10_000);
  const m = await make();
  if (!m) return null;
  const signed = await d.signer.sign(m.endpoint, m.tx, m.ctx);
  if (!signed.ok) throw new Error(`signer_refused:${signed.reason}`);
  return d.chain.confirm(await d.chain.send(signed.signed), env.int("TRADER_CONFIRM_MS"));
}

export async function sweep(d: SweepDeps, id = sweepIdAt(d.clock.now())) {
  const { tape, wallets: w } = d;
  const empty = { sweep_id: id, collect_sig: null, split_sig: null, collected_lamports: 0, to_trade_lamports: 0, to_agent_lamports: 0, to_operator_lamports: 0 };
  let collect: Parsed | null = null;
  try {
    collect = await once(d, `asimog:${id}:collect`, async () => {
      const built = await d.builder.collectFees({ mint: d.mint, user: w.creator });
      return { tx: appendMemo(built.tx, `asimog:${id}:collect`), endpoint: "/sign/collect-fees", ctx: { mint: d.mint } };
    });
  } catch (err) {
    if (String(err).includes("signer_refused")) throw err; // refusals count towards the kill trigger; the caller reports them
    collect = null; // the API had nothing to build or the send failed: record 0 and wait for the next sweep
  }
  if (!collect || collect.err) return finish(d, { ...empty });
  const delta = collect.lamports[w.creator] ?? 0;
  const gross = delta + collect.fee;
  tape.emit("ledger.entry", { entry_id: `sweep:${id}:collect`, kind: "sweep_collect", tx_sig: collect.sig, legs: [{ account: `sol:${w.creator}`, lamports: delta }, { account: "exp:fees", lamports: collect.fee }, { account: "inc:creator_fees", lamports: -gross }] }, { source: "treasurer", dedupe: `ledger:${id}:collect` });
  const total = delta - SPLIT_RESERVE();
  if (gross <= 0 || total <= 1) return finish(d, { ...empty, collect_sig: collect.sig, collected_lamports: Math.max(0, gross) });

  const room = Math.max(0, d.runwayLamports() - (await d.chain.balance(w.agent)));
  const toTrade = Math.floor(total / 2);
  const toAgent = Math.min(total - toTrade, room);
  const toOp = total - toTrade - toAgent;
  const split = await once(d, `asimog:${id}:split`, async () => ({
    tx: await transfersTx(d.chain, w.creator, [{ to: w.trade, lamports: toTrade }, { to: w.agent, lamports: toAgent }, { to: w.operator, lamports: toOp }], `asimog:${id}:split`),
    endpoint: "/sign/sweep-split",
    ctx: { total_lamports: total, agent_room_lamports: room },
  }));
  if (!split || split.err) return finish(d, { ...empty, collect_sig: collect.sig, collected_lamports: gross });
  const got = (k: string) => split.lamports[k] ?? 0;
  tape.emit("ledger.entry", {
    entry_id: `sweep:${id}:split`, kind: "sweep_split", tx_sig: split.sig,
    legs: [{ account: `sol:${w.creator}`, lamports: got(w.creator) }, { account: `sol:${w.trade}`, lamports: got(w.trade) }, { account: `sol:${w.agent}`, lamports: got(w.agent) }, { account: "ext:operator", lamports: got(w.operator) }, { account: "exp:fees", lamports: split.fee }].filter((l) => l.lamports !== 0),
  }, { source: "treasurer", dedupe: `ledger:${id}:split` });
  return finish(d, { sweep_id: id, collect_sig: collect.sig, split_sig: split.sig, collected_lamports: gross, to_trade_lamports: got(w.trade), to_agent_lamports: got(w.agent), to_operator_lamports: got(w.operator) });
}

async function finish(d: SweepDeps, body: { sweep_id: string; collect_sig: string | null; split_sig: string | null; collected_lamports: number; to_trade_lamports: number; to_agent_lamports: number; to_operator_lamports: number }) {
  d.tape.emit("fees.swept", body, { source: "treasurer", subject: body.sweep_id, dedupe: body.sweep_id });
  await d.tape.flush();
  return { ...body, collected_sol: body.collected_lamports / LAMPORTS };
}
