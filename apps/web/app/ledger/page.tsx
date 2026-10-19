"use client";
// The Ledger (docs/UI.md): every paper position, open and closed, and every post the house queued. Losses stay in.
import { fmt, useRoom } from "@/lib/live";

type Pos = { id: string; sym: string; family: string; opened_at: number; closed_at: number | null; cost_sol: number; proceeds_sol: number; net_sol: number | null; exit_reason: string | null };
type Post = { t: number; kind: string; sym: string; text: string; house: string };
type Ledger = { positions: Pos[]; posts: Post[] };

export default function LedgerPage() {
  const { data, error } = useRoom<Ledger>("/v1/ledger", 5000);
  const closed = data?.positions.filter((p) => p.closed_at) ?? [];
  const net = closed.reduce((a, p) => a + (p.net_sol ?? 0), 0);
  const wins = closed.filter((p) => (p.net_sol ?? 0) > 0).length;
  const now = Date.now();
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>Every trade, every post. Losses included.</h1>
          <p>Paper positions from every strategy book, net of pump fees, slippage, priority fees and token-account rent. The house posts are what Asimog would publish; none are posted until live trading starts.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Net, last 300</dt><dd className="num" data-sign={net < 0 ? "down" : undefined}>{data ? `${fmt.signed(net, 3)}` : "·"}</dd></div>
          <div><dt className="micro">Won</dt><dd className="num">{data ? `${wins}/${closed.length}` : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">The relay is unreachable ({error}).</p> : null}
      <section className="room-section" aria-label="House posts">
        <h2 className="micro">House posts, paper</h2>
        {!data ? <p className="empty">Loading posts.</p> : !data.posts.length ? <p className="empty">No posts yet. The house posts after its first paper buy of a calling strategy.</p> : (
          <div className="table-wrap">
            <table className="ruled">
              <thead><tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Coin</th><th scope="col">Text</th></tr></thead>
              <tbody>
                {data.posts.map((p, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: posts have no id and the list is rendered whole each time
                  <tr key={i}>
                    <td className="mono">{fmt.ago(now - p.t)}</td>
                    <td><span className="chip" data-tone={p.kind === "callout" ? "accent" : p.kind === "reply" ? "stress" : undefined}>{p.kind}</span></td>
                    <td className="mono">{p.sym}</td>
                    <td>{p.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="room-section" aria-label="Positions">
        <h2 className="micro">Positions</h2>
        {!data ? <p className="empty">Loading positions.</p> : (
          <div className="table-wrap">
            <table className="ruled">
              <thead>
                <tr><th scope="col">Opened</th><th scope="col">Coin</th><th scope="col">Strategy</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Back</th><th scope="col" className="num">Net</th><th scope="col">Exit</th></tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{fmt.ago(now - p.opened_at)}</td>
                    <td className="mono">{p.sym}</td>
                    <td>{p.family.replaceAll("_", " ")}</td>
                    <td className="num">{p.cost_sol.toFixed(4)}</td>
                    <td className="num">{p.closed_at ? p.proceeds_sol.toFixed(4) : "open"}</td>
                    <td className="num" data-sign={(p.net_sol ?? 0) < 0 ? "down" : undefined}>{p.net_sol == null ? "·" : fmt.signed(p.net_sol, 4)}</td>
                    <td className="mono">{p.exit_reason ? p.exit_reason.split(":").pop()!.replaceAll("_", " ") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
