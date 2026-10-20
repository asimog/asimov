"use client";
// Treasury (docs/UI.md): the PAPER balance, the reconciliation, and the Tape proof chain. Each chain link is recomputed
// here in the browser: sha256(prev | hour | count | ids_hash). A link that does not recompute shows BROKEN in crimson.
import { canonical } from "@asimog/contracts/canonical"; // the one canonical form: the segment hash is sha256(canonical(body))
import { useEffect, useRef, useState } from "react";
import { fmt, useRoom } from "@/lib/live";

type Link = { hour: string; prev: string; events: number; ids_hash: string; hash: string; open: boolean };
type Treasury = {
  as_of: number; mode: string; mandate_sol: number;
  paper: { equity_sol: number; net_sol: number; closed: number; open_cost_sol: number };
  reconciliation: { positions_net: number; tape_net: number; diff: number; ok: boolean };
  proofs: Proof[];
  sweeps: { at: number; sweep_id: string; collected_lamports: number; to_trade_lamports: number; to_agent_lamports: number; to_operator_lamports: number; split_sig: string | null }[];
  balances: { account: string; lamports: string }[];
  costs: { account: string; lamports: string }[];
  chain: Link[];
};
type Proof = { n: number; hour: string; sha256: string; prev_sha256: string; memo_sig: string | null; body: unknown };


const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_TX_URL; // a transaction explorer chosen by env, never hard-coded
const sol = (lamports: string | number) => (Number(lamports) / 1e9).toFixed(6);

