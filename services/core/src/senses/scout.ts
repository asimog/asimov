// Scout (docs/PIPELINE.md, docs/PIPELINE.md): every pump.fun trade, in memory. It feeds the Index rollup and promotes a coin into the
// watched set when a known caller or a smart wallet buys it, when its flow heats, or when its metrics clear the scan
// floor. Promotion writes the triggering trade and `coin.watched` with the coin's launch features as seen right then.

import type { BodyOf } from "@asimog/contracts";
import type { NatsConnection } from "@nats-io/nats-core";
import { Rollup } from "../index/rollup.ts";
import { type Config, configValues } from "../lib/config.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { Tape } from "../tape/tape.ts";
import { toTrade, tradeKey } from "./chain-reader.ts";
import { passesLaunch, sampled } from "./filters.ts";
import { factsFromTrades, LaunchFacts, type ResolvedLaunch } from "./launch-facts.ts";
import { consume, decodeJson, natsConnect } from "./nats.ts";

const WINDOW_MS = 60_000;
type Tick = { at: number; wallet: string; buy: boolean; sol: number };
type Reason = BodyOf<"coin.watched">["reason"];
type Features = BodyOf<"coin.watched">["features"];
type Role = "caller" | "smart";
type Trade = NonNullable<ReturnType<typeof toTrade>>;

export class Scout {
  private nc: NatsConnection | null = null;
  private feed: NatsConnection | null = null;
  /** Bounded, least recently used first: wallet -> its role, or null when the table says it is plain. The table is idx.scout_wallet. */
  readonly hot = new Map<string, Role | null>();
  private pending: { t: Trade; now: number }[] = [];
  private flow = new Map<string, Tick[]>();
  private promoted = new Map<string, number>();
  private refusedAt = new Map<string, number>();
  private launches = new Map<string, ResolvedLaunch>();
  private launchQueue: { t: Trade; now: number; reason: Reason; buyers: number; net: number }[] = [];
  private queuedLaunches = new Set<string>();
  private blocked = { creators: new Set<string>(), mints: new Set<string>(), wallets: new Set<string>() };
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
  stats = {
    trades: 0, callers: 0, hot_wallets: 0, live_coins: 0, launches: 0, caller_buy: 0, smart_buy: 0, heat: 0, metrics: 0,
    launch_refused: 0, unknown: {} as Record<string, number>,
  };

