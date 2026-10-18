// Index refresh (docs/PIPELINE.md 2.3, 2.4): score every wallet on what WE could have made copying it, then publish a new
// version. Scores come only from idx.* rows already flushed; the smart set rides on `index.refreshed`, so replays see it.
import type { BodyOf } from "@asimog/contracts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { pumpGet } from "../senses/pump-http.ts";
import type { Tape } from "../tape/tape.ts";

const P = {
  windowDays: env.num("INDEX_WINDOW_DAYS"),
  halfLifeDays: env.num("INDEX_HALF_LIFE_DAYS"),
  minAgeMin: env.num("INDEX_MIN_AGE_MIN"), // a buy younger than this has no outcome yet
  minCoins: env.int("INDEX_MIN_COINS"),
  minCoinsSeed: env.int("INDEX_MIN_COINS_SEED"),
  smartMax: env.int("INDEX_SMART_MAX"),
  cost: env.num("INDEX_ROUND_TRIP_COST"), // fees both ways plus slippage at 0.02 SOL (docs/DECISIONS.md cost floor)
  sniperShare: env.num("INDEX_SNIPER_SHARE"),
};

type Smart = BodyOf<"index.refreshed">["smart"][number];

/** Seed lists (docs/PIPELINE.md 2.1): pump.fun's leaderboards are a list of wallets to watch, never a ranking we copy. */
export async function seed(sql: Sql, now: string) {
  let n = 0;
  for (const period of ["daily", "weekly", "monthly"]) {
    const r = await pumpGet<{ entries?: { walletAddress: string; pnlSol: number; positionsCount: number; topPositions?: { mint: string }[] }[] }>("/pnl-leaderboard", { period, sort: "combined", limit: 100 });
    for (const e of r.body?.entries ?? []) {
      await sql`insert into idx.seed (wallet, source, detail, seen_at) values (${e.walletAddress}, ${`leaderboard:${period}`},
        ${sql.json({ pnl_sol: e.pnlSol, positions: e.positionsCount, mints: (e.topPositions ?? []).map((p) => p.mint) } as never)}, ${now})
        on conflict (wallet) do update set detail = excluded.detail, seen_at = excluded.seen_at`;
      n++;
    }
  }
  return n;
}

/** Score every wallet with at least one closed-enough copy trade in the window, then label archetypes. */
export async function refresh(sql: Sql, tape: Tape): Promise<{ version: number; wallets: number; smart: number }> {
  const now = tape.clock.iso();
  const [{ v }] = (await sql`select coalesce(max(version), 0) + 1 v from idx.wallet`) as unknown as [{ v: number }];
  const rows = await sql`
    with t as (
      select w.wallet, w.mint, w.early_slot,
        -- value per token bought: what was sold, plus what is left at the coin's last price; against the price we could have paid
        ((w.sol_out + greatest(w.tok_in - w.tok_out, 0) * coalesce(c.last_price, 0)) / w.tok_in) / w.copy_price * (1 - ${P.cost}::float8) mult,
        c.peak_price >= 2 * w.copy_price early_right,
        extract(epoch from (select min(k.created_at) from mem.callouts k where k.mint = w.mint and k.created_at > w.first_buy_at) - w.first_buy_at) lead_s,
        power(0.5, extract(epoch from (${now}::timestamptz - w.first_buy_at)) / 86400 / ${P.halfLifeDays}::float8) wt,
        c.creator = w.wallet is_dev
      from idx.wallet_coin w join idx.coin c on c.mint = w.mint
      where w.tok_in > 0 and w.copy_price > 0 and w.first_buy_at > ${now}::timestamptz - make_interval(days => ${P.windowDays})
        and w.first_buy_at < ${now}::timestamptz - make_interval(mins => ${P.minAgeMin})
    )
    select wallet, count(*)::int n,
      exp(sum(wt * ln(greatest(mult, 1e-6))) / sum(wt)) copy_net,
      sum(wt * (mult > 1)::int) / sum(wt) win,
      avg(early_right::int) early_right,
      percentile_cont(0.5) within group (order by lead_s) lead_s,
      avg(early_slot::int) early_share,
      bool_or(is_dev) dev,
      exists (select 1 from mem.callers k where k.wallet = t.wallet) caller,
      exists (select 1 from idx.seed s where s.wallet = t.wallet) seeded
    from t group by wallet having count(*) >= 2`;
  const pop = rows.length ? rows.reduce((a, r) => a + (r.win as number), 0) / rows.length : 0.5;
  // Wilson lower bound of the weighted win share, with n as the evidence count
  const lcb = (p: number, n: number) => {
    const z = 1.959964;
    return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  };
  const smart: Smart[] = [];
  const out = rows.map((r) => {
    const n = r.n as number;
    const winLcb = lcb(r.win as number, n);
    const archetype = r.dev ? "dev" : (r.early_share as number) >= P.sniperShare ? "sniper"
      : (r.copy_net as number) > 1 && winLcb > pop && n >= (r.seeded ? P.minCoinsSeed : P.minCoins) ? "smart"
      : r.caller ? "caller" : "trader";
    const row = { wallet: r.wallet as string, version: v, n, copy_net: r.copy_net as number, copy_win_lcb: winLcb, early_right: r.early_right as number, lead_s: (r.lead_s as number | null) ?? null, archetype, seed: r.seeded ? "seed" : "firehose", refreshed_at: now };
    if (archetype === "smart") smart.push({ wallet: row.wallet, copy_net: row.copy_net, copy_win_lcb: winLcb, n, lead_s: row.lead_s, archetype });
    return row;
  });
  for (let i = 0; i < out.length; i += 2000)
    await sql`insert into idx.wallet ${sql(out.slice(i, i + 2000) as never, "wallet", "version", "n", "copy_net", "copy_win_lcb", "early_right", "lead_s", "archetype", "seed", "refreshed_at")}
      on conflict (wallet) do update set version = excluded.version, n = excluded.n, copy_net = excluded.copy_net, copy_win_lcb = excluded.copy_win_lcb,
        early_right = excluded.early_right, lead_s = excluded.lead_s, archetype = excluded.archetype, seed = excluded.seed, refreshed_at = excluded.refreshed_at`;
  // a wallet this version did not score keeps an older version's label: demote it so "smart" means smart now (fix plan 3.10)
  await sql`update idx.wallet set archetype = 'stale' where version < ${v} and archetype in ('smart', 'sniper')`;
  smart.sort((a, b) => b.copy_win_lcb - a.copy_win_lcb || (a.wallet < b.wallet ? -1 : 1));
  const [coins] = await sql`select count(*)::int n from idx.coin where last_at > ${now}::timestamptz - make_interval(days => ${P.windowDays})`;
  tape.emit("index.refreshed", { version: v, window_days: P.windowDays, wallets: out.length, coins: coins!.n as number, smart: smart.slice(0, P.smartMax) }, { source: "analyzer", subject: `index:${v}` });
  log.info("index refreshed", { version: v, wallets: out.length, smart: smart.length });
  return { version: v, wallets: out.length, smart: smart.length };
}
