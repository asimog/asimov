"use client";
// Integrity (docs/11, docs/07): the caller ledger with its denominators, the Index's copyable wallets, and the rug and
// bundle floor at work. Data and limits only: no verdicts about people.
import { useRoom } from "@/lib/live";

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
  const crowd = data?.callers.filter((c) => !c.wallet.startsWith("house")) ?? [];
  const cOk = crowd.reduce((a, c) => a + c.ok, 0);
  const cWin = crowd.reduce((a, c) => a + c.wins, 0);
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>Who moves coins, measured. Never accused.</h1>
          <p>Every callout is scored the same way: what 0.02 SOL bought when the call appeared was worth 5 minutes later, after fees. The house is scored as one more caller. Calls without full trade coverage are counted and excluded, never dropped.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Crowd won, 5 min</dt><dd className="num">{data ? `${cWin}/${cOk}` : "·"}</dd></div>
          <div><dt className="micro">House won</dt><dd className="num">{house ? `${house.wins}/${house.ok}` : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">The relay is unreachable ({error}).</p> : null}
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
                  <tr key={c.wallet} data-house={c.wallet.startsWith("house") ? "yes" : undefined}>
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
