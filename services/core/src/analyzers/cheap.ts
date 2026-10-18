// Cheap analyzers (docs/07): pure math on Memory, run on every relevant event. No models, no network.
import type { BodyOf, Envelope } from "@asimog/contracts";
import { putSignal } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import { curveFromPrice, quoteBuy } from "./curve-math.ts";

const MIN = 60_000;
const p = {
  echoWindowMin: env.num("ECHO_WINDOW_MIN", 10),
  hawkesMu: env.num("HAWKES_MU_PER_MIN", 0.01),
  hawkesAlpha: env.num("HAWKES_ALPHA", 0.6),
  hawkesBetaPerMin: env.num("HAWKES_BETA_PER_MIN", 1 / 3),
  waveN: env.int("WAVE_N", 3),
  waveHorizonMin: env.num("WAVE_HORIZON_MIN", 5),
  dnaHorizonMin: env.num("DNA_HORIZON_MIN", 5),
  mcPaths: env.int("HAWKES_MC_PATHS", 300),
  activeCallers: env.int("CALLERS_ACTIVE_MAX", 200),
  quoteSizes: (env.opt("QUOTE_SIZES_SOL") ?? "0.02,0.05,0.1,0.25,0.5").split(",").map(Number),
};

// ---------- age ----------
async function age(tx: Tx, clock: Clock, e: Envelope<BodyOf<"callout.created">>) {
  const [c] = await tx`select opportunity_age_min, pre_move_pct, first_on_coin from mem.callouts where callout_id = ${e.body.callout_id}`;
  if (!c) return;
  await putSignal(tx, clock, {
    kind: "age.opportunity",
    subject: e.body.callout_id,
    value: { minutes: c.opportunity_age_min, pre_move_pct: c.pre_move_pct, first_on_coin: c.first_on_coin, mint: e.body.mint },
    confidence: 1,
    validMs: 30 * MIN,
    inputs: [e.id],
    analyzer: "age@1",
    at: e.seen_time,
  });
}

// ---------- echo ----------
const shingles = (s: string) => {
  const t = s.toLowerCase().replace(/https?:\S+/g, "").replace(/[^a-z0-9$ ]/g, " ").replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  for (let i = 0; i + 5 <= t.length; i++) out.add(t.slice(i, i + 5));
  return out;
};
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

async function echo(tx: Tx, clock: Clock, e: Envelope<BodyOf<"callout.created">>) {
  const b = e.body;
  const earlier = await tx`
    select callout_id, wallet, text from mem.callouts
    where mint = ${b.mint} and callout_id <> ${b.callout_id} and wallet <> ${b.author_wallet}
      and created_at < ${b.created_at} and created_at > ${b.created_at}::timestamptz - make_interval(mins => ${p.echoWindowMin})
    order by created_at desc limit 20`;
  if (!earlier.length) {
    await putSignal(tx, clock, { kind: "echo.score", subject: b.callout_id, value: { score: 0, origin: null, mint: b.mint }, confidence: 0.6, validMs: 30 * MIN, inputs: [e.id], analyzer: "echo@1", at: e.seen_time });
    return;
  }
  // follow affinity: how often this author called a coin within the window after each earlier caller did (Beta(1,9) prior)
  const aff = await tx`
    with mine as (select mint, created_at from mem.callouts where wallet = ${b.author_wallet} and created_at < ${b.created_at})
    select o.wallet, count(distinct m.mint)::float as hits, (select count(*) from mine)::float as total
    from mine m join mem.callouts o on o.mint = m.mint and o.wallet = any(${earlier.map((r) => r.wallet as string)})
      and o.created_at < m.created_at and o.created_at > m.created_at - make_interval(mins => ${p.echoWindowMin})
    group by o.wallet`;
  const affBy = new Map(aff.map((r) => [r.wallet as string, ((r.hits as number) + 1) / ((r.total as number) + 10)]));
  const mine = shingles(b.text);
  let best = { score: 0, origin: null as string | null, follow: 0, text: 0, edge: 0 };
  for (const o of earlier) {
    const follow = affBy.get(o.wallet as string) ?? 0.1;
    const text = jaccard(mine, shingles(o.text as string));
    const edge = b.quoted_callout_id === o.callout_id ? 1 : 0;
    const score = 1 - (1 - follow) * (1 - text) * (1 - edge);
    if (score > best.score) best = { score, origin: o.callout_id as string, follow, text, edge };
  }
  await putSignal(tx, clock, {
    kind: "echo.score",
    subject: b.callout_id,
    value: { ...best, mint: b.mint, earlier: earlier.length },
    confidence: Math.min(1, 0.4 + earlier.length * 0.1),
    validMs: 30 * MIN,
    inputs: [e.id],
    analyzer: "echo@1",
    at: e.seen_time,
  });
}

