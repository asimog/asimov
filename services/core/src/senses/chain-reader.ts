// Chain Reader (docs/06): trades for the watched set from pump.fun NATS.
// Watched set = coins with a callout in the last WATCH_HOURS (capped at WATCH_MAX_COINS), refreshed every 15 s.
// WATCH_ALL_TRADES=1 subscribes to the lite firehose instead (bigger machines only).
import type { NatsConnection, Subscription } from "@nats-io/nats-core";
import type { Trade } from "@asimog/contracts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { Tape } from "../tape/tape.ts";
import { consume, decodeJson, natsConnect } from "./nats.ts";

type Lite = {
  mint: string; tx: string; slotIndexId?: string; userAddress: string; type: "buy" | "sell";
  baseAmount?: string; amountSol?: string; amountUsd?: string; priceUsd?: string; priceSol?: string; marketCap?: string; timestamp: string;
};
type Processed = Lite & { mintAddress: string; program?: string; isBondingCurve?: boolean; marketCapUsd?: string };

const n = (s: string | undefined | null) => (s == null || s === "" ? null : Number(s));

export function toTrade(p: Partial<Processed>): Trade | null {
  const mint = p.mint ?? p.mintAddress;
  if (!mint || !p.tx || !p.userAddress || !p.type || !p.timestamp) return null;
  const sol = n(p.amountSol);
  if (sol == null) return null;
  return {
    mint,
    tx: p.tx,
    slot_index_id: p.slotIndexId ?? null,
    ts: new Date(p.timestamp).toISOString(),
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
  };
}

export class ChainReader {
  private nc: NatsConnection | null = null;
  private subs = new Map<string, Subscription>();
  private stopped = false;
  stats = { trades: 0, watched: 0 };

  constructor(private tape: Tape, private sql: Sql) {}

  async start() {
    this.nc = await natsConnect("trades", () => this.tape.clock.now(), (from, to) => this.gap(null, from, to, "NATS trades connection dropped"));
    if (env.bool("WATCH_ALL_TRADES", false)) {
      this.listen("unifiedTradeEvent.lite.>");
    } else {
      void this.watchLoop();
    }
  }

  async stop() {
    this.stopped = true;
    await this.nc?.close();
  }

  watched(): string[] {
    return [...this.subs.keys()];
  }

  private listen(subject: string) {
    const sub = this.nc!.subscribe(subject);
    this.subs.set(subject, sub);
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
      dedupe: `trade:${t.tx}:${t.slot_index_id ?? ""}`,
    });
  }

  private gap(scope: string | null, fromMs: number, toMs: number | null, reason: string) {
    const to = toMs == null ? null : new Date(toMs).toISOString();
    this.tape.emit("system.gap", { source: "trades", scope, from: new Date(fromMs).toISOString(), to, reason }, { source: "nats", subject: scope });
  }

  private async watchLoop() {
    while (!this.stopped) {
      try {
        const hours = env.num("WATCH_HOURS", 6);
        const rows = await this.sql`
          select mint from mem.coins
          where first_callout_at > now() - make_interval(hours => ${hours})
          order by coalesce(first_callout_at, first_seen) desc
          limit ${env.int("WATCH_MAX_COINS", 60)}`;
        const want = new Set(rows.map((r) => `unifiedTradeEvent.processed.${r.mint as string}`));
        for (const [s, sub] of this.subs)
          if (!want.has(s)) {
            sub.unsubscribe();
            this.subs.delete(s);
            this.gap(s.split(".").at(-1)!, this.tape.clock.now(), null, "coin left the watched set");
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
