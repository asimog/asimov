// Flow and pre-call analyzers (docs/PIPELINE.md flow, precall). A callout is announced by its author's own buy (posting
// requires holding), so a known caller's buy on a coin they have not called is a forecast of a callout.
// Every read is bounded by the event's seen_time: memory may already hold callouts from later in the window.
// Each detection is also a `precall.detected` event, so the desk wakes on the Tape instead of searching the Board.
// The same pass sees each coin's first AMM trade and writes `coin.graduated`.
import type { BodyOf, Envelope } from "@asimog/contracts";
import { putSignal } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import { median } from "../lib/stats.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";

const P = {
  windowDays: env.num("INDEX_WINDOW_DAYS"),
  horizonMin: env.num("PRECALL_HORIZON_MIN"),
  priorN: env.num("PRECALL_PRIOR_N"),
  peakAt: env.num("PRECALL_PEAK_MULT"),
  cost: env.num("INDEX_ROUND_TRIP_COST"), // fees both ways plus slippage, as the Index charges a copy trade
};
const TRADES = ["trade.curve", "trade.amm"];
const MIN = 60_000;
type T = Envelope<BodyOf<"trade.curve">>;

const iso = (ms: number) => new Date(ms).toISOString();

/** Was `wallet` a known caller at `at`, and had it not called `mint` by then? */
async function qualifies(tx: Tx, wallet: string, mint: string, at: string) {
  const [r] = await tx`select
      exists (select 1 from mem.callouts where wallet = ${wallet} and seen_at < ${at}) known,
      exists (select 1 from mem.callouts where wallet = ${wallet} and mint = ${mint} and seen_at <= ${at}) called`;
  return (r!.known as boolean) && !(r!.called as boolean);
}

/**
 * Closed record (docs/STRATEGY.md section 3): each first qualifying buy per coin whose horizon ended by `nowMs`. Per buy:
 * did the same wallet call it within the horizon and how fast; our net had we bought at the first trade after their buy
 * and sold into their callout (the first trade at or after it), or, with no callout, at the last trade of the horizon;
 * whether they sold within the horizon after calling (a dump). `wallet = null` gives the population over every known caller.
 */
export async function callerRecord(tx: Tx, wallet: string | null, nowMs: number) {
  const H = P.horizonMin;
  const now = iso(nowMs);
  const at = tx`(case when t.source = 'rpc' then t.event_time else t.seen_time end)`;
  const price = (cond: ReturnType<typeof tx>, order: ReturnType<typeof tx>) => tx`(select (x.body->>'price_sol')::float from tape.events x
    where x.subject = c.mint and x.topic = any(${TRADES}) and x.body->>'price_sol' is not null and x.seen_time <= ${now} and ${cond} order by ${order} limit 1)`;
  const rows = await tx`
    with b as (
      select distinct on (t.body->>'wallet', t.subject) t.body->>'wallet' w, t.subject mint, ${at} at
      from tape.events t
      where t.topic = any(${TRADES}) and t.body->>'side' = 'buy' and t.seen_time <= ${now} and ${at} <= ${iso(nowMs - H * MIN)}
        and t.seen_time > ${iso(nowMs - P.windowDays * 86_400_000)}
        ${wallet ? tx`and t.body->>'wallet' = ${wallet}` : tx``}
        and exists (select 1 from mem.callouts c where c.wallet = t.body->>'wallet' and c.seen_at < ${at})
        and not exists (select 1 from mem.callouts c where c.wallet = t.body->>'wallet' and c.mint = t.subject and c.seen_at <= ${at})
      order by t.body->>'wallet', t.subject, ${at}),
    c as (
      select b.*, (select min(k.seen_at) from mem.callouts k where k.wallet = b.w and k.mint = b.mint
        and k.seen_at > b.at and k.seen_at <= b.at + make_interval(mins => ${H}) and k.seen_at <= ${now}) c_at
      from b)
    select extract(epoch from (c_at - at))::float lag_s,
      ${price(tx`x.seen_time > c.at`, tx`x.seen_time, x.id`)} entry,
      case when c_at is null then ${price(tx`x.seen_time <= c.at + make_interval(mins => ${H})`, tx`x.seen_time desc, x.id desc`)}
        else ${price(tx`x.seen_time >= c.c_at`, tx`x.seen_time, x.id`)} end exit,
      c_at is not null and exists (select 1 from tape.events s where s.subject = c.mint and s.topic = any(${TRADES}) and s.body->>'wallet' = c.w
        and s.body->>'side' = 'sell' and s.seen_time > c.c_at and s.seen_time <= least(c.c_at + make_interval(mins => ${H}), ${now}::timestamptz)) dumped
    from c`;
  const net = (r: Record<string, unknown>) => (r.entry && r.exit ? ((r.exit as number) / (r.entry as number)) * (1 - P.cost) : null);
  const called = rows.filter((r) => r.lag_s != null);
  const missed = rows.filter((r) => r.lag_s == null);
  const [k] = wallet
    ? await tx`select count(*)::int n,
        count(*) filter (where exists (select 1 from tape.events w where w.topic = 'coin.watched' and w.subject = c.mint and w.body->'features'->>'creator' = ${wallet} and w.seen_time <= ${now}))::int own
      from mem.callouts c where c.wallet = ${wallet} and c.seen_at <= ${now}`
    : [{ n: 0, own: 0 }];
  return {
    buys: rows.length,
    called: called.length,
    lags: called.map((r) => r.lag_s as number),
    called_nets: called.flatMap((r) => net(r) ?? []),
    missed_nets: missed.flatMap((r) => net(r) ?? []),
    dumps: called.filter((r) => r.dumped).length,
    n_calls: k!.n as number,
    own_calls: k!.own as number,
  };
}
type Rec = Awaited<ReturnType<typeof callerRecord>>;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * The caller fields (docs/STRATEGY.md section 3), each shrunk to the population by PRECALL_PRIOR_N pseudo-buys:
 * buy_to_call_rate, post_call_net, miss_net and the expected net of copying their buy now.
 */
