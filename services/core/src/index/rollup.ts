// Index rollup (docs/PIPELINE.md 2.1): every firehose trade folded, in memory, into per-wallet-per-coin and per-coin records,
// flushed to idx.* once a minute. Raw trades of unwatched coins are never stored. Pure except `flush`.
import type { BodyOf, Trade } from "@asimog/contracts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";

type Features = BodyOf<"coin.watched">["features"];
type WC = { buys: number; sells: number; sol_in: number; sol_out: number; tok_in: number; tok_out: number; first_buy_at: number | null; first_buy_price: number | null; copy_price: number | null; peak_after: number | null; mark_price: number | null; first_sell_at: number | null; early_slot: boolean; last_at: number };
type Coin = {
  first_seen_at: number; first_slot: number | null; from_birth: boolean; creator: string | null; curve_account: string | null; created_ms: number | null;
  last_price: number | null; peak_price: number | null; last_at: number; trades: number; mcap_usd: number | null;
  bundle_buys: number; bundle_sol: number; bundle_wallets: Set<string>; buy_sol: number; graduated: boolean;
  bal: Map<string, number>; bought: Map<string, number>; sniper_sol: number; smart: Set<string>; creator_sold: number; creator_bought: number;
  creator_buy_sol: number; block0_sol: number;
  pending: { wallet: string; due: number; at: number }[]; // first buys still waiting for their copy price
  marks: { wallet: string; due: number; at: number }[]; // first buys still waiting for their mark price (price at first buy + horizon)
  after: Map<string, { peak: number; at: number }>; // buyer -> highest price since their first buy, and when that buy was
  flushed: { trades: number; bundle_buys: number; bundle_sol: number } | null; // what idx.coin already holds: the next write adds the difference
  slim: boolean; // per-wallet launch-feature maps dropped to save memory (see evict)
};

const P = {
  latencyMs: env.num("FILL_LATENCY_MEDIAN_MS"),
  launchPrice: 30 / 1_073_000_000, // SOL per token at a fresh curve (virtual reserves 30 SOL / 1.073B tokens)
  bundleSlots: env.int("BUNDLE_SLOTS"),
  idleMs: env.int("INDEX_COIN_IDLE_MIN") * 60_000,
  horizonMs: env.num("INDEX_MIN_AGE_MIN") * 60_000, // copy value is marked this long after the first buy
  maxCoins: env.int("INDEX_MAX_COINS"),
};

const SUPPLY = 1_000_000_000; // every pump.fun coin mints 1B tokens

/** pump.fun's slotIndexId starts with the 12-digit, zero-padded slot. */
export const slotOf = (id: string | null) => (id && /^\d{12}/.test(id) ? Number(id.slice(0, 12)) : null);

export class Rollup {
  constructor(private maxCoins = P.maxCoins) {}

  private wc = new Map<string, WC>(); // `${wallet}|${mint}` -> changes since the last flush
  private coins = new Map<string, Coin>();
  smart = new Set<string>(); // from the latest Index version
  private held = new Set<string>(); // coins with an open position of ours: never forgotten or slimmed
  snipers = new Set<string>();
  stats = { trades: 0, coins: 0, wallets: 0, flushed: 0, coin_wallets: 0, evicted: 0 };

  /** Smart and sniper wallets from the latest Index, and the live coins' creators. */
  async load(sql: Sql) {
    for (const r of await sql`select wallet, archetype from idx.wallet where archetype in ('smart', 'sniper')`) (r.archetype === "smart" ? this.smart : this.snipers).add(r.wallet as string);
    // coins still live when we stopped keep their creator (and what the creator sold), so the creator-sold check survives a restart
    for (const r of await sql`select c.*, w.tok_in, w.tok_out from idx.coin c left join idx.wallet_coin w on w.mint = c.mint and w.wallet = c.creator
        where c.last_at > (select max(last_at) from idx.coin) - make_interval(secs => ${P.idleMs / 1000})`) {
      const c = this.coin(r.mint as string, (r.first_seen_at as Date).getTime());
      Object.assign(c, {
        first_slot: r.first_slot === null ? null : Number(r.first_slot), creator: r.creator, curve_account: r.curve_account, last_price: r.last_price, peak_price: r.peak_price,
        last_at: (r.last_at as Date).getTime(), trades: r.trades, bundle_buys: r.bundle_buys, bundle_sol: r.bundle_sol, creator_bought: r.tok_in ?? 0, creator_sold: r.tok_out ?? 0,
        flushed: { trades: r.trades, bundle_buys: r.bundle_buys, bundle_sol: r.bundle_sol },
      });
    }
  }

