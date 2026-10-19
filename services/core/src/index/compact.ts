// Index compaction and leaderboards (docs/tasks/B7.md, docs/PIPELINE.md section 3): hourly rollups stay 48 h, then
// move to wallet x coin (lifetime) and wallet x day; scores read the union, so a score is unchanged. Leaderboards
// are rebuilt hourly from the rollups as versioned rows. A light rebuild keeps the current version; a full or weekly
// rebuild starts a new one, and old versions are never deleted.
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";

const windowDays = () => env.num("INDEX_WINDOW_DAYS");

/** Move every idx.wallet_coin row older than `keepHours` into wallet x coin and wallet x day, then delete it. */
export async function compact(sql: Sql, now: string, keepHours: number): Promise<{ moved: number; days: number }> {
  const cutoff = new Date(Date.parse(now) - keepHours * 3_600_000).toISOString();
  const moved = (await sql`
    insert into idx.wallet_coin_all (wallet, mint, buys, sells, sol_in, sol_out, tok_in, tok_out, first_buy_at, first_buy_price,
      copy_price, peak_after, mark_price, first_sell_at, early_slot, last_at)
    select wallet, mint, buys, sells, sol_in, sol_out, tok_in, tok_out, first_buy_at, first_buy_price,
      copy_price, peak_after, mark_price, first_sell_at, early_slot, last_at
    from idx.wallet_coin where last_at < ${cutoff}
    on conflict (wallet, mint) do update set
      buys = idx.wallet_coin_all.buys + excluded.buys,
      sells = idx.wallet_coin_all.sells + excluded.sells,
      sol_in = idx.wallet_coin_all.sol_in + excluded.sol_in,
      sol_out = idx.wallet_coin_all.sol_out + excluded.sol_out,
      tok_in = idx.wallet_coin_all.tok_in + excluded.tok_in,
      tok_out = idx.wallet_coin_all.tok_out + excluded.tok_out,
      first_buy_at = least(idx.wallet_coin_all.first_buy_at, excluded.first_buy_at),
      first_buy_price = coalesce(idx.wallet_coin_all.first_buy_price, excluded.first_buy_price),
      copy_price = coalesce(idx.wallet_coin_all.copy_price, excluded.copy_price),
      peak_after = greatest(idx.wallet_coin_all.peak_after, excluded.peak_after),
      mark_price = coalesce(idx.wallet_coin_all.mark_price, excluded.mark_price),
      first_sell_at = least(idx.wallet_coin_all.first_sell_at, excluded.first_sell_at),
      early_slot = idx.wallet_coin_all.early_slot or excluded.early_slot,
      last_at = greatest(idx.wallet_coin_all.last_at, excluded.last_at)
    returning 1`) as unknown as unknown[];
  const days = (await sql`
    insert into idx.wallet_day (wallet, day, buys, sells, sol_in, sol_out, coins, first_at, last_at)
    select wallet, date_trunc('day', coalesce(first_buy_at, last_at))::date, sum(buys)::int, sum(sells)::int,
      sum(sol_in), sum(sol_out), count(*)::int, min(coalesce(first_buy_at, last_at)), max(last_at)
    from idx.wallet_coin where last_at < ${cutoff}
    group by wallet, 2
    on conflict (wallet, day) do update set
      buys = idx.wallet_day.buys + excluded.buys, sells = idx.wallet_day.sells + excluded.sells,
      sol_in = idx.wallet_day.sol_in + excluded.sol_in, sol_out = idx.wallet_day.sol_out + excluded.sol_out,
      coins = idx.wallet_day.coins + excluded.coins,
      first_at = least(idx.wallet_day.first_at, excluded.first_at), last_at = greatest(idx.wallet_day.last_at, excluded.last_at)
    returning 1`) as unknown as unknown[];
  await sql`delete from idx.wallet_coin where last_at < ${cutoff}`;
  return { moved: moved.length, days: days.length };
}