// ---------- hawkes ----------
function hawkesWave(times: number[], weights: number[], nowMin: number, rand: () => number) {
  const { hawkesMu: mu, hawkesAlpha: alpha, hawkesBetaPerMin: beta, waveN, waveHorizonMin: H, mcPaths } = p;
  const lam = (t: number, ts: number[], ws: number[]) => {
    let s = mu;
    for (let i = 0; i < ts.length; i++) if (ts[i]! <= t) s += alpha * ws[i]! * beta * Math.exp(-beta * (t - ts[i]!));
    return s;
  };
  const intensity = lam(nowMin, times, weights);
  const meanQ = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 1;
  let hits = 0;
  let totalNew = 0;
  for (let k = 0; k < mcPaths; k++) {
    const ts = times.slice();
    const ws = weights.slice();
    let t = nowMin;
    let n = 0;
    // Ogata thinning with an upper bound that only decays between events
    for (;;) {
      const bound = lam(t, ts, ws) + alpha * meanQ * beta;
      t += -Math.log(1 - rand()) / bound;
      if (t > nowMin + H) break;
      if (rand() * bound <= lam(t, ts, ws)) {
        ts.push(t);
        ws.push(meanQ);
        n++;
        if (n > 50) break;
      }
    }
    totalNew += n;
    if (n >= waveN) hits++;
  }
  return { intensity_per_min: intensity, branching: alpha * meanQ, wave_p: hits / mcPaths, expected_new: totalNew / mcPaths };
}

const callerWeight = (followers: number | null) => Math.max(0.5, Math.min(2, 0.5 + Math.log10(1 + (followers ?? 0)) / 4));

async function hawkes(tx: Tx, clock: Clock, e: Envelope<BodyOf<"callout.created">>) {
  const b = e.body;
  const rows = await tx`
    select c.created_at, k.followers from mem.callouts c left join mem.callers k on k.wallet = c.wallet
    where c.mint = ${b.mint} and c.created_at > ${b.created_at}::timestamptz - interval '6 hours' and c.created_at <= ${b.created_at}
    order by c.created_at`;
  const t0 = Date.parse(b.created_at);
  const times = rows.map((r) => ((r.created_at as Date).getTime() - t0) / MIN);
  const weights = rows.map((r) => callerWeight(r.followers as number | null));
  const h = hawkesWave(times, weights, 0, clock.rand);
  const conf = Math.min(1, 0.3 + rows.length * 0.1);
  for (const [kind, value] of [
    ["hawkes.intensity", { per_min: h.intensity_per_min, callouts_6h: rows.length }],
    ["hawkes.branching", { n: h.branching }],
    ["hawkes.wave_p", { p: h.wave_p, expected_new: h.expected_new, n: p.waveN, horizon_min: p.waveHorizonMin }],
  ] as const)
    await putSignal(tx, clock, { kind, subject: b.mint, value, confidence: conf, validMs: 5 * MIN, inputs: [e.id], analyzer: "hawkes@1", at: e.seen_time });
}