  /** A launch seen on the new-coin subject: creator and the curve's own token account. */
  launch(mint: string, creator: string | null, curveAccount: string | null, createdMs: number | null, now: number) {
    const c = this.coin(mint, now);
    if (c.trades === 0) c.from_birth = true;
    c.creator = creator;
    c.curve_account = curveAccount;
    c.created_ms = createdMs;
  }

  private coin(mint: string, now: number): Coin {
    let c = this.coins.get(mint);
    if (!c) {
      c = {
        first_seen_at: now, first_slot: null, from_birth: false, creator: null, curve_account: null, created_ms: null, last_price: null, peak_price: null, last_at: now, trades: 0, mcap_usd: null,
        bundle_buys: 0, bundle_sol: 0, bundle_wallets: new Set(), buy_sol: 0, graduated: false, bal: new Map(), bought: new Map(), sniper_sol: 0, smart: new Set(), creator_sold: 0, creator_bought: 0, creator_buy_sol: 0, block0_sol: 0, pending: [], marks: [], after: new Map(), flushed: null, slim: false,
      };
      this.coins.set(mint, c);
    }
    return c;
  }

  trade(t: Trade, now: number) {
    this.stats.trades++;
    const c = this.coin(t.mint, now);
    const slot = slotOf(t.slot_index_id);
    if (c.trades === 0 && t.price_sol && t.price_sol <= 3 * P.launchPrice) c.from_birth = true; // first trade near the launch price: the create buy
    if (c.first_slot === null && slot !== null) c.first_slot = slot;
    c.trades++;
    c.slim = false;
    if (t.on_curve === false) c.graduated = true;
    c.last_at = now;
    if (t.mcap_usd != null) c.mcap_usd = t.mcap_usd;
    if (t.price_sol) {
      // copy price: the first trade after a buyer's buy plus our latency is what we could have paid
      for (const p of c.pending.filter((x) => now >= x.due)) this.row(p.wallet, t.mint, p.at).copy_price = t.price_sol;
      c.pending = c.pending.filter((x) => now < x.due);
      this.settle(t.mint, c, now, c.last_price ?? t.price_sol); // the price in force when the horizon passed
      c.last_price = t.price_sol;
      c.peak_price = Math.max(c.peak_price ?? 0, t.price_sol);
      for (const [wallet, a] of c.after) if (t.price_sol > a.peak) { a.peak = t.price_sol; this.row(wallet, t.mint, a.at).peak_after = t.price_sol; }
    }
    const w = this.row(t.wallet, t.mint, now);
    w.last_at = now;
    const tokens = t.tokens ?? 0;
    const early = c.from_birth && slot !== null && c.first_slot !== null && slot - c.first_slot < P.bundleSlots;
    if (t.side === "buy") {
      w.buys++;
      w.sol_in += t.sol;
      w.tok_in += tokens;
      if (w.first_buy_at === null) {
        w.first_buy_at = now;
        w.first_buy_price = t.price_sol;
        c.pending.push({ wallet: t.wallet, due: now + P.latencyMs, at: now });
        c.marks.push({ wallet: t.wallet, due: now + P.horizonMs, at: now });
        if (t.price_sol) w.peak_after = t.price_sol;
        c.after.set(t.wallet, { peak: t.price_sol ?? 0, at: now });
      }
      if (early) {
        w.early_slot = true;
        c.bundle_buys++;
        c.bundle_sol += t.sol;
        if (t.wallet !== c.creator) c.bundle_wallets.add(t.wallet); // the creator's own buy is told apart (creator_sold)
      }
      c.buy_sol += t.sol;
      c.bought.set(t.wallet, (c.bought.get(t.wallet) ?? 0) + t.sol);
      if (this.snipers.has(t.wallet)) c.sniper_sol += t.sol;
      if (this.smart.has(t.wallet)) c.smart.add(t.wallet);
      if (t.wallet === c.creator) {
        c.creator_bought += tokens;
        c.creator_buy_sol += t.sol;
      }
      if (c.from_birth && slot !== null && c.first_slot !== null && slot === c.first_slot && t.wallet !== c.creator) c.block0_sol += t.sol;
    } else {
      w.sells++;
      w.sol_out += t.sol;
      w.tok_out += tokens;
      if (w.first_sell_at === null) w.first_sell_at = now;
      if (t.wallet === c.creator) c.creator_sold += tokens;
    }
    c.bal.set(t.wallet, (c.bal.get(t.wallet) ?? 0) + (t.side === "buy" ? tokens : -tokens));
  }