type BoardRow = { kind: string; subject: string; score: number | null; body: unknown };

/** Rebuild the five leaderboards. `newVersion` starts a new version (full and weekly); otherwise the current one is replaced. */
export async function buildLeaderboards(sql: Sql, now: string, opts: { newVersion?: boolean; windowDays?: number } = {}): Promise<{ version: number; rows: number }> {
  const window = opts.windowDays ?? windowDays();
  const [{ v }] = (await sql`select coalesce(max(version), 0) v from idx.leaderboard`) as unknown as [{ v: number }];
  const version = opts.newVersion || v === 0 ? v + 1 : v;
  const since = new Date(Date.parse(now) - window * 86_400_000).toISOString();
  const rows: BoardRow[] = [];

  // wallets: the Index score itself
  for (const [i, r] of (await sql`select wallet, copy_net, copy_win_lcb, n, archetype from idx.wallet
      order by copy_win_lcb desc nulls last, copy_net desc nulls last, wallet limit 100`).entries())
    rows.push({ kind: "wallets", subject: r.wallet as string, score: (r.copy_win_lcb as number | null) ?? (r.copy_net as number | null), body: { copy_net: r.copy_net, n: r.n, archetype: r.archetype, rank: i + 1 } });

  // traders: what the wallets actually made in the window, from wallet x day
  for (const [i, r] of (await sql`select wallet, sum(sol_out - sol_in) net, sum(coins)::int coins from idx.wallet_day
      where day >= ${since.slice(0, 10)} group by wallet order by net desc, wallet limit 100`).entries())
    rows.push({ kind: "traders", subject: r.wallet as string, score: r.net as number, body: { net_sol: r.net, coins: r.coins, rank: i + 1 } });

  // callers: wallets the firm has seen calling
  for (const [i, r] of (await sql`select wallet, copy_net, copy_win_lcb from idx.wallet where archetype = 'caller'
      order by copy_win_lcb desc nulls last, wallet limit 100`).entries())
    rows.push({ kind: "callers", subject: r.wallet as string, score: (r.copy_win_lcb as number | null) ?? (r.copy_net as number | null), body: { copy_net: r.copy_net, rank: i + 1 } });

  // callouts: the callout rollup (engagement, then the multiple)
  for (const [i, r] of (await sql`select callout_id, mint, wallet, likes + replies + reposts + quotes + views engagement, multiple
      from mem.callouts order by engagement desc nulls last, multiple desc nulls last, callout_id limit 100`).entries())
    rows.push({ kind: "callouts", subject: r.callout_id as string, score: r.engagement as number, body: { mint: r.mint, wallet: r.wallet, multiple: r.multiple, rank: i + 1 } });

  // creators: coins and graduations, never pump.fun's own order
  for (const [i, r] of (await sql`select creator, count(*)::int coins, count(*) filter (where graduated)::int graduated
      from idx.coin where creator is not null group by creator order by graduated desc, coins desc, creator limit 100`).entries())
    rows.push({ kind: "creators", subject: r.creator as string, score: r.graduated as number, body: { coins: r.coins, graduated: r.graduated, rank: i + 1 } });

  if (!opts.newVersion) await sql`delete from idx.leaderboard where version = ${version} and window_days = ${window}`;
  for (let i = 0; i < rows.length; i += 500)
    await sql`insert into idx.leaderboard ${sql(
      rows.slice(i, i + 500).map((r) => ({ ...r, version, window_days: window, rank: (r.body as { rank?: number }).rank ?? 0, built_at: now, body: sql.json(r.body as never) })) as never,
      "version", "kind", "window_days", "rank", "subject", "score", "body", "built_at",
    )} on conflict (version, kind, window_days, subject) do update set rank = excluded.rank, score = excluded.score, body = excluded.body, built_at = excluded.built_at`;
  return { version, rows: rows.length };
}
