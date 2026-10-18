// Live wiring of hands and treasury (docs/09, 10, 15). Returns null unless the owner has set the trade wallet and a send
// endpoint, so a machine without keys runs exactly as before. Nothing here holds a key: signing is the Signer's job.
import path from "node:path";
import type { Clock } from "../lib/clock.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { FunBlock } from "../hands/builder.ts";
import { RpcChain } from "../hands/chain.ts";
import { orderGate } from "../hands/order-gate.ts";
import { HttpSigner } from "../hands/signer-client.ts";
import { trader } from "../hands/trader.ts";
import type { Consumer } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { books, hourOf, reconcile } from "./books.ts";
import { kill } from "./kill.ts";
import { publishProof } from "./proofs.ts";
import { sweep, sweepIdAt } from "./sweep.ts";

export type Treasury = { consumers: Consumer[]; start(): void; stop(): void };

export function treasuryWiring(sql: Sql, tape: Tape, clock: Clock): Treasury | null {
  const trade = env.opt("WALLET_TRADE");
  if (!trade || !env.opt("TX_SEND_URL")) return null;
  const chain = new RpcChain();
  const swapSigner = new HttpSigner(env.str("SIGNER_CLIENT_TOKEN_SWAP"));
  const treasurySigner = new HttpSigner(env.str("SIGNER_CLIENT_TOKEN_TREASURY"));
  const bk = books(tape, { trade });
  const tr = trader({ sql, tape, clock, chain, builder: new FunBlock(), swapSigner, wallet: trade });
  const consumers = [bk, { ...kill(tape, path.join(env.root, "artifacts", "KILL")), startAtHead: true }, orderGate(tape, clock, { trade }), tr];
  const timers: NodeJS.Timeout[] = [];
  const guard = (name: string, fn: () => Promise<unknown>) => () => void fn().catch((err) => {
    log.warn("treasury", { job: name, err: String(err).slice(0, 160) });
    if (String(err).includes("signer_refused")) // a refusal counts towards the kill trigger (docs/15)
      tape.emit("signer.refused", { job: name, reason: String(err).slice(0, 120).replace(/^Error: /, "") }, { source: "treasurer" });
  });
  const wallets = ["WALLET_TRADE", "WALLET_CREATOR", "WALLET_AGENT"].map((k) => env.opt(k)).filter((x): x is string => !!x);
  const creator = env.opt("WALLET_CREATOR");
  const agent = env.opt("WALLET_AGENT");
  const operator = env.opt("WALLET_OPERATOR");
  const mint = env.opt("COIN_MINT");
  return {
    consumers,
    start() {
      timers.push(setInterval(guard("trader.retry", () => tr.retry()), env.int("TRADER_RETRY_EVERY_MS", 2_000)));
      timers.push(setInterval(guard("reconcile", () => reconcile(sql, tape, chain, bk, wallets, hourOf(clock.iso()))), env.num("RECONCILE_EVERY_MIN", 60) * 60_000));
      if (creator && agent && operator && mint && env.opt("SIGNER_CLIENT_TOKEN_TREASURY")) {
        const deps = { tape, clock, chain, builder: new FunBlock(), signer: treasurySigner, wallets: { trade, creator, agent, operator }, mint, runwayLamports: () => Math.round(env.num("AGENT_RUNWAY_SOL", 0) * 1e9) };
        timers.push(setInterval(guard("sweep", () => sweep(deps, sweepIdAt(clock.now()))), env.num("SWEEP_EVERY_MIN", 10) * 60_000));
        timers.push(setInterval(guard("proof", () => publishProof({ sql, tape, chain, signer: treasurySigner, agent }, hourOf(new Date(clock.now() - 3_600_000).toISOString()))), 60 * 60_000));
      }
    },
    stop() {
      for (const t of timers) clearInterval(t);
    },
  };
}
