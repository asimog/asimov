"use client";
// Simulations (docs/11, docs/24 P8): MiroShark swarms on escalated coins. SIMULATED, all of it: measured callers and
// follower archetypes act on a copy of the coin's curve, with a Twitter stand-in beside it. Branch A runs as is, branch
// B with our disclosed callout; the difference is the impact. The swarm's wave probability is scored against the real feed.
import { fmt, useRoom } from "@/lib/live";

type Run = {
  id: string; mint: string; sym: string; t: number; simulated: true; wave_p: number; samples: number; truncated: boolean; preset: string;
  d_callers: number | null; d_net_sol: number | null;
  drift: Record<string, { round: number; stance: Record<string, number> }[]>;
  posts: { branch: "A" | "B"; platform: string; agent: string; archetype: string; text: string }[];
  report: { id: string; summary: string; markdown: string | null; graph: { features: string; observed: number; simulated: number } | null } | null;
};
type Sims = { runs: Run[]; scores: { swarm: { n: number; brier: number | null; base_rate: number | null; horizon_min: number } | null } };

function Drift({ rounds }: { rounds: { round: number; stance: Record<string, number> }[] }) {
  const keys = [...new Set(rounds.flatMap((r) => Object.keys(r.stance)))];
  if (!rounds.length) return <p className="empty">No belief drift recorded.</p>;
  return (
    <table className="ruled">
      <thead><tr><th scope="col">Round</th>{keys.map((k) => <th key={k} scope="col" className="num">{k.replace(/_/g, " ")}</th>)}</tr></thead>
      <tbody>
        {rounds.map((r) => (
          <tr key={r.round}><th scope="row" className="num">{r.round}</th>{keys.map((k) => <td key={k} className="num" data-sign={(r.stance[k] ?? 0) < 0 ? "down" : undefined}>{r.stance[k] == null ? "·" : fmt.signed(r.stance[k]!, 2)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SimulationsPage() {
  const { data, error } = useRoom<Sims>("/v1/simulations", 8000);
  const now = Date.now();
  const sw = data?.scores.swarm;
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>How a callout might spread. <span className="chip" data-tone="stress">SIMULATED</span></h1>
          <p>Each run is a simulation, not a forecast and not a record of anyone. Callers are personas built from measured records with hashed names; followers are archetypes. Branch B adds our own callout, position disclosed. The wave probability is later scored against what the real feed did.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Swarm Brier, {sw?.horizon_min ?? 120} min</dt><dd className="num">{sw?.brier != null ? `${sw.brier.toFixed(3)} on ${sw.n}` : "·"}</dd></div>
          <div><dt className="micro">Real wave rate</dt><dd className="num">{sw ? fmt.pct(sw.base_rate) : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">The relay is unreachable ({error}).</p> : null}
      {!data ? <p className="empty">Loading the runs.</p> : !data.runs.length ? <p className="empty">No swarm yet. A swarm runs when a coin is escalated.</p> : data.runs.map((r) => (
        <section key={r.id} className="room-section" aria-label={`Swarm on ${r.sym}`}>
          <h2 className="micro"><span className="chip" data-tone="stress">SIMULATED</span> {r.sym} · {r.preset} · {fmt.ago(now - r.t)}{r.truncated ? " · stopped at its budget" : ""}</h2>
          <dl className="room-kpis">
            <div className="hot"><dt className="micro">Wave probability</dt><dd className="num">{fmt.pct(r.wave_p)} of {r.samples}</dd></div>
            <div><dt className="micro">B minus A, callers</dt><dd className="num">{r.d_callers == null ? "·" : fmt.signed(r.d_callers, 1)}</dd></div>
            <div><dt className="micro">B minus A, net SOL</dt><dd className="num">{r.d_net_sol == null ? "·" : fmt.signed(r.d_net_sol, 3)}</dd></div>
            <div><dt className="micro">Graph edges, simulated / observed</dt><dd className="num">{r.report?.graph ? `${r.report.graph.simulated} / ${r.report.graph.observed}` : "·"}</dd></div>
          </dl>
          <div className="room-grid">
            {(["A", "B"] as const).filter((b) => r.drift[b]).map((b) => (
              <div key={b}>
                <h3 className="micro">Belief drift, branch {b}{b === "B" ? " (our callout)" : ""}, mean stance from −1 to +1</h3>
                <Drift rounds={r.drift[b]!} />
              </div>
            ))}
          </div>
          <h3 className="micro">Simulated posts</h3>
          {!r.posts.length ? <p className="empty">The agents posted nothing.</p> : (
            <ol className="case-list">
              {r.posts.slice(0, 24).map((p, i) => <li key={i}><span className="chip">SIMULATED {p.branch} · {p.platform}</span> <span className="mono">{p.agent}</span> {p.text}</li>)}
            </ol>
          )}
          {r.report ? (
            <details className="case-section">
              <summary><span className="chip" data-tone="stress">SIMULATED</span> Swarm Report: {r.report.summary}</summary>
              {r.report.markdown ? <div className="prose">{r.report.markdown.split(/\n{2,}/).map((p, i) => (/^#/.test(p) ? <h4 key={i} className="micro">{p.replace(/^#+\s*/, "")}</h4> : <p key={i}>{p}</p>))}</div> : null}
            </details>
          ) : null}
        </section>
      ))}
    </main>
  );
}
