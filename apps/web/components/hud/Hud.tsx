"use client";
// The KPI row over the Field (docs/UI.md): caps label over a numeral, each number read from the relay snapshot.
// At most one number in the accent: paper net, because it is the one that says whether the firm earns.
import { fmt, useLive } from "@/lib/live";

export function Hud() {
  const snap = useLive((s) => s.snap);
  const viewers = snap?.viewers;
  const net = snap?.pool.net ?? null;
  const kpis: { k: string; v: string; hot?: boolean; title: string }[] = [
    { k: "Mode", v: snap ? snap.mode.toUpperCase() : "·", title: "PAPER: every trade is simulated through the fill model; no money moves" },
    { k: "Mandate", v: snap ? `${snap.mandate_sol} SOL` : "·", title: "Capital the owner gave the firm" },
    { k: "Floor", v: snap ? `${Math.round(snap.floor_frac * 100)}%` : "·", title: "Daily loss stop: trading halts after this share is lost in a day" },
    { k: "Milestone", v: snap?.milestone ?? "·", title: "Financial milestone reached (docs/SYSTEM.md)" },
    { k: "Strategies", v: snap ? `${snap.pool.alive}` : "·", title: "Strategies alive in the pool, each trading its own paper book" },
    { k: "Open", v: snap ? `${snap.pool.open}` : "·", title: "Open paper positions" },
    { k: "Pool net, paper", v: net == null ? "·" : `${fmt.signed(net, 3)} SOL`, hot: true, title: "Summed net of every closed paper position across all strategy books, after fees, slippage and rent" },
    { k: "Commits", v: snap ? `${snap.pool.commits}` : "·", title: "Decisions hashed before their outcome" },
    { k: "Counsel", v: snap ? `${snap.counsel_queue}` : "·", title: "Requests waiting for the human counsel" },
    { k: "Viewers", v: viewers == null ? "·" : `${viewers}`, title: "People watching this stream now" },
  ];
  return (
    <section className="hud" aria-label="Firm state">
      <dl>
        {kpis.map((x) => (
          <div key={x.k} className={x.hot ? "kpi hot" : "kpi"} title={x.title} data-loading={snap ? undefined : "yes"}>
            <dt className="micro">{x.k}</dt>
            <dd className="num">{x.v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
