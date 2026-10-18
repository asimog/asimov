"use client";
// Rewind (S11.4): drag to a past time T and read the Board as it was live at T, plus the tape lines up to T.
// Nothing here moves except when the slider moves.
import { useEffect, useState } from "react";
import { fmt, RELAY } from "@/lib/live";

type Sig = { kind: string; subject: string; sym: string; confidence: number; produced_at: number; valid_until: number };
type Board = { at: number; range: { from: number; to: number }; total: number; kinds: { kind: string; n: number }[]; signals: Sig[]; lines: { id: string; t: number; text: string }[] };

export default function RewindPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`${RELAY}/v1/board${at == null ? "" : `?at=${at}`}`, { signal: ctl.signal });
        if (!r.ok) throw new Error(`relay answered ${r.status}`);
        setBoard((await r.json()) as Board);
        setError(null);
      } catch (e) {
        if (!ctl.signal.aborted) setError((e as Error).message);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [at]);

  const shown = at ?? board?.at ?? 0;
  const bySubject = new Map<string, Sig[]>();
  for (const s of board?.signals ?? []) (bySubject.get(s.subject) ?? bySubject.set(s.subject, []).get(s.subject)!).push(s);
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>What it knew, then.</h1>
          <p>Move the slider to a past time. The page shows the signals that were live at that moment, and the tape lines before it. Nothing after that time is read.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Time shown</dt><dd className="num">{board ? new Date(shown).toISOString().slice(11, 19) : "·"}</dd></div>
          <div><dt className="micro">Signals live</dt><dd className="num" data-total={board?.total}>{board?.total ?? "·"}</dd></div>
        </dl>
      </header>
      {error && !board ? <p className="empty">The relay is unreachable ({error}).</p> : null}
      {board ? (
        <section className="room-section" aria-label="Time">
          <label className="micro" htmlFor="rewind-at">Time, UTC. {new Date(board.range.from).toISOString().slice(0, 19).replace("T", " ")} to {new Date(board.range.to).toISOString().slice(0, 19).replace("T", " ")}</label>
          <input id="rewind-at" className="scrub" type="range" min={board.range.from} max={board.range.to} step={1000} value={shown} data-at={board.at} onChange={(e) => setAt(Number(e.currentTarget.value))} />
        </section>
      ) : null}
      <div className="room-grid">
        <section className="room-section" aria-label="Signals by kind">
          <h2 className="micro">The Board at that time, by kind</h2>
          <table className="ruled rewind-kinds">
            <thead><tr><th scope="col">Kind</th><th scope="col" className="num">Live</th></tr></thead>
            <tbody>
              {(board?.kinds ?? []).map((k) => (
                <tr key={k.kind}><th scope="row" className="mono">{k.kind}</th><td className="num">{k.n}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="room-section" aria-label="Tape before that time">
          <h2 className="micro">Tape before that time</h2>
          <ol className="tape rewind-lines">
            {(board?.lines ?? []).map((l) => (
              <li key={l.id}><span className="mono tape-mark">{fmt.ago(shown - l.t)}</span><span className="tape-text">{l.text}</span></li>
            ))}
          </ol>
          {board && !board.lines.length ? <p className="empty">Nothing on the tape in the 10 minutes before this time.</p> : null}
        </section>
      </div>
      <section className="room-section" aria-label="Latest coins on the Board">
        <h2 className="micro">Coins most recently scored, with the signals live for each</h2>
        <ul className="rewind-subjects">
          {[...bySubject.entries()].slice(0, 12).map(([subject, sigs]) => (
            <li key={subject}>
              <span className="mono">{sigs[0]!.sym || subject.slice(0, 8)}</span>
              <span className="micro">{sigs.map((s) => s.kind).join(" · ")}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