/** Each proof segment (S6.6): its body hashes to its sha256 and it names the segment before it ("genesis" first). */
function useProofs(proofs: Proof[] | undefined) {
  const [state, set] = useState<string[]>([]);
  useEffect(() => {
    if (!proofs) return;
    let alive = true;
    void (async () => {
      const out: string[] = [];
      for (const [i, p] of proofs.entries()) {
        const again = await sha256(canonical(p.body));
        const linked = (i === 0 ? true : proofs[i - 1]!.sha256 === p.prev_sha256) && (p.body as { prev_sha256?: string }).prev_sha256 === p.prev_sha256;
        out.push(again === p.sha256 && linked ? "verified" : "broken");
      }
      if (alive) set(out);
    })();
    return () => {
      alive = false;
    };
  }, [proofs]);
  return state;
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** "verified" when the link recomputes and points at the one before it; "open" for the hour still filling. */
function useVerified(chain: Link[] | undefined) {
  const [state, set] = useState<string[]>([]);
  const done = useRef(new Map<string, string>()); // a link's inputs never change: each is hashed once, not on every poll
  useEffect(() => {
    if (!chain) return;
    let alive = true;
    void (async () => {
      const out: string[] = [];
      for (const [i, l] of chain.entries()) {
        const input = `${l.prev}|${l.hour}|${l.events}|${l.ids_hash}`;
        const again = done.current.get(input) ?? (await sha256(input));
        done.current.set(input, again);
        const linked = i === 0 || chain[i - 1]!.hash === l.prev;
        out.push(again !== l.hash || !linked ? "broken" : l.open ? "open" : "verified");
      }
      if (alive) set(out);
    })();
    return () => {
      alive = false;
    };
  }, [chain]);
  return state;
}

export default function TreasuryPage() {
  const { data, error } = useRoom<Treasury>("/v1/treasury", 10_000);
  const states = useVerified(data?.chain);
  const ok = states.filter((s) => s === "verified").length;
  const proofStates = useProofs(data?.proofs);
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>Where the money is, with proofs.</h1>
          <p>PAPER: no money has moved. The balance is the mandate plus the net of every closed paper position. The chain below fingerprints the Tape hour by hour, each hour linked to the one before, so a changed event would break every link after it.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Balance, paper</dt><dd className="num">{data ? `${data.paper.equity_sol.toFixed(4)} SOL` : "·"}</dd></div>
          <div><dt className="micro">Net, paper</dt><dd className="num" data-sign={data && data.paper.net_sol < 0 ? "down" : undefined}>{data ? `${fmt.signed(data.paper.net_sol, 4)} SOL` : "·"}</dd></div>
          <div><dt className="micro">Closed</dt><dd className="num">{data ? data.paper.closed : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">The relay is unreachable ({error}).</p> : null}
      {error && data ? <p className="micro">Stale: the relay stopped answering ({error}); these numbers are from its last answer.</p> : null}
      <div className="room-grid">
        <section className="room-section" aria-label="Reconciliation">
          <h2 className="micro">Reconciliation</h2>
          {!data ? <p className="empty">Loading.</p> : (
            <>
              <p data-recon={data.reconciliation.ok ? "ok" : "mismatch"}>
                <span className="chip" data-tone={data.reconciliation.ok ? "accent" : "stress"}>{data.reconciliation.ok ? "sums agree" : "MISMATCH"}</span>
              </p>
              <table className="ruled">
                <tbody>
                  <tr><th scope="row">Closed positions, summed</th><td className="num">{fmt.signed(data.reconciliation.positions_net, 6)} SOL</td></tr>
                  <tr><th scope="row">position.closed events, summed</th><td className="num">{fmt.signed(data.reconciliation.tape_net, 6)} SOL</td></tr>
                  <tr><th scope="row">Difference</th><td className="num">{data.reconciliation.diff.toExponential(1)} SOL</td></tr>
                  <tr><th scope="row">Held in open positions</th><td className="num">{data.paper.open_cost_sol.toFixed(4)} SOL</td></tr>
                </tbody>
              </table>
            </>
          )}
        </section>
        <section className="room-section" aria-label="Sweeps and costs">
          <h2 className="micro">Sweeps and costs</h2>
          {!data ? null : !data.sweeps.length ? <p className="empty">No sweeps yet. Fees are swept every 10 minutes once live trading starts; in paper mode nothing is earned or moved.</p> : (
            <table className="ruled">
              <thead><tr><th>When</th><th className="num">Collected</th><th className="num">Trade</th><th className="num">Agent</th><th className="num">Operator</th></tr></thead>
              <tbody>{data.sweeps.map((s) => <tr key={s.sweep_id}><td className="mono">{new Date(s.at).toISOString().slice(0, 16).replace("T", " ")}</td><td className="num">{sol(s.collected_lamports)}</td><td className="num">{sol(s.to_trade_lamports)}</td><td className="num">{sol(s.to_agent_lamports)}</td><td className="num">{sol(s.to_operator_lamports)}</td></tr>)}</tbody>
            </table>
          )}
          {!data ? null : !data.balances.length ? <p className="empty">No wallet balances in the books yet.</p> : (
            <table className="ruled"><thead><tr><th>Account</th><th className="num">SOL</th></tr></thead>
              <tbody>{data.balances.map((b) => <tr key={b.account}><td className="mono">{b.account.length > 24 ? `${b.account.slice(0, 12)}…${b.account.slice(-6)}` : b.account}</td><td className="num">{sol(b.lamports)}</td></tr>)}</tbody></table>
          )}
          {!data ? null : !data.costs.length ? <p className="empty">No costs booked yet. Network fees and job costs appear here once they are paid.</p> : (
            <table className="ruled"><thead><tr><th>Cost</th><th className="num">SOL</th></tr></thead>
              <tbody>{data.costs.map((c) => <tr key={c.account}><td className="mono">{c.account.replace(/^exp:/, "")}</td><td className="num">{sol(c.lamports)}</td></tr>)}</tbody></table>
          )}
        </section>
      </div>
      <section className="room-section" aria-label="Hourly proofs">
        <h2 className="micro">Hourly proofs · {data ? `${proofStates.filter((s) => s === "verified").length} of ${data.proofs.length} segments verified in your browser` : "loading"}</h2>
        {!data ? null : !data.proofs.length ? <p className="empty">No proof segments yet. The Treasurer writes one per hour once live books run, and puts its hash on chain as a memo.</p> : (
          <ol className="chain" data-proofs>
            {data.proofs.map((p, i) => (
              <li key={p.n} data-hash={p.sha256} data-state={proofStates[i] ?? "checking"}>
                <span className="mono">#{p.n} {p.hour.slice(0, 13).replace("T", " ")}h</span>
                <span className="mono chain-hash" title={p.sha256}>{p.sha256.slice(0, 20)}</span>
                {p.memo_sig ? (EXPLORER ? <a className="mono" href={`${EXPLORER}${p.memo_sig}`}>memo</a> : <span className="mono" title={p.memo_sig}>memo {p.memo_sig.slice(0, 8)}</span>) : <span className="mono">no memo yet</span>}
                <a className="mono" download={`proof-${p.n}.json`} href={`data:application/json,${encodeURIComponent(JSON.stringify(p.body))}`}>segment</a>
                <span className="chip" data-tone={proofStates[i] === "broken" ? "stress" : proofStates[i] === "verified" ? "accent" : undefined}>{proofStates[i] === "broken" ? "BROKEN" : proofStates[i] ?? "checking"}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="room-section" aria-label="Proof chain">
        <h2 className="micro">Tape fingerprint · {data ? `${ok} of ${data.chain.length} hours verified in your browser` : "loading"}</h2>
        {!data ? null : !data.chain.length ? <p className="empty">The Tape is empty.</p> : (
          <ol className="chain">
            {data.chain.map((l, i) => (
              <li key={l.hour} data-hash={l.hash} data-state={states[i] ?? "checking"}>
                <span className="mono">{l.hour.slice(0, 13).replace("T", " ")}h</span>
                <span className="num">{l.events.toLocaleString("en-US")} events</span>
                <span className="mono chain-hash" title={l.hash}>{l.hash.slice(0, 20)}</span>
                <span className="chip" data-tone={states[i] === "broken" ? "stress" : states[i] === "verified" ? "accent" : undefined}>{states[i] === "broken" ? "BROKEN" : states[i] ?? "checking"}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
