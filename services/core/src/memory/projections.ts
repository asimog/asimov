// Memory (docs/05): projections built only from tape events. Rebuildable at any time (resetProjections + replay).
import type { BodyOf, Envelope } from "@asimog/contracts";
import type { Consumer, Tx } from "../tape/consumer.ts";

const minute = (iso: string) => new Date(Math.floor(Date.parse(iso) / 60_000) * 60_000).toISOString();

async function onCoin(tx: Tx, e: Envelope<BodyOf<"coin.seen">>) {
  const b = e.body;
  await tx`
    insert into mem.coins (mint, symbol, name, image, program, chain, first_seen, last_mcap_usd)
    values (${b.mint}, ${b.symbol}, ${b.name}, ${b.image}, ${b.program}, ${b.chain}, ${e.seen_time}, ${b.mcap_usd})
    on conflict (mint) do update set
      symbol = coalesce(excluded.symbol, mem.coins.symbol),
      name = coalesce(excluded.name, mem.coins.name),
      image = coalesce(excluded.image, mem.coins.image),
      program = coalesce(excluded.program, mem.coins.program),
      last_mcap_usd = coalesce(excluded.last_mcap_usd, mem.coins.last_mcap_usd)`;
}

async function onCallout(tx: Tx, e: Envelope<BodyOf<"callout.created">>) {
  const b = e.body;
  await tx`
    insert into mem.coins (mint, symbol, name, first_seen, first_callout_at, first_callout_mcap)
    values (${b.mint}, ${b.symbol}, ${b.name}, ${e.seen_time}, ${b.created_at}, ${b.mcap_at_call_usd})
    on conflict (mint) do update set
      symbol = coalesce(mem.coins.symbol, excluded.symbol),
      name = coalesce(mem.coins.name, excluded.name),
      first_callout_at = least(coalesce(mem.coins.first_callout_at, excluded.first_callout_at), excluded.first_callout_at),
      first_callout_mcap = case
        when mem.coins.first_callout_at is null or excluded.first_callout_at < mem.coins.first_callout_at
        then excluded.first_callout_mcap else mem.coins.first_callout_mcap end`;
  const [coin] = await tx`
    update mem.coins set callout_count = callout_count + 1 where mint = ${b.mint}
    returning first_callout_at, first_callout_mcap`;
  const firstAt = coin?.first_callout_at as Date | null;
  const firstMcap = coin?.first_callout_mcap as number | null;
  const created = Date.parse(b.created_at);
  const firstOn = !firstAt || firstAt.getTime() >= created;
  const ageMin = firstAt ? Math.max(0, (created - firstAt.getTime()) / 60_000) : 0;
  const pre = firstMcap && b.mcap_at_call_usd ? (b.mcap_at_call_usd / firstMcap - 1) * 100 : 0;
  await tx`
    insert into mem.callouts (callout_id, mint, wallet, text, media_url, mcap_at_call, price_at_call, created_at, seen_at,
      first_on_coin, opportunity_age_min, pre_move_pct, quoted_callout_id, via)
    values (${b.callout_id}, ${b.mint}, ${b.author_wallet}, ${b.text}, ${b.media_url}, ${b.mcap_at_call_usd}, ${b.price_at_call_usd},
      ${b.created_at}, ${e.seen_time}, ${firstOn}, ${ageMin}, ${pre}, ${b.quoted_callout_id}, ${b.via})
    on conflict (callout_id) do nothing`;
  await tx`
    insert into mem.callers (wallet, user_id, handle, x_handle, followers, total_callouts, first_seen, calls_seen, last_call_at)
    values (${b.author_wallet}, ${b.author_user_id}, ${b.author_handle}, ${b.author_x}, ${b.author_followers},
      ${b.author_total_callouts}, ${e.seen_time}, 1, ${b.created_at})
    on conflict (wallet) do update set
      user_id = coalesce(excluded.user_id, mem.callers.user_id),
      handle = coalesce(excluded.handle, mem.callers.handle),
      x_handle = coalesce(excluded.x_handle, mem.callers.x_handle),
      followers = coalesce(excluded.followers, mem.callers.followers),
      total_callouts = coalesce(excluded.total_callouts, mem.callers.total_callouts),
      calls_seen = mem.callers.calls_seen + 1,
      last_call_at = greatest(mem.callers.last_call_at, excluded.last_call_at)`;
  await tx`
    insert into mem.bars_1m (mint, minute, callouts) values (${b.mint}, ${minute(b.created_at)}, 1)
    on conflict (mint, minute) do update set callouts = mem.bars_1m.callouts + 1`;
}

async function onUpdate(tx: Tx, e: Envelope<BodyOf<"callout.updated">>) {
  const b = e.body;
  await tx`insert into mem.callout_updates (update_id, callout_id, text, created_at)
           values (${b.update_id}, ${b.callout_id}, ${b.text}, ${b.created_at}) on conflict do nothing`;
}

async function onReply(tx: Tx, e: Envelope<BodyOf<"callout.reply">>) {
  const b = e.body;
  await tx`insert into mem.callout_replies (reply_id, callout_id, wallet, handle, text, likes, created_at, seen_at)
           values (${b.reply_id}, ${b.callout_id}, ${b.wallet}, ${b.handle}, ${b.text}, ${b.likes}, ${b.created_at}, ${e.seen_time})
           on conflict (reply_id) do update set likes = excluded.likes`;
}

