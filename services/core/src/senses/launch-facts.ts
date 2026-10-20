// Launch facts (docs/PIPELINE.md section 2, docs/tasks/B3.md): each fact has an ordered list of sources.
// NATS is the door and answers first. The RPC pool supplies what NATS does not carry; pump.fun HTTP is the last
// resort and never the only source. The source that answered is recorded with the value. RPC is read only for a
// coin that already passed the free checks and is about to be watched.
import type { Trade } from "@asimog/contracts";
import { slotOf } from "../index/rollup.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { RpcPool } from "../lib/rpc.ts";
import { bondingCurvePda, tradesFromLogs } from "./backfill.ts";
import { pumpGet } from "./pump-http.ts";

export type FactName = "creator" | "dev_buy" | "block0_snipers" | "bundle";
export type FactSource = "nats" | "rpc" | "pump";
export type NatsView = {
  from_birth: boolean;
  creator: string | null;
  curve_account: string | null;
  created_ms: number | null;
  dev_buy_sol: number | null;
  block0_sniper_share: number | null;
  bundle_share: number | null;
};
export type ResolvedLaunch = {
  from_birth: boolean;
  creator: string | null;
  curve_account: string | null;
  created_ms: number | null;
  dev_buy_sol: number | null;
  block0_sniper_share: number | null;
  bundle_share: number | null;
  sources: Record<FactName, FactSource | null>;
};

type Sig = { signature: string; slot: number; err: unknown; blockTime: number | null };
const SIG_PAGE = 1000; // the RPC maximum
type Tx = { meta?: { logMessages?: string[] | null; feePayer?: string } | null; transaction?: { message?: { accountKeys?: ({ pubkey: string } | string)[] } } };

export class LaunchFacts {
  private cache = new Map<string, ResolvedLaunch>();
  stats = { nats: 0, rpc: 0, pump: 0, none: 0 };

  constructor(private rpc: RpcPool | null, private allowPump = true) {}

  /** NATS first; only a fact it cannot answer moves down the list. */
  async resolve(mint: string, nats: NatsView): Promise<ResolvedLaunch> {
    const hit = this.cache.get(mint);
    if (hit) return hit;
    const out: ResolvedLaunch = {
      from_birth: nats.from_birth,
      creator: nats.creator,
      curve_account: nats.curve_account,
      created_ms: nats.created_ms,
      dev_buy_sol: nats.from_birth ? nats.dev_buy_sol : null,
      block0_sniper_share: nats.from_birth ? nats.block0_sniper_share : null,
      bundle_share: nats.from_birth ? nats.bundle_share : null,
      sources: {
        creator: nats.creator ? "nats" : null,
        dev_buy: nats.from_birth ? "nats" : null,
        block0_snipers: nats.from_birth ? "nats" : null,
        bundle: nats.from_birth ? "nats" : null,
      },
    };
    if (!out.creator || out.dev_buy_sol === null || out.block0_sniper_share === null) {
      const chain = await this.chain(mint, out.curve_account);
      if (chain) {
        if (!out.creator && chain.creator) (out.creator = chain.creator), (out.sources.creator = "rpc");
        if (!out.curve_account && chain.curve_account) out.curve_account = chain.curve_account;
        if (!out.created_ms && chain.created_ms) out.created_ms = chain.created_ms;
        if (out.dev_buy_sol === null && chain.dev_buy_sol !== null) (out.dev_buy_sol = chain.dev_buy_sol), (out.sources.dev_buy = "rpc");
        if (out.block0_sniper_share === null && chain.block0_sniper_share !== null) (out.block0_sniper_share = chain.block0_sniper_share), (out.sources.block0_snipers = "rpc");
      }
    }
    if (!out.creator || out.dev_buy_sol === null) {
      const api = await this.pumpCoin(mint);
      if (api) {
        if (!out.creator && api.creator) (out.creator = api.creator), (out.sources.creator = "pump");
        if (!out.curve_account && api.curve_account) out.curve_account = api.curve_account;
        if (!out.created_ms && api.created_ms) out.created_ms = api.created_ms;
        if (out.dev_buy_sol === null && api.dev_buy_sol !== null) (out.dev_buy_sol = api.dev_buy_sol), (out.sources.dev_buy = "pump");
      }
    }
    if (!out.sources.creator) this.stats.none++;
    else this.stats[out.sources.creator]++;
    if (out.sources.creator) this.cache.set(mint, out); // a failed resolve is asked again next time
    if (this.cache.size > 5_000) this.cache.delete(this.cache.keys().next().value!);
    return out;
  }

