// Scout (docs/06, docs/23): every pump.fun trade, in memory. It feeds the Index rollup and promotes a coin into the
// watched set when a known caller or a smart wallet buys it, when its flow heats, or when its metrics clear the scan
// floor. Promotion writes the triggering trade and `coin.watched` with the coin's launch features as seen right then.
import { tradeKey } from "./chain-reader.ts";
import type { NatsConnection } from "@nats-io/nats-core";
import type { BodyOf } from "@asimog/contracts";
import { Rollup } from "../index/rollup.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { Tape } from "../tape/tape.ts";
import { toTrade } from "./chain-reader.ts";
import { consume, decodeJson, natsConnect } from "./nats.ts";

const WINDOW_MS = 60_000;
type Tick = { at: number; wallet: string; buy: boolean; sol: number };
type Reason = BodyOf<"coin.watched">["reason"];

export class Scout {
  private nc: NatsConnection | null = null;
  private feed: NatsConnection | null = null;
  private callers = new Set<string>();
  private flow = new Map<string, Tick[]>();
  private promoted = new Map<string, number>();
  private timers: NodeJS.Timeout[] = [];
  readonly rollup = new Rollup();
  private readonly p = {
    heatBuyers: env.int("SCOUT_HEAT_BUYERS"),
    heatNetSol: env.num("SCOUT_HEAT_NET_SOL"),
    // the scan floor only decides what we record in full; every strategy sets and evolves its own thresholds
    minMcapUsd: env.num("SCOUT_MIN_MCAP_USD"),
    minBuyers: env.int("SCOUT_MIN_BUYERS"),
    refreshMs: env.int("SCOUT_CALLERS_REFRESH_S") * 1000,
    repromoteMs: env.num("WATCH_HOURS") * 3_600_000,
  };
  stats = { trades: 0, callers: 0, live_coins: 0, launches: 0, caller_buy: 0, smart_buy: 0, heat: 0, metrics: 0 };

  /** `watched(mint)`: already in the Chain Reader's set. `onPromote(mint, curveAccount, eventId)`: subscribe, backfill, snapshot holders. */
  constructor(private tape: Tape, private sql: Sql, private watched: (mint: string) => boolean, private onPromote: (mint: string, curveAccount: string | null, eventId: string) => void) {}

  async start() {
    await this.refresh();
    await this.rollup.load(this.sql);
    const gap = (from: number, to: number) => this.tape.emit("system.note", { kind: "scout_gap", detail: { from: new Date(from).toISOString(), to: new Date(to).toISOString() } }, { source: "nats" });
    this.nc = await natsConnect("trades", () => this.tape.clock.now(), gap);
    void consume(this.nc.subscribe("unifiedTradeEvent.lite.>"), (_s, data) => this.onTrade(decodeJson(data) as never));
    this.feed = await natsConnect("feed", () => this.tape.clock.now(), gap);
    void consume(this.feed.subscribe("newCoinCreated.prod"), (_s, data) => this.onLaunch(decodeJson(data) as never));
    this.timers.push(
      setInterval(() => void this.refresh(), this.p.refreshMs),
      setInterval(() => this.prune(), 15_000),
      setInterval(() => void this.rollup.flush(this.sql, this.tape.clock.now()).catch((err) => log.warn("index flush", { err: String(err) })), 60_000),
    );
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    await this.rollup.flush(this.sql, this.tape.clock.now()).catch(() => {});
    await this.nc?.close();
    await this.feed?.close();
  }

  /** Known callers from memory; smart wallets and snipers from the latest Index version. */
  private async refresh() {
    try {
      this.callers = new Set((await this.sql`select wallet from mem.callers`).map((r) => r.wallet as string));
      this.stats.callers = this.callers.size;
      const [ix] = await this.sql`select max(version) v from idx.wallet`;
      if (ix?.v) {
        this.rollup.smart = new Set((await this.sql`select wallet from idx.wallet where archetype = 'smart' and version = ${ix.v}`).map((r) => r.wallet as string));
        this.rollup.snipers = new Set((await this.sql`select wallet from idx.wallet where archetype = 'sniper' and version = ${ix.v}`).map((r) => r.wallet as string));
      }
    } catch (err) {
      log.warn("scout refresh", { err: String(err) });
    }
  }

  private prune() {
    const cut = this.tape.clock.now() - 2 * WINDOW_MS;
    for (const [mint, ticks] of this.flow) if ((ticks.at(-1)?.at ?? 0) < cut) this.flow.delete(mint);
    for (const [mint, at] of this.promoted) if (at < this.tape.clock.now() - this.p.repromoteMs) this.promoted.delete(mint);
    this.stats.live_coins = this.flow.size;
  }

  private onLaunch(c: { mint?: string; creator?: string; associated_bonding_curve?: string; created_timestamp?: number }) {
    if (!c.mint) return;
    this.stats.launches++;
    this.rollup.launch(c.mint, c.creator ?? null, c.associated_bonding_curve ?? null, c.created_timestamp ?? null, this.tape.clock.now());
  }

  private onTrade(raw: Parameters<typeof toTrade>[0]) {
    const t = toTrade(raw);
    if (!t) return;
    this.stats.trades++;
    const now = this.tape.clock.now();
    this.rollup.trade(t, now);
    const ticks = this.flow.get(t.mint) ?? this.flow.set(t.mint, []).get(t.mint)!;
    ticks.push({ at: now, wallet: t.wallet, buy: t.side === "buy", sol: t.sol });
    while (ticks.length && ticks[0]!.at < now - WINDOW_MS) ticks.shift();
    if (this.promoted.has(t.mint) || this.watched(t.mint)) return;
    const buyers = new Set(ticks.filter((x) => x.buy).map((x) => x.wallet)).size;
    const net = ticks.reduce((a, x) => a + (x.buy ? x.sol : -x.sol), 0);
    const f = this.rollup.features(t.mint, now);
    const buy = t.side === "buy";
    const reason: Reason | null = buy && this.callers.has(t.wallet) ? "caller_buy"
      : buy && this.rollup.smart.has(t.wallet) ? "smart_buy"
      : buyers >= this.p.heatBuyers && net >= this.p.heatNetSol ? "heat"
      : f && (f.mcap_usd ?? 0) >= this.p.minMcapUsd && f.buyers >= this.p.minBuyers ? "metrics"
      : null;
    if (!reason || !f) return;
    this.promoted.set(t.mint, now);
    this.stats[reason]++;
    // the trigger trade first, with the Chain Reader's dedupe key, so analyzers see the buy that caused the watch
    const te = this.tape.emit(t.on_curve === false ? "trade.amm" : "trade.curve", t, { source: "nats", subject: t.mint, eventTime: t.ts, dedupe: tradeKey(t) });
    const we = this.tape.emit("coin.watched", {
      mint: t.mint, reason, wallet: reason === "caller_buy" || reason === "smart_buy" ? t.wallet : null, buyers_60s: buyers, net_sol_60s: net, trigger_tx: t.tx, features: f,
    }, { source: "nats", subject: t.mint, causes: [te.id], dedupe: `watch:${t.mint}:${Math.floor(now / this.p.repromoteMs)}` });
    this.onPromote(t.mint, this.rollup.curveAccount(t.mint), we.id);
  }
}