  /** This minute's changes for a wallet on a coin; a trade-less touch (a late copy price, a new peak) starts an empty one dated at the first buy. */
  private row(wallet: string, mint: string, at: number): WC {
    const key = `${wallet}|${mint}`;
    const w = this.wc.get(key) ?? { buys: 0, sells: 0, sol_in: 0, sol_out: 0, tok_in: 0, tok_out: 0, first_buy_at: null, first_buy_price: null, copy_price: null, peak_after: null, mark_price: null, first_sell_at: null, early_slot: false, last_at: at };
    this.wc.set(key, w);
    return w;
  }

  /** Marks whose horizon has passed take `price`. */
  private settle(mint: string, c: Coin, now: number, price: number) {
    for (const m of c.marks) if (now >= m.due) this.row(m.wallet, mint, m.at).mark_price = price;
    c.marks = c.marks.filter((m) => now < m.due);
    for (const [wallet, a] of c.after) if (now >= a.at + P.horizonMs) c.after.delete(wallet); // the peak counts only inside the mark window
  }

  curveAccount(mint: string) {
    return this.coins.get(mint)?.curve_account ?? null;
  }

  /** Launches by a creator the Index holds but has not written to idx.coin yet: [mint, first seen ms]. */
  unflushedLaunches(creator: string): [string, number][] {
    return [...this.coins].filter(([, c]) => c.creator === creator && !c.flushed).map(([m, c]) => [m, c.first_seen_at]);
  }

  /** What the launch sources know in memory: creator, curve account and creation time. */
  launchInfo(mint: string) {
    const c = this.coins.get(mint);
    return { creator: c?.creator ?? null, curve_account: c?.curve_account ?? null, created_ms: c?.created_ms ?? null, from_birth: c?.from_birth ?? false };
  }

  /** Launch features as seen now (docs/PIPELINE.md section 3). Shares are of SOL bought on the coin so far. */
  features(mint: string, now: number): Features | null {
    const c = this.coins.get(mint);
    if (!c) return null;
    const share = (x: number) => (c.buy_sol > 0 ? x / c.buy_sol : 0);
    const holders = [...c.bal.entries()].filter(([w, b]) => b > 1 && w !== c.curve_account).length;
    return {
      from_birth: c.from_birth,
      age_s: c.created_ms ? (now - c.created_ms) / 1000 : (now - c.first_seen_at) / 1000,
      first_slot: c.first_slot,
      creator: c.creator,
      trades: c.trades,
      buyers: c.bought.size,
      holders_est: holders,
      mcap_usd: c.mcap_usd,
      bundle_buys: c.bundle_buys,
      bundle_wallets: c.bundle_wallets.size,
      // what the first-slot buyers still hold, as a share of the whole supply: the part that can be dumped on followers
      bundle_share: Math.min(1, [...c.bundle_wallets].reduce((a, w) => a + Math.max(0, c.bal.get(w) ?? 0), 0) / SUPPLY),
      dev_buy_sol: c.from_birth ? c.creator_buy_sol : null,
      block0_sniper_share: c.from_birth ? share(c.block0_sol) : null,
      sniper_share: share(c.sniper_sol),
      top_buyer_share: share([...c.bought.values()].reduce((m, v) => Math.max(m, v), 0)), // no spread: a coin can have more buyers than the call stack allows arguments
      creator_sold: c.creator_bought > 0 ? Math.min(1, c.creator_sold / c.creator_bought) : 0,
      smart_buyers: c.smart.size,
    };
  }