// ---------- callers ----------
async function callers(tx: Tx, clock: Clock, e: Envelope<BodyOf<"callout.created">>) {
  const b = e.body;
  // only what was seen before this callout: our own resolved outcomes, never pump.fun's later-updated max_multiple
  const [dna] = await tx`
    select count(*)::int n,
      percentile_cont(0.5) within group (order by opportunity_age_min) med_age,
      percentile_cont(0.5) within group (order by pre_move_pct) med_pre,
      min(created_at) first_at, max(created_at) last_at
    from mem.callouts where wallet = ${b.author_wallet} and seen_at <= ${e.seen_time}`;
  const outs = await tx`select id, (body->>'net_multiple')::float net from (
      select distinct on (body->>'callout_id') id, body from tape.events
      where topic = 'outcome.measured' and seen_time <= ${e.seen_time} and body->>'author_wallet' = ${b.author_wallet} and (body->>'horizon_min')::int = ${p.dnaHorizonMin}
      order by body->>'callout_id', seen_time desc, id desc) x
    where body->>'coverage' = 'ok' order by id`;
  const nets = outs.map((r) => r.net as number).sort((a, b) => a - b);
  await putSignal(tx, clock, {
    kind: "caller.dna",
    subject: b.author_wallet,
    value: {
      ...dna,
      resolved: nets.length,
      net_win: nets.length ? nets.filter((x) => x > 1).length / nets.length : null,
      med_net: nets.length ? nets[Math.floor((nets.length - 1) / 2)]! : null,
      followers: b.author_followers,
      handle: b.author_handle,
    },
    confidence: Math.min(1, nets.length / 20),
    validMs: 24 * 60 * MIN,
    inputs: [e.id, ...outs.map((r) => r.id as string)],
    analyzer: "callers@2",
    at: e.seen_time,
  });
  // tier 1: who calls this coin within the horizon? base rate x affinity to callers already on the coin
  const H = p.waveHorizonMin;
  const active = await tx`
    with present as (select distinct wallet from mem.callouts where mint = ${b.mint} and created_at <= ${b.created_at})
    select k.wallet, k.handle, k.followers,
      (select count(*) from mem.callouts x where x.wallet = k.wallet and x.created_at > ${b.created_at}::timestamptz - interval '24 hours' and x.created_at <= ${b.created_at})::float as calls24,
      (select count(*) from mem.callouts x join mem.callouts y on y.mint = x.mint and y.wallet in (select wallet from present)
         and y.created_at < x.created_at and y.created_at > x.created_at - interval '30 minutes'
       where x.wallet = k.wallet and x.created_at <= ${b.created_at})::float as follows
    from mem.callers k
    where k.last_call_at > ${b.created_at}::timestamptz - interval '24 hours' and k.wallet not in (select wallet from present)
    order by k.last_call_at desc limit ${p.activeCallers}`;
  // Population model. Most callers are new wallets (352 of 381 on the first tape), so known callers alone
  // predict nothing. Callouts arrive at the measured rate; each coin's share follows preferential attachment
  // (callers pile onto coins that already have callouts). Known callers are the part we can name.
  const [pop] = await tx`
    with recent as (select mint, count(*)::float n from mem.callouts
      where created_at > ${b.created_at}::timestamptz - interval '60 minutes' and created_at <= ${b.created_at} group by 1)
    select coalesce(sum(n + 1), 1)::float weight, coalesce((select n from recent where mint = ${b.mint}), 0)::float here,
      (select count(*) from mem.callouts where created_at > ${b.created_at}::timestamptz - interval '30 minutes' and created_at <= ${b.created_at})::float n30,
      (select extract(epoch from (${b.created_at}::timestamptz - min(created_at))) / 60 from mem.callouts
        where created_at > ${b.created_at}::timestamptz - interval '24 hours')::float seen_min
    from recent`;
  const seenMin = Math.max(1, (pop?.seen_min as number) ?? 1); // memory may hold less than the window: rates use what was seen
  const lambda = ((pop?.n30 as number) ?? 0) / Math.min(30, seenMin); // callouts per minute, all coins
  const share = ((pop?.here as number) + 1) / Math.max(1, pop?.weight as number);
  const mu = lambda * H * share; // expected new callouts on this coin within H
  const probs = active.map((r) => {
    const ratePerMin = (r.calls24 as number) / Math.min(24 * 60, seenMin);
    const affinity = 1 + Math.min(5, r.follows as number);
    return { wallet: r.wallet as string, handle: r.handle as string | null, p: Math.min(0.9, (1 - Math.exp(-ratePerMin * H * share)) * affinity) };
  });
  const known = probs.reduce((a, b) => a + b.p, 0);
  // Poisson-binomial over known callers, convolved with Poisson(mu - known) for callers we cannot name
  let dist = [1];
  for (const { p: q } of probs) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k]! * (1 - q);
      next[k + 1] += dist[k]! * q;
    }
    dist = next;
  }
  const muU = Math.max(0, mu - known);
  const pois = Array.from({ length: p.waveN }, (_, k) => Math.exp(-muU) * muU ** k / [1, 1, 2, 6, 24, 120, 720, 5040][k]!);
  let below = 0; // P(total < N)
  for (let k = 0; k < p.waveN; k++) for (let j = 0; j <= k; j++) below += (dist[j] ?? 0) * pois[k - j]!;
  const atLeast = Math.max(0, Math.min(1, 1 - below));
  const expected = known + muU;
  probs.sort((a, b) => b.p - a.p);
  await putSignal(tx, clock, {
    kind: "callers.wave_p",
    subject: b.mint,
    value: { p: atLeast, expected_new: expected, known, rate_per_min: lambda, share, n: p.waveN, horizon_min: H, top: probs.slice(0, 10) },
    confidence: Math.min(1, seenMin / 30),
    validMs: 10 * MIN,
    inputs: [e.id],
    analyzer: "callers@1",
    at: e.seen_time,
  });
}

