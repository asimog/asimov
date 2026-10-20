// Chain Reader (docs/PIPELINE.md): trades for the watched set from pump.fun NATS.
// Watched set = coins called or promoted by the Scout in the last WATCH_HOURS (capped at WATCH_MAX_COINS), refreshed
// every 15 s; a Scout promotion subscribes at once (watchNow).

import type { Trade } from "@asimog/contracts";
import type { NatsConnection, Subscription } from "@nats-io/nats-core";
import { isoOrNull } from "../lib/clock.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { Tape } from "../tape/tape.ts";
import { consume, decodeJson, natsConnect } from "./nats.ts";

type Lite = {
  mint: string; tx: string; slotIndexId?: string; userAddress: string; type: "buy" | "sell";
  baseAmount?: string; amountSol?: string; amountUsd?: string; priceUsd?: string; priceSol?: string; marketCap?: string; timestamp: string;
};
type Processed = Lite & { mintAddress: string; program?: string; isBondingCurve?: boolean; marketCapUsd?: string; quoteReserves?: string };

const subject = (mint: string) => `unifiedTradeEvent.processed.${mint}`;
const n = (s: string | undefined | null) => {
  const x = s == null || s === "" ? Number.NaN : Number(s);
  return Number.isFinite(x) ? x : null; // a malformed amount is unknown, never NaN that poisons flow
};

/** One key for one trade whichever sense saw it, so NATS and the RPC backfill never both write it (fix plan 3.14). */
export const tradeKey = (t: { tx: string; wallet: string; side: string; tokens: number | null }) => `trade:${t.tx}:${t.wallet}:${t.side}:${t.tokens ?? ""}`;

export function toTrade(p: Partial<Processed>): Trade | null {
  const mint = p.mint ?? p.mintAddress;
  const ts = isoOrNull(p.timestamp);
  if (!mint || !p.tx || !p.userAddress || !p.type || !ts) return null;
  const sol = n(p.amountSol);
  if (sol == null) return null;
  return {
    mint,
    tx: p.tx,
    slot_index_id: p.slotIndexId ?? null,
    ts,
    side: p.type,
    wallet: p.userAddress,
    sol,
    usd: n(p.amountUsd),
    tokens: n(p.baseAmount),
    price_sol: n(p.priceSol),
    price_usd: n(p.priceUsd),
    mcap_usd: n(p.marketCapUsd ?? p.marketCap),
    on_curve: p.isBondingCurve ?? (p.program ? p.program === "pump" : null),
    program: p.program ?? null,
    pool_sol: p.isBondingCurve === false ? n(p.quoteReserves) : null,
  };
}

export class ChainReader {
  private nc: NatsConnection | null = null;
  private subs = new Map<string, Subscription>();
  private leftAt = new Map<string, number>(); // mint -> when it left the watched set (its gap is open)
  private stopped = false;
  stats = { trades: 0, watched: 0 };

  /** `onWatch(mint)` runs when a coin enters the watched set (the Backfill reads its history). */
  constructor(private tape: Tape, private sql: Sql, private onWatch: (mint: string) => void = () => {}) {}

  async start() {
    this.nc = await natsConnect("trades", () => this.tape.clock.now(), (from, to) => this.gap(null, from, to, "NATS trades connection dropped"));
    void this.watchLoop();
  }

  async stop() {
    this.stopped = true;
    await this.nc?.close();
  }

  watched(): string[] {
    return [...this.subs.keys()];
  }

  isWatched(mint: string) {
    return this.subs.has(subject(mint));
  }

  /** A Scout promotion: subscribe now instead of at the next refresh. Returns false when already watched. */
  watchNow(mint: string) {
    if (!this.nc || this.isWatched(mint)) return false;
    this.listen(subject(mint));
    this.stats.watched = this.subs.size;
    return true;
  }

  /** The Scout's chain recheck dropped a coin: stop its stream now; the watch loop will not re-add it once memory clears. */
  unwatch(mint: string) {
    const s = subject(mint);
    this.subs.get(s)?.unsubscribe();
    this.subs.delete(s);
    this.leftAt.set(mint, this.tape.clock.now());
    this.stats.watched = this.subs.size;
  }

  private listen(subject: string) {
    const sub = this.nc!.subscribe(subject);
    this.subs.set(subject, sub);
    const mint = subject.split(".").at(-1)!;
    const left = this.leftAt.get(mint);
    if (left !== undefined) {
      this.leftAt.delete(mint);
      this.gap(mint, left, this.tape.clock.now(), "coin back in the watched set: the gap is closed");
    }
    this.onWatch(mint);
    void consume(sub, (_s, data) => this.onTrade(decodeJson(data) as Partial<Processed>));
  }

  private onTrade(p: Partial<Processed>) {
    const t = toTrade(p);
    if (!t) return;
    this.stats.trades++;
    this.tape.emit(t.on_curve === false ? "trade.amm" : "trade.curve", t, {
      source: "nats",
      subject: t.mint,
      eventTime: t.ts,
      dedupe: tradeKey(t),
    });
  }

  private gap(scope: string | null, fromMs: number, toMs: number | null, reason: string) {
    const to = toMs == null ? null : new Date(toMs).toISOString();
    this.tape.emit("system.gap", { source: "trades", scope, from: new Date(fromMs).toISOString(), to, reason }, { source: "nats", subject: scope });
  }

  private async watchLoop() {
    while (!this.stopped) {
      try {
        const hours = env.num("WATCH_HOURS");
        // coins called or promoted in the window, most recent first; a coin called again comes back
        const rows = await this.sql`
          select mint, max(at) at from (
            select mint, seen_at at from mem.callouts where seen_at > now() - make_interval(hours => ${hours})
            union all select mint, watched_at from mem.coins where watched_at > now() - make_interval(hours => ${hours})) x
          group by mint order by at desc limit ${env.int("WATCH_MAX_COINS")}`;
        const want = new Set(rows.map((r) => subject(r.mint as string)));
        for (const [s, sub] of this.subs)
          if (!want.has(s)) {
            sub.unsubscribe();
            this.subs.delete(s);
            const mint = s.split(".").at(-1)!;
            this.leftAt.set(mint, this.tape.clock.now());
            this.gap(mint, this.tape.clock.now(), null, "coin left the watched set");
          }
        for (const s of want) if (!this.subs.has(s)) this.listen(s);
        this.stats.watched = this.subs.size;
      } catch (err) {
        log.warn("watch loop", { err: String(err) });
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}