  /** Write the minute's changes; forget coins idle for INDEX_COIN_IDLE_MIN. */
  async flush(sql: Sql, now: number) {
    this.held = new Set((await sql`select distinct mint from mind.positions where closed_at is null`).map((r) => r.mint as string));
    for (const [mint, c] of this.coins) this.settle(mint, c, now, c.last_price ?? 0); // no trade since the horizon: the last price is the price at it
    const batch = this.wc;
    this.wc = new Map(); // trades keep arriving while we write
    try {
      await this.write(sql, batch, now);
    } catch (err) {
      for (const [k, w] of batch) this.wc.set(k, merge(w, this.wc.get(k))); // keep the minute for the next flush
      throw err;
    }
  }

  private async write(sql: Sql, batch: Map<string, WC>, now: number) {
    const rows = [...batch.entries()].map(([k, w]) => {
      const [wallet, mint] = k.split("|") as [string, string];
      const iso = (x: number | null) => (x === null ? null : new Date(x).toISOString());
      return { wallet, mint, ...w, first_buy_at: iso(w.first_buy_at), first_sell_at: iso(w.first_sell_at), last_at: iso(w.last_at)! };
    });
    // idx.coin counters add what happened since the last write, so a restart or a retry never resets or doubles them
    const coins = [...this.coins.entries()].filter(([, c]) => !c.flushed || c.trades > c.flushed.trades).map(([mint, c]) => ({
      mint, first_seen_at: new Date(c.first_seen_at).toISOString(), first_slot: c.first_slot, creator: c.creator, curve_account: c.curve_account,
      last_price: c.last_price, peak_price: c.peak_price, last_at: new Date(c.last_at).toISOString(), trades: c.trades - (c.flushed?.trades ?? 0),
      bundle_buys: c.bundle_buys - (c.flushed?.bundle_buys ?? 0), bundle_sol: c.bundle_sol - (c.flushed?.bundle_sol ?? 0), graduated: c.graduated,
    }));
    await sql.begin(async (tx) => { // the upsert adds deltas: all chunks land or none, so a retry never double counts
      for (let i = 0; i < rows.length; i += 2000) {
        const chunk = rows.slice(i, i + 2000);
        await tx`insert into idx.wallet_coin ${tx(chunk as never, "wallet", "mint", "buys", "sells", "sol_in", "sol_out", "tok_in", "tok_out", "first_buy_at", "first_buy_price", "copy_price", "peak_after", "mark_price", "first_sell_at", "early_slot", "last_at")}
          on conflict (wallet, mint) do update set buys = idx.wallet_coin.buys + excluded.buys, sells = idx.wallet_coin.sells + excluded.sells,
            sol_in = idx.wallet_coin.sol_in + excluded.sol_in, sol_out = idx.wallet_coin.sol_out + excluded.sol_out,
            tok_in = idx.wallet_coin.tok_in + excluded.tok_in, tok_out = idx.wallet_coin.tok_out + excluded.tok_out,
            first_buy_at = coalesce(idx.wallet_coin.first_buy_at, excluded.first_buy_at), first_buy_price = coalesce(idx.wallet_coin.first_buy_price, excluded.first_buy_price),
            copy_price = coalesce(idx.wallet_coin.copy_price, excluded.copy_price), peak_after = greatest(idx.wallet_coin.peak_after, excluded.peak_after),
            mark_price = coalesce(idx.wallet_coin.mark_price, excluded.mark_price), first_sell_at = coalesce(idx.wallet_coin.first_sell_at, excluded.first_sell_at),
            early_slot = idx.wallet_coin.early_slot or excluded.early_slot, last_at = greatest(idx.wallet_coin.last_at, excluded.last_at)`;
      }
      for (let i = 0; i < coins.length; i += 2000)
        await tx`insert into idx.coin ${tx(coins.slice(i, i + 2000) as never, "mint", "first_seen_at", "first_slot", "creator", "curve_account", "last_price", "peak_price", "last_at", "trades", "bundle_buys", "bundle_sol", "graduated")}
          on conflict (mint) do update set first_slot = coalesce(idx.coin.first_slot, excluded.first_slot), creator = coalesce(idx.coin.creator, excluded.creator),
            curve_account = coalesce(idx.coin.curve_account, excluded.curve_account), last_price = excluded.last_price,
            peak_price = greatest(idx.coin.peak_price, excluded.peak_price), last_at = excluded.last_at, trades = idx.coin.trades + excluded.trades,
            bundle_buys = idx.coin.bundle_buys + excluded.bundle_buys, bundle_sol = idx.coin.bundle_sol + excluded.bundle_sol, graduated = idx.coin.graduated or excluded.graduated`;
    });
    for (const k of coins) {
      const c = this.coins.get(k.mint)!;
      c.flushed = { trades: (c.flushed?.trades ?? 0) + k.trades, bundle_buys: (c.flushed?.bundle_buys ?? 0) + k.bundle_buys, bundle_sol: (c.flushed?.bundle_sol ?? 0) + k.bundle_sol };
    }
    for (const [mint, c] of this.coins) {
      if (c.last_at >= now - P.idleMs || this.held.has(mint)) continue;
      if (c.last_price !== null) this.settle(mint, c, now, c.last_price); // an idle coin's horizons pass at the price in force
      c.pending = c.pending.filter((x) => now < x.due); // no trade came after the latency, so there is no copy price to owe
      if (!c.pending.length && !c.marks.length && !c.after.size) this.coins.delete(mint);
    }
    this.evict();
    let coinWallets = 0;
    for (const c of this.coins.values()) coinWallets += c.bal.size + c.bought.size;
    this.stats = { ...this.stats, coins: this.coins.size, flushed: this.stats.flushed + rows.length, coin_wallets: coinWallets };
  }