  /** The creation transaction: the oldest signature on the curve account, then its logs. */
  private async chain(mint: string, curve: string | null): Promise<{
    creator: string | null; curve_account: string | null; created_ms: number | null; dev_buy_sol: number | null; block0_sniper_share: number | null;
  } | null> {
    if (!this.rpc) return null;
    try {
      // the curve account is a pump program PDA of the mint, so it is known even when newCoinCreated was missed
      const curveAccount = curve ?? bondingCurvePda(mint).toBase58();
      // newest first: page back with `before` to the true oldest; a curve busier than the page budget stays unknown, never a wrong tx
      let oldest: Sig | undefined;
      let before: string | undefined;
      for (let page = 0; ; page++) {
        if (page === env.int("LAUNCH_SIG_PAGES")) return null;
        const sigs = await this.rpc.call<Sig[]>("getSignaturesForAddress", [curveAccount, { limit: SIG_PAGE, commitment: "confirmed", ...(before ? { before } : {}) }]);
        oldest = sigs.filter((s) => !s.err).at(-1) ?? oldest;
        if (sigs.length < SIG_PAGE) break;
        before = sigs.at(-1)!.signature;
      }
      if (!oldest) return null;
      const tx = await this.rpc.call<Tx | null>("getTransaction", [oldest.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 }]);
      if (!tx?.meta?.logMessages) return null;
      const keys = tx.transaction?.message?.accountKeys ?? [];
      const creator = tx.meta.feePayer ?? (typeof keys[0] === "string" ? keys[0] : keys[0]?.pubkey) ?? null;
      const trades = tradesFromLogs(mint, oldest.signature, oldest.slot, tx.meta.logMessages);
      const buySol = trades.filter((t) => t.side === "buy").reduce((a, t) => a + t.sol, 0);
      const dev = trades.filter((t) => t.side === "buy" && t.wallet === creator).reduce((a, t) => a + t.sol, 0);
      const block0 = trades.filter((t) => t.side === "buy" && t.wallet !== creator && slotOf(t.slot_index_id) === oldest.slot).reduce((a, t) => a + t.sol, 0);
      return {
        creator,
        curve_account: curveAccount,
        created_ms: oldest.blockTime ? oldest.blockTime * 1000 : null,
        dev_buy_sol: dev,
        block0_sniper_share: buySol > 0 ? block0 / buySol : null,
      };
    } catch (err) {
      log.warn("launch facts rpc", { mint, err: String(err).slice(0, 160) });
      return null;
    }
  }

  /** The pump.fun coin lookup, last resort. A resting path is skipped by pumpGet's own backoff. */
  private async pumpCoin(mint: string): Promise<{ creator: string | null; curve_account: string | null; created_ms: number | null; dev_buy_sol: number | null } | null> {
    if (!this.allowPump) return null;
    try {
      const r = await pumpGet<Record<string, unknown>>(`/coins-v3/${mint}`, { includeLiveStreamInfo: "false" });
      if (r.status !== 200 || !r.body) return null;
      const b = r.body;
      const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : null);
      const created = b.created_timestamp ?? b.createdAt;
      return {
        creator: str("creator") ?? str("creatorAddress"),
        curve_account: str("bonding_curve") ?? str("bondingCurve"),
        created_ms: typeof created === "number" ? (created < 1e12 ? created * 1000 : created) : null,
        dev_buy_sol: null,
      };
    } catch (err) {
      log.warn("launch facts pump", { mint, err: String(err).slice(0, 160) });
      return null;
    }
  }
}

/** Recompute the chain facts from the trades Backfill read, for the post-promotion recheck. */
export function factsFromTrades(trades: Trade[], creator: string | null, firstSlot: number | null): { dev_buy_sol: number; block0_sniper_share: number | null } {
  const buys = trades.filter((t) => t.side === "buy");
  const buySol = buys.reduce((a, t) => a + t.sol, 0);
  const dev = buys.filter((t) => t.wallet === creator).reduce((a, t) => a + t.sol, 0);
  const first = firstSlot ?? (trades[0] ? slotOf(trades[0].slot_index_id) : null);
  const block0 = buys.filter((t) => t.wallet !== creator && slotOf(t.slot_index_id) === first).reduce((a, t) => a + t.sol, 0);
  return { dev_buy_sol: dev, block0_sniper_share: buySol > 0 ? block0 / buySol : null };
}
