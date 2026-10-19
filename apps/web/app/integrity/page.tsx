"use client";
// Integrity, the rug feed room (docs/UI.md, docs/PIPELINE.md): risk evidence per coin in three classes kept apart (docs/SYSTEM.md
// section 10), then the caller ledger with its denominators, the Index's copyable wallets, and the rug and bundle floor at work.
// Indicators and limits only: no verdicts about people.
import { fmt, useRoom } from "@/lib/live";

type RugCoin = {
  mint: string; sym: string;
  observed: { t: number; text: string }[];
  computed: { score: number; breaches: number; bundle_share: number | null; top10_share: number | null; creator_sold: number | null; creator_rug_rate: number | null; confidence: number; method: string; t: number; stale: boolean } | null;
  ai_judgment: { stance: string; by: string; t: number } | null;
};
type RugFeed = { coins: RugCoin[]; reports_scanned: number; risk_coins: number };

function RugFeedSection() {
  const { data, error } = useRoom<RugFeed>("/v1/rugfeed", 10_000);
  const now = Date.now();
  return (
    <section className="room-section" aria-label="Rug feed" data-rugfeed={data ? data.coins.length : undefined}>
      <h2 className="micro">Rug feed, 24 h · indicators, not proof · scanned {data?.reports_scanned ?? "·"} replies, {data?.risk_coins ?? "·"} risk reads</h2>
      {error && !data ? <p className="empty">The relay is unreachable ({error}).</p> : !data ? <p className="empty">Loading the rug feed.</p> : !data.coins.length ? (
        <p className="empty">No coin at or past a risk floor, and no reply reporting a rug, in 24 hours. A coin appears here when its risk read breaches a floor or a scraped reply reports a rug or a dev dump.</p>
      ) : data.coins.map((c) => (
        <article key={c.mint} className="case-section" data-mint={c.mint}>
          <h3 className="micro">{c.sym} <span className="mono">{c.mint.slice(0, 4)}…{c.mint.slice(-4)}</span></h3>
          <div className="room-grid">
            <div data-class="observed">
              <h4 className="micro">Observed: replies that report a rug</h4>
              {!c.observed.length ? <p className="empty">No reply reports one.</p> : (
                <ol className="case-list">{c.observed.map((o) => <li key={`${o.t}${o.text}`}><span className="num">{fmt.ago(now - o.t)}</span> <q className="mono">{o.text}</q></li>)}</ol>
              )}
            </div>
            <div data-class="computed">
              <h4 className="micro">Computed: risk read{c.computed ? `, ${c.computed.method}${c.computed.stale ? ", stale" : ""}` : ""}</h4>
              {!c.computed ? <p className="empty">No risk read in 24 h.</p> : (
                <dl className="room-kpis" data-stale={c.computed.stale ? "yes" : undefined}>
                  <div><dt className="micro">Score, 0.5 at the floor</dt><dd className="num">{c.computed.score.toFixed(2)}</dd></div>
                  <div><dt className="micro">Floors breached</dt><dd className="num">{c.computed.breaches}</dd></div>
                  <div><dt className="micro">Bundle share</dt><dd className="num">{fmt.pct(c.computed.bundle_share)}</dd></div>
                  <div><dt className="micro">Top 10 share</dt><dd className="num">{fmt.pct(c.computed.top10_share)}</dd></div>
                  <div><dt className="micro">Creator sold</dt><dd className="num">{fmt.pct(c.computed.creator_sold)}</dd></div>
                  <div><dt className="micro">Creator past coins that fell</dt><dd className="num">{fmt.pct(c.computed.creator_rug_rate)}</dd></div>
                  <div><dt className="micro">Confidence, read</dt><dd className="num">{fmt.pct(c.computed.confidence)}, {fmt.ago(now - c.computed.t)}</dd></div>
                </dl>
              )}
            </div>
            <div data-class="ai_judgment">
              <h4 className="micro">AI judgment</h4>
              {!c.ai_judgment ? <p className="empty">No model has read this coin.</p> : <p>The model judged the coin {c.ai_judgment.stance} ({c.ai_judgment.by}, {fmt.ago(now - c.ai_judgment.t)}).</p>}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

type Caller = { wallet: string; who: string; calls: number; ok: number; wins: number; med_net: number | null };
type Integrity = {
  callers: Caller[];
  smart: { wallet: string; n: number; copy_net: number; copy_win_lcb: number; lead_s: number | null }[];
  archetypes: { archetype: string; n: number }[];
  refused: { reason: string; n: number }[];
  watched: { reason: string; n: number }[];
};

export default function IntegrityPage() {
  const { data, error } = useRoom<Integrity>("/v1/integrity", 10_000);
  const house = data?.callers.find((c) => c.wallet === "house");
  const crowd = data?.callers.filter((c) => c.wallet !== "house") ?? [];
  const cOk = crowd.reduce((a, c) => a + c.ok, 0);
  const cWin = crowd.reduce((a, c) => a + c.wins, 0);
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>Which coins look unsafe, measured. Never accused. <span className="chip">PAPER</span></h1>
          <p>The rug feed keeps what we saw, what we computed and what a model judged apart. Every callout is scored the same way: what 0.02 SOL bought when the call appeared was worth 5 minutes later, after fees. The house is scored as one more caller. Calls without full trade coverage are counted and excluded, never dropped.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Crowd won, 5 min</dt><dd className="num">{data ? `${cWin}/${cOk}` : "·"}</dd></div>
          <div><dt className="micro">House won</dt><dd className="num">{house ? `${house.wins}/${house.ok}` : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">The relay is unreachable ({error}).</p> : null}
      <RugFeedSection />
      <section className="room-section" aria-label="Caller ledger">
        <h2 className="micro">Caller ledger, 5 minutes, net of costs</h2>
        {!data ? <p className="empty">Loading the ledger.</p> : (
          <div className="table-wrap">
            <table className="ruled">
              <thead>
                <tr><th scope="col">Caller</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Measured</th><th scope="col" className="num">Won</th><th scope="col" className="num">Median net</th></tr>
              </thead>
              <tbody>
                {data.callers.map((c) => (
                  <tr key={c.wallet} data-house={c.wallet === "house" ? "yes" : undefined}>
                    <th scope="row" className="mono">{c.who}</th>
                    <td className="num">{c.calls}</td>
                    <td className="num">{c.ok}</td>
                    <td className="num">{c.wins}</td>
                    <td className="num" data-sign={c.med_net != null && c.med_net < 1 ? "down" : undefined}>{c.med_net == null ? "·" : `${c.med_net.toFixed(2)}x`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="room-grid">
        <section className="room-section" aria-label="Copyable wallets">
          <h2 className="micro">Copyable wallets, from the Index</h2>
          {!data ? <p className="empty">Loading.</p> : !data.smart.length ? (
            <p className="empty">None yet. A wallet qualifies after 8 or more coins whose copied trades, with our delay and fees, beat the population. The Index needs hours of trades first.</p>
          ) : (
            <table className="ruled">
              <thead><tr><th scope="col">Wallet</th><th scope="col" className="num">Coins</th><th scope="col" className="num">Copy net</th><th scope="col" className="num">Win, lower bound</th><th scope="col" className="num">Lead</th></tr></thead>
              <tbody>
                {data.smart.map((w) => (
                  <tr key={w.wallet}>
                    <th scope="row" className="mono">{w.wallet}</th>
                    <td className="num">{w.n}</td>
                    <td className="num">{w.copy_net.toFixed(2)}x</td>
                    <td className="num">{(w.copy_win_lcb * 100).toFixed(0)}%</td>
                    <td className="num">{w.lead_s == null ? "·" : `${Math.round(w.lead_s)} s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="room-section" aria-label="Risk floor">
          <h2 className="micro">Refused by the risk gate, 24 h</h2>
          {!data ? <p className="empty">Loading.</p> : (
            <ul className="bars">
              {data.refused.map((r) => (
                <li key={r.reason}>
                  <span className="mono">{r.reason.replaceAll("_", " ")}</span>
                  <span className="bar" style={{ inlineSize: `${(r.n / Math.max(1, data.refused[0]!.n)) * 100}%` }} />
                  <span className="num">{r.n}</span>
                </li>
              ))}
            </ul>
          )}
          <h2 className="micro">Why the Scout started watching, 24 h</h2>
          {!data ? null : (
            <ul className="bars">
              {data.watched.map((r) => (
                <li key={r.reason}>
                  <span className="mono">{r.reason.replaceAll("_", " ")}</span>
                  <span className="bar" style={{ inlineSize: `${(r.n / Math.max(1, data.watched[0]!.n)) * 100}%` }} />
                  <span className="num">{r.n}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
