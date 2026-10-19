// Index signals (docs/PIPELINE.md): `risk.state` (rugs and bundles) and `wallets.smart_buying` (copyable wallets buying now).
// Everything is read from the Tape (coin.watched features, holders.snapshot, index.refreshed, trades), so a restart or
// a replay computes the same signals. Ways it fails: docs/PIPELINE.md section 6.
import type { BodyOf, Envelope } from "@asimog/contracts";
import { putSignal } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import { median } from "../lib/stats.ts";
import { loadLimits } from "../mind/risk.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";

const TRADES = ["trade.curve", "trade.amm"];
const MIN = 60_000;
const SMART_WINDOW_MIN = env.num("SMART_WINDOW_MIN");
type Smart = BodyOf<"index.refreshed">["smart"][number];

export function indexSignals(clock: Clock): Consumer {
  let smart: Map<string, Smart> | null = null;
  let version = 0;

  async function loadSmart(tx: Tx, at: string) {
    const [r] = await tx`select body from tape.events where topic = 'index.refreshed' and seen_time <= ${at} order by seen_time desc, id desc limit 1`;
    const b = r?.body as BodyOf<"index.refreshed"> | undefined;
    smart = new Map((b?.smart ?? []).map((s) => [s.wallet, s]));
    version = b?.version ?? 0;
  }

  /** The coin's latest features (the newer of the watch and the holder snapshot, which carries them fresh), its creator's sells since, against the owner's floor. */
  async function risk(tx: Tx, mint: string, e: Envelope) {
    const [w] = await tx`select id, seen_time, body from tape.events where topic = 'coin.watched' and subject = ${mint} and seen_time <= ${e.seen_time} order by seen_time desc, id desc limit 1`;
    if (!w) return;
    const [h] = await tx`select id, seen_time, body from tape.events where topic = 'holders.snapshot' and subject = ${mint} and seen_time <= ${e.seen_time} order by seen_time desc, id desc limit 1`;
    const hb = h?.body as BodyOf<"holders.snapshot"> | undefined;
    const f = hb?.features && new Date(h!.seen_time as string).getTime() >= new Date(w.seen_time as string).getTime() ? hb.features : (w.body as BodyOf<"coin.watched">).features;
    const cr = (w.body as BodyOf<"coin.watched">).creator_record;
    let creatorSold = f.creator_sold;
    if (f.creator) {
      const [s] = await tx`select coalesce(sum((body->>'tokens')::float) filter (where body->>'side' = 'sell'), 0) sold,
          coalesce(sum((body->>'tokens')::float) filter (where body->>'side' = 'buy'), 0) bought
        from tape.events where subject = ${mint} and topic = any(${TRADES}) and body->>'wallet' = ${f.creator} and seen_time <= ${e.seen_time}`;
      if ((s!.bought as number) > 0) creatorSold = Math.max(creatorSold, Math.min(1, (s!.sold as number) / (s!.bought as number)));
    }
    const L = await loadLimits(tx, e.seen_time);
    const top10 = hb ? hb.top10_share : null;
    const ratios = [f.bundle_share / L.max_bundle_share, (top10 ?? 0) / L.max_top10_share, creatorSold / L.max_creator_sold];
    await putSignal(tx, clock, {
      kind: "risk.state",
      subject: mint,
      value: {
        bundle_share: f.bundle_share, bundle_wallets: f.bundle_wallets, sniper_share: f.sniper_share,
        top10_share: top10, creator_sold: creatorSold, holders_est: f.holders_est,
        creator_launches_7d: cr?.launches_7d ?? null, creator_rug_rate: cr?.rug_rate ?? null,
        breaches: ratios.filter((x) => x > 1).length,
        score: Math.min(1, Math.max(...ratios) / 2), // 0.5 = at the floor, 1 = twice the floor
      },
      confidence: h ? 0.9 : 0.6,
      validMs: 30 * MIN,
      inputs: [w.id as string, ...(h ? [h.id as string] : []), e.id],
      analyzer: "risk@1",
      at: e.seen_time,
    });
  }

  async function smartBuying(tx: Tx, e: Envelope<BodyOf<"trade.curve">>) {
    const rows = await tx`select distinct body->>'wallet' w from tape.events where subject = ${e.body.mint} and topic = any(${TRADES}) and body->>'side' = 'buy'
      and seen_time > ${new Date(Date.parse(e.seen_time) - SMART_WINDOW_MIN * MIN).toISOString()} and seen_time <= ${e.seen_time} order by 1`;
    const who = rows.map((r) => smart!.get(r.w as string)).filter((x): x is Smart => !!x);
    if (!who.length) return;
    const best = who.reduce((a, b) => (b.copy_win_lcb > a.copy_win_lcb ? b : a));
    await putSignal(tx, clock, {
      kind: "wallets.smart_buying",
      subject: e.body.mint,
      value: {
        n: who.length,
        score: 1 - who.reduce((a, s) => a * (1 - Math.min(0.95, s.copy_win_lcb)), 1), // chance at least one of them is right
        best_wallet: best.wallet,
        copy_net_med: median(who.map((s) => s.copy_net)),
        lead_s_med: median(who.flatMap((s) => (s.lead_s == null ? [] : [s.lead_s]))),
        index_version: version,
      },
      confidence: Math.min(1, who.reduce((a, s) => a + s.n, 0) / 40),
      validMs: SMART_WINDOW_MIN * MIN,
      inputs: [e.id],
      analyzer: "wallets@1",
      at: e.seen_time,
    });
  }

  return {
    name: "analyzers.index",
    projection: true,
    topics: ["index.refreshed", "coin.watched", "holders.snapshot", ...TRADES],
    batch: 500,
    async handle(events, tx) {
      if (!smart && events[0]) await loadSmart(tx, events[0].seen_time);
      for (const e of events) {
        clock.advance?.(Date.parse(e.seen_time));
        if (e.topic === "index.refreshed") await loadSmart(tx, e.seen_time);
        else if (e.topic === "coin.watched" || e.topic === "holders.snapshot") await risk(tx, e.subject!, e);
        else {
          const t = e as Envelope<BodyOf<"trade.curve">>;
          if (t.body.side === "buy" && smart!.has(t.body.wallet)) await smartBuying(tx, t);
          else if (t.body.side === "sell") {
            const [w] = await tx`select body->'features'->>'creator' c from tape.events where topic = 'coin.watched' and subject = ${t.body.mint} and seen_time <= ${e.seen_time} order by seen_time desc limit 1`;
            if (w?.c === t.body.wallet) await risk(tx, t.body.mint, e); // the creator is selling: the floor may now be breached
          }
        }
      }
    },
  };
}