async function onCounts(tx: Tx, e: Envelope<BodyOf<"callout.counts">>) {
  const b = e.body;
  await tx`update mem.callouts set likes = ${b.likes}, replies = ${b.replies + b.comments}, reposts = ${b.reposts},
             quotes = ${b.quotes}, views = ${b.views}, multiple = ${b.multiple}, max_multiple = ${b.max_multiple}
           where callout_id = ${b.callout_id}`;
  if (b.mcap_usd != null) await tx`update mem.coins set last_mcap_usd = ${b.mcap_usd} where mint = ${b.mint}`;
}

async function onTrades(tx: Tx, trades: Envelope<BodyOf<"trade.curve">>[]) {
  if (!trades.length) return;
  // aggregate per (mint, minute) in memory, then one upsert per bar
  type Agg = { o: number; h: number; l: number; c: number; v: number; buys: number; sells: number; flow: number; firstTs: number; lastTs: number; buyers: Set<string> };
  const bars = new Map<string, Agg>();
  const last = new Map<string, { ts: string; mcap: number | null; price: number | null }>();
  for (const e of trades) {
    const t = e.body;
    const px = t.price_sol ?? 0;
    const k = `${t.mint}|${minute(t.ts)}`;
    const ts = Date.parse(t.ts);
    let a = bars.get(k);
    if (!a) bars.set(k, (a = { o: px, h: px, l: px, c: px, v: 0, buys: 0, sells: 0, flow: 0, firstTs: ts, lastTs: ts, buyers: new Set() }));
    if (ts < a.firstTs) ((a.firstTs = ts), (a.o = px));
    if (ts >= a.lastTs) ((a.lastTs = ts), (a.c = px));
    a.h = Math.max(a.h, px);
    a.l = Math.min(a.l, px);
    a.v += t.sol;
    if (t.side === "buy") (a.buys++, (a.flow += t.sol), a.buyers.add(t.wallet));
    else (a.sells++, (a.flow -= t.sol));
    last.set(t.mint, { ts: t.ts, mcap: t.mcap_usd, price: t.price_usd });
  }
  for (const [k, a] of bars) {
    const [mint, m] = k.split("|") as [string, string];
    const newBuyers = a.buyers.size
      ? (await tx`insert into mem.bar_buyers (mint, minute, wallet) select ${mint}, ${m}, unnest(${[...a.buyers]}::text[])
                  on conflict do nothing returning wallet`).length
      : 0;
    await tx`
      insert into mem.bars_1m (mint, minute, o, h, l, c, volume_sol, buys, sells, net_flow_sol, unique_buyers)
      values (${mint}, ${m}, ${a.o}, ${a.h}, ${a.l}, ${a.c}, ${a.v}, ${a.buys}, ${a.sells}, ${a.flow}, ${newBuyers})
      on conflict (mint, minute) do update set
        o = coalesce(mem.bars_1m.o, excluded.o),
        h = greatest(coalesce(mem.bars_1m.h, excluded.h), excluded.h),
        l = least(coalesce(mem.bars_1m.l, excluded.l), excluded.l),
        c = excluded.c,
        volume_sol = mem.bars_1m.volume_sol + excluded.volume_sol,
        buys = mem.bars_1m.buys + excluded.buys,
        sells = mem.bars_1m.sells + excluded.sells,
        net_flow_sol = mem.bars_1m.net_flow_sol + excluded.net_flow_sol,
        unique_buyers = mem.bars_1m.unique_buyers + excluded.unique_buyers`;
  }
  for (const [mint, l] of last)
    await tx`update mem.coins set last_trade_at = ${l.ts}, last_mcap_usd = coalesce(${l.mcap}, last_mcap_usd),
               last_price_usd = coalesce(${l.price}, last_price_usd) where mint = ${mint}`;
}

/** The Scout promoted a coin (docs/06): the Chain Reader watches from the earliest of this and the first callout. */
async function onWatched(tx: Tx, e: Envelope<BodyOf<"coin.watched">>) {
  await tx`insert into mem.coins (mint, first_seen, watched_at, watch_reason) values (${e.body.mint}, ${e.seen_time}, ${e.seen_time}, ${e.body.reason})
    on conflict (mint) do update set watched_at = coalesce(mem.coins.watched_at, excluded.watched_at), watch_reason = coalesce(mem.coins.watch_reason, excluded.watch_reason)`;
}

export const memory: Consumer = {
  name: "memory",
  topics: ["coin.seen", "coin.watched", "callout.created", "callout.updated", "callout.reply", "callout.counts", "trade.curve", "trade.amm"],
  batch: 1000,
  async handle(events, tx) {
    const trades: Envelope<BodyOf<"trade.curve">>[] = [];
    for (const e of events) {
      switch (e.topic) {
        case "coin.seen": await onCoin(tx, e as never); break;
        case "coin.watched": await onWatched(tx, e as never); break;
        case "callout.created": await onCallout(tx, e as never); break;
        case "callout.updated": await onUpdate(tx, e as never); break;
        case "callout.reply": await onReply(tx, e as never); break;
        case "callout.counts": await onCounts(tx, e as never); break;
        default: trades.push(e as never);
      }
    }
    await onTrades(tx, trades);
  },
};