  /** Memory grows with the wallet maps on live coins. Over INDEX_MAX_COINS full coins (open positions of ours never count and never leave), the least recently active ones that are already written leave: whole when they owe no copy price or mark, otherwise slimmed to the small state those need. Idx rows are unchanged; only launch features of a coin that wakes up later see fewer wallets. */
  private evict() {
    const full = [...this.coins].filter(([mint, c]) => !c.slim && !this.held.has(mint));
    if (full.length <= this.maxCoins) return;
    full.sort((a, b) => a[1].last_at - b[1].last_at);
    for (const [mint, c] of full.slice(0, full.length - this.maxCoins)) {
      if (c.flushed?.trades !== c.trades) continue;
      this.stats.evicted++;
      if (!c.pending.length && !c.marks.length && !c.after.size) { this.coins.delete(mint); continue; }
      c.bal = new Map(); c.bought = new Map(); c.bundle_wallets = new Set(); c.smart = new Set();
      c.slim = true;
    }
  }
}

function merge(a: WC, b: WC | undefined): WC {
  if (!b) return a;
  const first = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.min(x, y));
  const buyFirst = a.first_buy_at !== null && (b.first_buy_at === null || a.first_buy_at <= b.first_buy_at);
  return {
    buys: a.buys + b.buys, sells: a.sells + b.sells, sol_in: a.sol_in + b.sol_in, sol_out: a.sol_out + b.sol_out, tok_in: a.tok_in + b.tok_in, tok_out: a.tok_out + b.tok_out, peak_after: Math.max(a.peak_after ?? 0, b.peak_after ?? 0) || null, mark_price: a.mark_price ?? b.mark_price,
    first_buy_at: first(a.first_buy_at, b.first_buy_at), first_buy_price: buyFirst ? a.first_buy_price : (b.first_buy_price ?? a.first_buy_price),
    copy_price: buyFirst ? (a.copy_price ?? b.copy_price) : (b.copy_price ?? a.copy_price), first_sell_at: first(a.first_sell_at, b.first_sell_at),
    early_slot: a.early_slot || b.early_slot, last_at: Math.max(a.last_at, b.last_at),
  };
}
