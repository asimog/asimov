// Flow and pre-call analyzers (docs/07 flow, precall). A callout is announced by its author's own buy (posting
// requires holding), so a known caller's buy on a coin they have not called is a forecast of a callout.
// Every read is bounded by the event's seen_time: memory may already hold callouts from later in the window.
import type { BodyOf, Envelope } from "@asimog/contracts";
import { putSignal } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";

const P = {
  horizonMin: env.num("PRECALL_HORIZON_MIN", 5),
  priorN: env.num("PRECALL_PRIOR_N", 4),
  peakAt: env.num("PRECALL_PEAK_MULT", 1.2),
};
const TRADES = ["trade.curve", "trade.amm"];
const MIN = 60_000;
type T = Envelope<BodyOf<"trade.curve">>;

const iso = (ms: number) => new Date(ms).toISOString();
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[(xs.length - 1) >> 1]! : null);

/** Was `wallet` a known caller at `at`, and had it not called `mint` by then? */
async function qualifies(tx: Tx, wallet: string, mint: string, at: string) {
  const [r] = await tx`select
      exists (select 1 from mem.callouts where wallet = ${wallet} and seen_at < ${at}) known,
      exists (select 1 from mem.callouts where wallet = ${wallet} and mint = ${mint} and seen_at <= ${at}) called`;
  return (r!.known as boolean) && !(r!.called as boolean);
}

/**
 * Closed record: first qualifying buy per coin whose horizon ended by `nowMs`, and whether a callout by the same
 * wallet followed within the horizon. `wallet = null` gives the population over every known caller.
 */
async function record(tx: Tx, wallet: string | null, nowMs: number) {
  const H = P.horizonMin;
  const rows = await tx`
    with b as (
      select distinct on (t.body->>'wallet', t.subject) t.body->>'wallet' w, t.subject mint, t.seen_time
      from tape.events t
      where t.topic = any(${TRADES}) and t.body->>'side' = 'buy' and t.seen_time <= ${iso(nowMs - H * MIN)}
        ${wallet ? tx`and t.body->>'wallet' = ${wallet}` : tx``}
        and exists (select 1 from mem.callouts c where c.wallet = t.body->>'wallet' and c.seen_at < t.seen_time)
        and not exists (select 1 from mem.callouts c where c.wallet = t.body->>'wallet' and c.mint = t.subject and c.seen_at <= t.seen_time)
      order by t.body->>'wallet', t.subject, t.seen_time)
    select extract(epoch from (select min(c.seen_at) from mem.callouts c where c.wallet = b.w and c.mint = b.mint
      and c.seen_at > b.seen_time and c.seen_at <= b.seen_time + make_interval(mins => ${H})) - b.seen_time)::float lag_s
    from b`;
  const lags = rows.flatMap((r) => (r.lag_s == null ? [] : [r.lag_s as number]));
  return { buys: rows.length, called: lags.length, lags };
}

export function precallAnalyzers(clock: Clock): Consumer {
  const pop = new Map<number, number>(); // minute bucket -> population rate; a pure cache, so a restart recomputes the same value
  async function popRate(tx: Tx, nowMs: number) {
    const bucket = Math.floor(nowMs / MIN);
    if (!pop.has(bucket)) {
      const r = await record(tx, null, bucket * MIN);
      pop.set(bucket, (r.called + 1) / (r.buys + 2));
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
        callers_buying: cb!.n as number,
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
        and t.seen_time > ${iso(now - H * MIN)} and t.seen_time <= ${e.seen_time}
        and exists (select 1 from mem.callouts c where c.wallet = t.body->>'wallet' and c.seen_at < t.seen_time)
        and not exists (select 1 from mem.callouts c where c.wallet = t.body->>'wallet' and c.mint = t.subject and c.seen_at <= ${e.seen_time})
      order by 1`;
    const rate = await popRate(tx, now);
    const a0 = rate * P.priorN;
    const each = [];
    for (const b of buyers) {
      const r = await record(tx, b.w as string, now);
      each.push({ wallet: b.w as string, p: (a0 + r.called) / (P.priorN + r.buys), ...r });
    }
    const top = each.reduce((a, b) => (b.p > a.p || (b.p === a.p && b.wallet < a.wallet) ? b : a));
    const peaks = (await tx`select (body->>'peak_multiple')::float peak from (
        select distinct on (body->>'callout_id') body from tape.events
        where topic = 'outcome.measured' and seen_time <= ${e.seen_time} and body->>'author_wallet' = ${top.wallet} and (body->>'horizon_min')::int = 3
        order by body->>'callout_id', seen_time desc, id desc) x where body->>'coverage' = 'ok'`).map((r) => r.peak as number);
    await putSignal(tx, clock, {
      kind: "precall.callout_p",
      subject: e.body.mint,
      value: {
        p: 1 - each.reduce((a, x) => a * (1 - x.p), 1),
        caller: top.wallet,
        caller_p: top.p,
        buy_sol: e.body.sol,
        n_buys: top.buys,
        n_called: top.called,
        lag_med_s: median(top.lags),
        med_peak: median(peaks),
        p_peak: peaks.length ? peaks.filter((x) => x >= P.peakAt).length / peaks.length : null,
        pop_rate: rate,
        callers_buying: each.length,
        horizon_min: H,
      },
      confidence: Math.min(1, (top.buys + P.priorN) / 20),
      validMs: H * MIN,
      inputs: [e.id],
      analyzer: "precall@1",
      at: e.seen_time,
    });
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
        last.set(e.body.mint, e);
      }
      for (const e of last.values()) await flow(tx, e);
    },
  };
}