// ---------- curve ----------
async function curve(tx: Tx, clock: Clock, last: Map<string, Envelope<BodyOf<"trade.curve">>>) {
  for (const [mint, e] of last) {
    const t = e.body;
    if (t.on_curve === false || !t.price_sol) continue;
    const c = curveFromPrice(t.price_sol);
    await putSignal(tx, clock, {
      kind: "curve.progress",
      subject: mint,
      value: { progress: c.progress, real_sol: c.realSol, virtual_sol: c.vSol, price_sol: t.price_sol, mcap_usd: t.mcap_usd },
      confidence: 0.9,
      validMs: 60_000,
      inputs: [e.id],
      analyzer: "curve@1",
      at: e.seen_time,
    });
    await putSignal(tx, clock, {
      kind: "curve.quote",
      subject: mint,
      value: { quotes: p.quoteSizes.map((sol) => ({ sol, ...quoteBuy(c, sol) })) },
      confidence: 0.9,
      validMs: 30_000,
      inputs: [e.id],
      analyzer: "curve@1",
      at: e.seen_time,
    });
  }
}

export function cheapAnalyzers(clock: Clock): Consumer {
  return {
    name: "analyzers.cheap",
    projection: true,
    topics: ["callout.created", "trade.curve", "trade.amm"],
    batch: 500,
    async handle(events, tx) {
      const lastTrade = new Map<string, Envelope<BodyOf<"trade.curve">>>();
      for (const e of events) {
        clock.advance?.(Date.parse(e.seen_time));
        if (e.topic === "callout.created") {
          const c = e as Envelope<BodyOf<"callout.created">>;
          if (c.body.via === "history") continue;
          await age(tx, clock, c);
          await echo(tx, clock, c);
          await hawkes(tx, clock, c);
          await callers(tx, clock, c);
        } else lastTrade.set((e.body as { mint: string }).mint, e as never);
      }
      await curve(tx, clock, lastTrade);
    },
  };
}