export function callerFields(r: Rec, pop: { rate: number; called_net: number; missed_net: number }) {
  const n = P.priorN;
  const shrink = (xs: number[], prior: number) => (n * prior + xs.reduce((a, b) => a + b, 0)) / (n + xs.length);
  const rate = (pop.rate * n + r.called) / (n + r.buys);
  const post = shrink(r.called_nets, pop.called_net);
  const miss = shrink(r.missed_nets, pop.missed_net);
  return {
    buy_to_call_rate: rate,
    post_call_net: post,
    miss_net: miss,
    // P(call | bought) x the net if they call, minus the cost of a miss
    edge: rate * (post - 1) - (1 - rate) * (1 - miss),
    dump_rate: r.called ? r.dumps / r.called : null,
    creator_share: r.n_calls ? r.own_calls / r.n_calls : null,
    n_calls: r.n_calls,
    lag_med_s: median(r.lags),
  };
}

export function precallAnalyzers(tape: Tape, clock: Clock): Consumer {
  const settled = new Set<string>(); // mints whose graduation is decided: emitted, or first seen on the AMM (graduated before we watched)

  /** coin.graduated on the first AMM trade of a coin we saw trading on the curve (docs/SYSTEM.md coin lifecycle). */
  async function graduation(tx: Tx, e: T) {
    if (settled.has(e.body.mint)) return;
    settled.add(e.body.mint);
    // a curve trade the chain reported with its program: a trigger trade written without one says nothing about the curve
    const [c] = await tx`select 1 from tape.events where subject = ${e.body.mint} and topic = 'trade.curve' and body->>'program' is not null and seen_time < ${e.seen_time} limit 1`;
    if (c) await tape.emitIn(tx, "coin.graduated", { mint: e.body.mint, tx: e.body.tx, price_sol: e.body.price_sol, at: e.event_time },
      { source: "analyzer", subject: e.body.mint, causes: [e.id], after: e.seen_time, dedupe: `graduated:${e.body.mint}` });
  }

  type Pop = { rate: number; called_net: number; missed_net: number };
  const pop = new Map<number, Pop>(); // minute bucket -> population record; a pure cache, so a restart recomputes the same value
  async function popRecord(tx: Tx, nowMs: number) {
    const bucket = Math.floor(nowMs / MIN);
    if (!pop.has(bucket)) {
      const r = await callerRecord(tx, null, bucket * MIN);
      // with no history the population is break-even before costs
      pop.set(bucket, { rate: (r.called + 1) / (r.buys + 2), called_net: mean(r.called_nets) ?? 1 - P.cost, missed_net: mean(r.missed_nets) ?? 1 - P.cost });
    }
    return pop.get(bucket)!;
  }

  async function flow(tx: Tx, e: T) {
    const now = Date.parse(e.seen_time);
    const rows = await tx`select body->>'side' side, body->>'wallet' w, (body->>'sol')::float sol, seen_time from tape.events
      where subject = ${e.body.mint} and topic = any(${TRADES}) and seen_time > ${iso(now - 2 * MIN)} and seen_time <= ${e.seen_time}`;
    const last = rows.filter((r) => (r.seen_time as Date).getTime() > now - MIN);
    const buys = last.filter((r) => r.side === "buy");
    const bySol = new Map<string, number>();
    for (const r of buys) bySol.set(r.w as string, (bySol.get(r.w as string) ?? 0) + (r.sol as number));
    const buySol = [...bySol.values()].reduce((a, b) => a + b, 0);
    const net = last.reduce((a, r) => a + (r.side === "buy" ? 1 : -1) * (r.sol as number), 0);
    const [cb] = await tx`select count(distinct t.body->>'wallet')::int n from tape.events t
      where t.subject = ${e.body.mint} and t.topic = any(${TRADES}) and t.body->>'side' = 'buy'
        and t.seen_time > ${iso(now - P.horizonMin * MIN)} and t.seen_time <= ${e.seen_time}
        and exists (select 1 from mem.callouts c where c.wallet = t.body->>'wallet' and c.seen_at < t.seen_time)`;
    await putSignal(tx, clock, {
      kind: "flow.state",
      subject: e.body.mint,
      value: {
        buys_60s: buys.length,
        sells_60s: last.length - buys.length,
        buyers_60s: bySol.size,
        net_sol_60s: net,
        accel: last.length / (rows.length - last.length + 1),
        top_share: buySol > 0 ? Math.max(...bySol.values()) / buySol : 0,
        known_callers_buying: cb!.n as number,
        heat: Math.min(1, bySol.size / 20) * Math.min(1, Math.max(0, net) / 5),
      },
      confidence: Math.min(1, rows.length / 20),
      validMs: 2 * MIN,
      inputs: [e.id],
      analyzer: "flow@1",
      at: e.seen_time,
    });
  }

  async function precall(tx: Tx, e: T) {
    const now = Date.parse(e.seen_time);
    const H = P.horizonMin;
    // every known caller who bought this coin within the horizon and has not called it
    const buyers = await tx`select distinct t.body->>'wallet' w from tape.events t
      where t.subject = ${e.body.mint} and t.topic = any(${TRADES}) and t.body->>'side' = 'buy'
        and (case when t.source = 'rpc' then t.event_time else t.seen_time end) > ${iso(now - H * MIN)} and t.seen_time <= ${e.seen_time}
        and exists (select 1 from mem.callouts c where c.wallet = t.body->>'wallet' and c.seen_at < (case when t.source = 'rpc' then t.event_time else t.seen_time end))
        and not exists (select 1 from mem.callouts c where c.wallet = t.body->>'wallet' and c.mint = t.subject and c.seen_at <= ${e.seen_time})
      order by 1`;
    const pr = await popRecord(tx, now);
    const each = [];
    for (const b of buyers) {
      const r = await callerRecord(tx, b.w as string, now);
      const f = callerFields(r, pr);
      each.push({ wallet: b.w as string, p: f.buy_to_call_rate, f, ...r });
    }
    // the buyer whose buy is worth most to copy, by expected net, not by call odds alone
    const top = each.reduce((a, b) => (b.f.edge > a.f.edge || (b.f.edge === a.f.edge && b.wallet < a.wallet) ? b : a));
    const peaks = (await tx`select (body->>'peak_multiple')::float peak from (
        select distinct on (body->>'callout_id') body from tape.events
        where topic = 'outcome.measured' and seen_time <= ${e.seen_time} and body->>'author_wallet' = ${top.wallet} and (body->>'horizon_min')::int = 3
        order by body->>'callout_id', seen_time desc, id desc) x where body->>'coverage' = 'ok'`).map((r) => r.peak as number);
    const p = 1 - each.reduce((a, x) => a * (1 - x.p), 1);
    await putSignal(tx, clock, {
      kind: "precall.callout_p",
      subject: e.body.mint,
      value: {
        p,
        caller: top.wallet,
        caller_p: top.p,
        buy_sol: e.body.sol,
        n_buys: top.buys,
        n_called: top.called,
        lag_med_s: top.f.lag_med_s,
        buy_to_call_rate: top.f.buy_to_call_rate,
        post_call_net: top.f.post_call_net,
        miss_net: top.f.miss_net,
        edge: top.f.edge,
        edge_norm: Math.min(1, Math.max(0, 0.5 + 2.5 * top.f.edge)), // a [0,1] score input: 0.5 at break-even, 1 at +20% expected
        dump_rate: top.f.dump_rate,
        creator_share: top.f.creator_share,
        n_calls: top.f.n_calls,
        med_peak: median(peaks),
        p_peak: peaks.length ? peaks.filter((x) => x >= P.peakAt).length / peaks.length : null,
        pop_rate: pr.rate,
        callers_buying: each.length,
        horizon_min: H,
      },
      confidence: Math.min(1, (top.buys + P.priorN) / 20),
      validMs: H * MIN,
      inputs: [e.id],
      analyzer: "precall@1",
      at: e.seen_time,
    });
    // the detection is about this buyer: its own chance to call is what the Scorekeeper grades
    const found = each.find((x) => x.wallet === e.body.wallet);
    const ownP = found ? found.p : callerFields(await callerRecord(tx, e.body.wallet, now), pr).buy_to_call_rate;
    await tape.emitIn(tx, "precall.detected", { mint: e.body.mint, caller: e.body.wallet, trade_id: e.id, buy_sol: e.body.sol, p: ownP, horizon_min: H },
      { source: "analyzer", subject: e.body.mint, causes: [e.id], after: e.seen_time, dedupe: `precall.detected:${e.id}` });
  }

  return {
    name: "analyzers.precall",
    projection: true,
    topics: TRADES,
    batch: 500,
    async handle(events, tx) {
      const last = new Map<string, T>();
      for (const e of events as T[]) {
        clock.advance?.(Date.parse(e.seen_time));
        if (e.body.side === "buy" && (await qualifies(tx, e.body.wallet, e.body.mint, e.seen_time))) await precall(tx, e);
        if (e.topic === "trade.amm") await graduation(tx, e);
        last.set(e.body.mint, e);
      }
      for (const e of last.values()) await flow(tx, e);
    },
  };
}
