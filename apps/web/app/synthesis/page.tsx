"use client";
// Synthesis (docs/11, docs/24 P8): BettaFish reading our callout feed. The forum debate line by line, the feed and coin
// syntheses with the claims core kept, and the reports with every cited callout linked to its case file. Data only:
// a claim without a cite never reaches this page (core drops it), and the drop counts are shown.
import Link from "next/link";
import { Fragment } from "react";
import { fmt, useRoom } from "@/lib/live";

type Claim = { text: string; cites: string[] };
type Scores = {
  stance: { n: number; accuracy: number | null; up_rate: number | null; horizon_min: number } | null;
  claims: { producer: string; reports: number; kept: number; dropped: number; survival: number | null }[];
};
type Synthesis = {
  forum: { id: string; t: number; agent: string; text: string; cites: string[] }[];
  feed: { t: number; narratives: { title: string; summary: string; cites: string[] }[]; claims_total: number; claims_dropped: number } | null;
  coins: { mint: string; sym: string; t: number; stance: string; narrative: string; claims: Claim[]; claims_dropped: number }[];
  reports: { id: string; producer: string; kind: string; subject: string; summary: string; cites: string[]; parents: string[]; t: number; markdown: string | null }[];
  scores: Scores;
};

/** Text with its [cid:co_x] marks turned into links to the callout's case file. */
function Cited({ text }: { text: string }) {
  const parts = text.split(/\[cid:([\w-]+)\]/g);
  return <>{parts.map((p, i) => (i % 2 ? <Link key={i} className="mono" href={`/case/${p}`}>[{p}]</Link> : <Fragment key={i}>{p}</Fragment>))}</>;
}
const Cites = ({ ids }: { ids: string[] }) => (ids.length ? <span className="micro"> {ids.map((c) => <Link key={c} className="mono" href={`/case/${c}`}>{c} </Link>)}</span> : null);

export default function SynthesisPage() {
  const { data, error } = useRoom<Synthesis>("/v1/synthesis", 5000);
  const now = Date.now();
  const st = data?.scores.stance;
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>What the feed is saying, with its sources.</h1>
          <p>Three research engines read every callout, reply and trade we have seen, argue in a forum, and write reports. Every claim cites the callouts it rests on; the core drops any claim whose cite it has not seen.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Stance, 1 minus Brier at {st?.horizon_min ?? 60} min</dt><dd className="num">{st ? `${fmt.pct(st.accuracy)} of ${st.n}` : "·"}</dd></div>
          <div><dt className="micro">Feed claims kept</dt><dd className="num">{data?.feed ? `${data.feed.claims_total - data.feed.claims_dropped}/${data.feed.claims_total}` : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">The relay is unreachable ({error}).</p> : null}
      <div className="room-grid">
        <section className="room-section" aria-label="Forum">
          <h2 className="micro">Forum, newest last</h2>
          {!data ? <p className="empty">Loading the forum.</p> : !data.forum.length ? <p className="empty">No forum yet. It runs when two or more engines work on the same window.</p> : (
            <ol className="case-list">
              {data.forum.map((f) => (
                <li key={f.id}><span className="chip" data-tone={f.agent === "host" ? "accent" : undefined}>{f.agent}</span> <Cited text={f.text} /> <span className="micro">{fmt.ago(now - f.t)}</span></li>
              ))}
            </ol>
          )}
        </section>
        <section className="room-section" aria-label="Feed narratives">
          <h2 className="micro">Feed narratives</h2>
          {!data ? <p className="empty">Loading.</p> : !data.feed?.narratives.length ? <p className="empty">No feed synthesis yet. One runs every feed slot.</p> : (
            <ol className="case-list">
              {data.feed.narratives.map((n, i) => <li key={i}><strong>{n.title}</strong> <Cited text={n.summary} /><Cites ids={n.cites} /></li>)}
            </ol>
          )}
        </section>
      </div>
      <section className="room-section" aria-label="Coin stances">
        <h2 className="micro">Coin stances</h2>
        {!data ? <p className="empty">Loading.</p> : !data.coins.length ? <p className="empty">No coin synthesis yet. One runs when a coin is escalated.</p> : (
          <div className="table-wrap">
            <table className="ruled">
              <thead><tr><th scope="col">Coin</th><th scope="col">Stance</th><th scope="col">Narrative</th><th scope="col" className="num">Claims kept</th><th scope="col" className="num">Age</th></tr></thead>
              <tbody>
                {data.coins.map((c) => (
                  <tr key={c.mint}>
                    <th scope="row" className="mono">{c.sym}</th>
                    <td><span className="chip" data-tone={c.stance === "avoid" || c.stance === "bearish" ? "stress" : c.stance === "bullish" ? "accent" : undefined}>{c.stance}</span></td>
                    <td>{c.narrative}</td>
                    <td className="num">{c.claims.length}/{c.claims.length + c.claims_dropped}</td>
                    <td className="num">{fmt.ago(now - c.t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="room-section" aria-label="Claim survival">
        <h2 className="micro">Claim survival per engine, 24 h</h2>
        {!data ? <p className="empty">Loading.</p> : !data.scores.claims.length ? <p className="empty">No reports in the last 24 hours.</p> : (
          <table className="ruled">
            <thead><tr><th scope="col">Engine</th><th scope="col" className="num">Reports</th><th scope="col" className="num">Cites kept</th><th scope="col" className="num">Dropped</th><th scope="col" className="num">Survival</th></tr></thead>
            <tbody>
              {data.scores.claims.map((c) => (
                <tr key={c.producer}><th scope="row" className="mono">{c.producer}</th><td className="num">{c.reports}</td><td className="num">{c.kept}</td><td className="num">{c.dropped}</td><td className="num">{fmt.pct(c.survival)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="room-section" aria-label="Reports">
        <h2 className="micro">Reports</h2>
        {!data ? <p className="empty">Loading.</p> : !data.reports.length ? <p className="empty">No report yet.</p> : data.reports.map((r) => (
          <details key={r.id} className="case-section">
            <summary><span className="chip">{r.producer}</span> <span className="mono">{r.subject}</span> {r.summary} <span className="micro">{fmt.ago(now - r.t)}{r.parents.length ? `, read ${r.parents.length} swarm report${r.parents.length > 1 ? "s" : ""} (SIMULATED)` : ""}</span></summary>
            {r.markdown ? <div className="prose">{r.markdown.split(/\n{2,}/).map((p, i) => <p key={i}><Cited text={p.replace(/^#+\s*/, "")} /></p>)}</div> : null}
            <Cites ids={r.cites} />
          </details>
        ))}
      </section>
    </main>
  );
}