  /** `watched(mint)`: already in the Chain Reader's set. `onPromote(mint, curveAccount, eventId, features)`: subscribe, backfill, snapshot holders (`features()` is the Index's view at snapshot time). */
  constructor(
    private tape: Tape, private sql: Sql, private watched: (mint: string) => boolean,
    private onPromote: (mint: string, curveAccount: string | null, eventId: string, features: () => Features | null) => void,
    private hotMax = env.int("SCOUT_HOT_WALLETS"),
    private opts: { config?: Config; facts?: LaunchFacts; onDemote?: (mint: string) => void; samplePct?: number } = {},
  ) {}

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
      setInterval(() => void this.resolve(), 200),
      setInterval(() => void this.rollup.flush(this.sql, this.tape.clock.now()).catch((err) => log.warn("index flush", { err: String(err) })), 60_000),
    );
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    await this.rollup.flush(this.sql, this.tape.clock.now()).catch(() => {});
    await this.nc?.close();
    await this.feed?.close();
  }

  /** Known callers and the latest Index version's smart wallets go to idx.scout_wallet; snipers stay with the rollup. Then the hot set reloads from the table. */
  async refresh() {
    try {
      const at = new Date(this.tape.clock.now()).toISOString();
      const [ix] = await this.sql`select max(version) v from idx.wallet`;
      await this.sql.begin(async (tx) => { // smart first, so a wallet that is both ends as a caller
        if (ix?.v) await tx`insert into idx.scout_wallet select wallet, 'smart', ${at}::timestamptz from idx.wallet where archetype = 'smart' and version = ${ix.v}
          on conflict (wallet) do update set role = 'smart', at = excluded.at`;
        await tx`insert into idx.scout_wallet select wallet, 'caller', ${at}::timestamptz from mem.callers
          on conflict (wallet) do update set role = 'caller', at = excluded.at`;
        await tx`delete from idx.scout_wallet where at <> ${at}::timestamptz`;
      });
      if (ix?.v) {
        this.rollup.smart = new Set((await this.sql`select wallet from idx.wallet where archetype = 'smart' and version = ${ix.v}`).map((r) => r.wallet as string));
        this.rollup.snipers = new Set((await this.sql`select wallet from idx.wallet where archetype = 'sniper' and version = ${ix.v}`).map((r) => r.wallet as string));
      }
      const [n] = await this.sql`select count(*)::int n from idx.scout_wallet where role = 'caller'`;
      this.stats.callers = n!.n as number;
      // the owner lists as of now: the door checks the creator, the mint and the triggering wallet
      const lists = await this.sql`select distinct on (kind) kind, items from mind.lists order by kind, version desc`;
      const set = (kind: string) => new Set((lists.find((l) => l.kind === kind)?.items as string[] | undefined) ?? []);
      this.blocked = { creators: set("blocked_creators"), mints: set("blocked_mints"), wallets: set("blocked_wallets") };
      this.hot.clear();
      for (const r of await this.sql`select wallet, role from idx.scout_wallet order by role, wallet limit ${this.hotMax}`) this.hot.set(r.wallet as string, r.role as Role);
      this.stats.hot_wallets = this.hot.size;
    } catch (err) {
      log.warn("scout refresh", { err: String(err) });
    }
  }

  /** Looks up the wallets whose role was not in memory, then evaluates the launches waiting on facts. */
  async resolve() {
    const batch = this.pending;
    this.pending = [];
    if (batch.length) {
      try {
        const wallets = [...new Set(batch.map((p) => p.t.wallet))];
        const roles = new Map((await this.sql`select wallet, role from idx.scout_wallet where wallet = any(${wallets})`).map((r) => [r.wallet as string, r.role as Role]));
        for (const w of wallets) this.remember(w, roles.get(w) ?? null);
        for (const p of batch) {
          const role = roles.get(p.t.wallet);
          if (role) this.consider(p.t, p.now, role);
        }
      } catch (err) {
        log.warn("scout resolve", { err: String(err) });
      }
    }
    const launches = this.launchQueue;
    this.launchQueue = [];
    for (const q of launches) {
      this.queuedLaunches.delete(q.t.mint);
      try {
        await this.promote(q);
      } catch (err) {
        log.warn("scout launch", { mint: q.t.mint, err: String(err) });
      }
    }
  }

  private remember(wallet: string, role: Role | null) {
    this.hot.delete(wallet);
    this.hot.set(wallet, role);
    if (this.hot.size > this.hotMax) this.hot.delete(this.hot.keys().next().value!);
    this.stats.hot_wallets = this.hot.size;
  }

  /** The wallet's role from memory (refreshing its place), or undefined when only the table knows. */
  private roleOf(wallet: string) {
    const role = this.hot.get(wallet);
    if (role !== undefined) this.remember(wallet, role);
    return role;
  }

  private prune() {
    const cut = this.tape.clock.now() - 2 * WINDOW_MS;
    for (const [mint, ticks] of this.flow) if ((ticks.at(-1)?.at ?? 0) < cut) this.flow.delete(mint);
    for (const [mint, at] of this.promoted) if (at < this.tape.clock.now() - this.p.repromoteMs) this.promoted.delete(mint);
    this.stats.live_coins = this.flow.size;
  }

  onLaunch(c: { mint?: string; creator?: string; associated_bonding_curve?: string; created_timestamp?: number }) {
    if (!c.mint) return;
    this.stats.launches++;
    this.rollup.launch(c.mint, c.creator ?? null, c.associated_bonding_curve ?? null, c.created_timestamp ?? null, this.tape.clock.now());
  }

  onTrade(raw: Parameters<typeof toTrade>[0]) {
    const t = toTrade(raw);
    if (!t) return;
    this.stats.trades++;
    const now = this.tape.clock.now();
    this.rollup.trade(t, now);
    const ticks = this.flow.get(t.mint) ?? this.flow.set(t.mint, []).get(t.mint)!;
    ticks.push({ at: now, wallet: t.wallet, buy: t.side === "buy", sol: t.sol });
    while (ticks.length && ticks[0]!.at < now - WINDOW_MS) ticks.shift();
    this.consider(t, now);
  }

  /** `role` is passed when the table already answered for this buy; otherwise memory answers, and a miss queues a lookup for `resolve`. */
  private consider(t: Trade, now: number, role?: Role) {
    if (this.promoted.has(t.mint) || this.watched(t.mint) || this.refusedAt.has(t.mint) || this.queuedLaunches.has(t.mint)) return;
    const ticks = this.flow.get(t.mint) ?? [];
    const buyers = new Set(ticks.filter((x) => x.buy).map((x) => x.wallet)).size;
    const net = ticks.reduce((a, x) => a + (x.buy ? x.sol : -x.sol), 0);
    const f = this.rollup.features(t.mint, now);
    const buy = t.side === "buy";
    if (buy && role === undefined) {
      const known = this.roleOf(t.wallet);
      if (known === undefined && this.pending.length < this.hotMax) this.pending.push({ t, now });
      role = known ?? undefined;
    }
    const reason: Reason | null = buy && role === "caller" ? "caller_buy"
      : buy && role === "smart" ? "smart_buy"
      : buyers >= this.p.heatBuyers && net >= this.p.heatNetSol ? "heat"
      : f && (f.mcap_usd ?? 0) >= this.p.minMcapUsd && f.buyers >= this.p.minBuyers ? "metrics"
      : null;
    if (!reason || !f) return;
    // the launch door may need RPC or HTTP, so the decision leaves this synchronous handler and runs in resolve()
    this.queuedLaunches.add(t.mint);
    this.launchQueue.push({ t, now, reason, buyers, net });
    if (this.launchQueue.length > this.hotMax) {
      const dropped = this.launchQueue.shift();
      if (dropped) this.queuedLaunches.delete(dropped.t.mint);
    }
  }

  /** The launch door: blocklists, then the configurable launch filters, then (only when it passes) the watched set. */
  private async promote(q: { t: Trade; now: number; reason: Reason; buyers: number; net: number }) {
    const { t, now, reason } = q;
    if (this.promoted.has(t.mint) || this.watched(t.mint) || this.refusedAt.has(t.mint)) return;
    const f = this.rollup.features(t.mint, now);
    if (!f) return;
    const info = this.rollup.launchInfo(t.mint);
    const resolved = await this.facts().resolve(t.mint, {
      from_birth: f.from_birth,
      creator: info.creator,
      curve_account: info.curve_account,
      created_ms: info.created_ms,
      dev_buy_sol: f.dev_buy_sol,
      block0_sniper_share: f.block0_sniper_share,
      bundle_share: f.bundle_share,
    });
    const blocked = resolved.creator && this.blocked.creators.has(resolved.creator) ? "blocked_creator"
      : this.blocked.mints.has(t.mint) ? "blocked_mint"
      : this.blocked.wallets.has(t.wallet) ? "blocked_wallet"
      : null;
    const verdict = passesLaunch({ dev_buy_sol: resolved.dev_buy_sol, block0_sniper_share: resolved.block0_sniper_share, bundle_share: resolved.bundle_share }, this.cfg().filters.launch, reason);
    for (const u of verdict.unknown) this.stats.unknown[u] = (this.stats.unknown[u] ?? 0) + 1;
    const refused = blocked ?? verdict.reason;
    if (refused) return this.refuse(t, reason, refused, resolved);
    this.promoted.set(t.mint, now);
    this.launches.set(t.mint, resolved);
    this.stats[reason]++;
    // the trigger trade first, with the Chain Reader's dedupe key, so analyzers see the buy that caused the watch
    const te = this.tape.emit(t.on_curve === false ? "trade.amm" : "trade.curve", t, { source: "nats", subject: t.mint, eventTime: t.ts, dedupe: tradeKey(t) });
    const features = { ...f, creator: resolved.creator ?? f.creator, dev_buy_sol: resolved.dev_buy_sol, block0_sniper_share: resolved.block0_sniper_share };
    const we = this.tape.emit("coin.watched", {
      mint: t.mint, reason, wallet: reason === "caller_buy" || reason === "smart_buy" ? t.wallet : null, buyers_60s: q.buyers, net_sol_60s: q.net, trigger_tx: t.tx, features,
    }, { source: "nats", subject: t.mint, causes: [te.id], dedupe: `watch:${t.mint}:${Math.floor(now / this.p.repromoteMs)}` });
    this.onPromote(t.mint, resolved.curve_account ?? this.rollup.curveAccount(t.mint), we.id, () => this.rollup.features(t.mint, this.tape.clock.now()));
  }

  private refuse(t: Trade, watchReason: Reason, reason: string, facts: ResolvedLaunch) {
    this.refusedAt.set(t.mint, this.tape.clock.now());
    this.stats.launch_refused++;
    if (sampled(`${t.mint}:${reason}`, this.opts.samplePct ?? env.int("FILTER_SAMPLE_PCT")))
      this.tape.emit("filter.sampled", {
        reason: reason as BodyOf<"filter.sampled">["reason"], source: "nats", chain: "solana", callout: null,
        launch: { mint: t.mint, watch_reason: watchReason, wallet: t.wallet, facts: { ...facts } },
      }, { source: "nats", subject: t.mint });
    log.info("launch refused", { mint: t.mint, reason, watchReason });
  }

  /**
   * After Backfill reads the chain: if its facts disagree with the NATS ones, RPC wins (docs/PIPELINE.md). The launch
   * filter runs again, and a coin that now fails leaves the watched set with a note.
   */
  recheck(mint: string, trades: Trade[]) {
    const known = this.launches.get(mint);
    if (!known) return;
    const info = this.rollup.launchInfo(mint);
    const chain = factsFromTrades(trades, known.creator ?? info.creator, null);
    const at = this.tape.clock.iso();
    const differs = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) > 1e-9;
    let disagreed = false;
    if (known.sources.dev_buy === "nats" && differs(known.dev_buy_sol, chain.dev_buy_sol)) {
      this.tape.emit("system.source_disagree", { mint, fact: "dev_buy", nats: known.dev_buy_sol, rpc: chain.dev_buy_sol, at }, { source: "rpc", subject: mint });
      disagreed = true;
    }
    if (known.sources.block0_snipers === "nats" && differs(known.block0_sniper_share, chain.block0_sniper_share)) {
      this.tape.emit("system.source_disagree", { mint, fact: "block0_snipers", nats: known.block0_sniper_share, rpc: chain.block0_sniper_share, at }, { source: "rpc", subject: mint });
      disagreed = true;
    }
    if (!disagreed) return;
    const verdict = passesLaunch({ dev_buy_sol: chain.dev_buy_sol, block0_sniper_share: chain.block0_sniper_share, bundle_share: known.bundle_share }, this.cfg().filters.launch, "metrics");
    if (verdict.reason) {
      this.promoted.delete(mint);
      this.launches.delete(mint);
      this.refusedAt.set(mint, this.tape.clock.now());
      this.opts.onDemote?.(mint);
      this.tape.emit("coin.unwatched", { mint, reason: verdict.reason, by: "rpc_recheck" }, { source: "rpc", subject: mint, dedupe: `unwatch:${mint}:${at}` });
      this.tape.emit("system.note", { kind: "coin.demoted", detail: { mint, reason: verdict.reason, source: "rpc" } }, { source: "rpc", subject: mint });
      log.info("coin demoted after chain recheck", { mint, reason: verdict.reason });
    }
  }

  private cfg(): Config {
    return (this.opts.config ??= configValues());
  }

  private facts(): LaunchFacts {
    return (this.opts.facts ??= new LaunchFacts(null));
  }
}
