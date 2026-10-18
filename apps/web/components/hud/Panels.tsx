"use client";
// The instrument strip (docs/UI.md): equal-height dense panels, each with a caps micro-title and a live number.
// Every panel has its loading, empty and stale states; nothing here moves unless a number changed.
import type { ReactNode } from "react";
import { fmt, type Line, useLive } from "@/lib/live";

export function Panel({ title, figure, children, state }: { title: string; figure?: ReactNode; children: ReactNode; state?: "loading" | "empty" | "error" }) {
  return (
    <section className="panel" data-state={state} aria-label={title}>
      <header>
        <h2 className="micro">{title}</h2>
        {figure != null ? <span className="num panel-figure">{figure}</span> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

const Skeleton = ({ rows = 5 }: { rows?: number }) => (
  <ul className="skeleton" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <li key={i} style={{ inlineSize: `${92 - ((i * 17) % 40)}%` }} />
    ))}
  </ul>
);

const TOPIC_MARK: Record<string, string> = {
  "callout.created": "call", "jev.answer": "jev", "intent.created": "want", "order.rejected": "gate", "intent.ghost_filled": "fill",
  "position.closed": "close", "markout.measured": "mark", "commit.made": "hash", "commit.revealed": "seal", "strategy.born": "born",
  "strategy.retired": "gone", "kernel.allocation": "kern", "score.updated": "score", "coin.watched": "scout", "holders.snapshot": "hold",
  "thesis.formed": "why", "post.queued": "post", "index.refreshed": "index",
};

/** Plain-words events, newest first. Older lines fade with age (stale state), never by timer animation. */
export function Tape({ max = 40, filter }: { max?: number; filter?: (l: Line) => boolean }) {
  const lines = useLive((s) => s.lines);
  const snap = useLive((s) => s.snap);
  const shown = (filter ? lines.filter(filter) : lines).slice(-max).reverse();
  const head = shown[0]?.t ?? 0;
  return (
    <Panel title="Tape" figure={snap ? `${snap.rates.callouts + snap.rates.intents}/10m` : undefined} state={!snap && !lines.length ? "loading" : undefined}>
      {!snap && !lines.length ? <Skeleton rows={8} /> : !shown.length ? <p className="empty">Waiting for the first event. Callouts arrive about every 2 s.</p> : (
        <ol className="tape" aria-live="polite" aria-relevant="additions">
          {shown.map((l) => (
            <li key={l.id} data-topic={l.topic} style={{ opacity: Math.max(0.35, 1 - (head - l.t) / 600_000) }}>
              <span className="mono tape-mark">{TOPIC_MARK[l.topic] ?? l.topic.split(".")[0]}</span>
              <span className="tape-text">{l.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function Positions() {
  const snap = useLive((s) => s.snap);
  const coins = useLive((s) => s.coins);
  const by = new Map<string, { sol: number; n: number; fam: Set<string> }>();
  for (const p of snap?.positions ?? []) {
    const x = by.get(p.mint) ?? { sol: 0, n: 0, fam: new Set() };
    x.sol += p.cost_sol;
    x.n++;
    x.fam.add(p.family);
    by.set(p.mint, x);
  }
  const rows = [...by.entries()].sort((a, b) => b[1].sol - a[1].sol).slice(0, 9);
  const max = Math.max(1e-9, ...rows.map((r) => r[1].sol));
  return (
    <Panel title="Positions" figure={snap ? `${snap.pool.open}` : undefined} state={!snap ? "loading" : undefined}>
      {!snap ? <Skeleton /> : !rows.length ? <p className="empty">No open paper positions. Entries need a score above the cost floor.</p> : (
        <ul className="bars">
          {rows.map(([mint, x]) => (
            <li key={mint}>
              <span className="mono">${coins.get(mint)?.sym ?? mint.slice(0, 4)}</span>
              <span className="bar" style={{ inlineSize: `${(x.sol / max) * 100}%` }} />
              <span className="num">{x.sol.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** One chip per fill: its 60 s markout in our favour, warm when right, crimson when wrong. */
export function Markouts() {
  const snap = useLive((s) => s.snap);
  const m = snap?.markouts ?? [];
  const med = m.length ? [...m].map((x) => x.h60).sort((a, b) => a - b)[m.length >> 1]! : null;
  return (
    <Panel title="Markouts 60 s" figure={med == null ? undefined : `${med > 0 ? "+" : ""}${(med / 100).toFixed(1)}%`} state={!snap ? "loading" : undefined}>
      {!snap ? <Skeleton /> : !m.length ? <p className="empty">Each paper fill is marked 1 s, 10 s, 60 s and 5 min later.</p> : (
        <div className="heat" role="img" aria-label={`${m.length} fills, median 60 second markout ${med == null ? "unknown" : (med / 100).toFixed(1)} percent`}>
          {m.slice(0, 96).map((x, i) => (
            <span key={i} data-sign={x.h60 >= 0 ? "up" : "down"} style={{ opacity: Math.min(1, 0.25 + Math.abs(x.h60) / 2500) }} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Paper equity, closed positions only, with the drawdown from the running peak shaded. */
export function Equity() {
  const snap = useLive((s) => s.snap);
  const e = snap?.equity ?? [];
  const W = 240;
  const H = 72;
  let body: ReactNode = null;
  if (e.length > 1) {
    const ys = e.map((p) => p[1]);
    const lo = Math.min(0, ...ys);
    const hi = Math.max(0, ...ys);
    const x = (i: number) => (i / (e.length - 1)) * W;
    const y = (v: number) => H - ((v - lo) / Math.max(1e-9, hi - lo)) * (H - 6) - 3;
    let peak = -Infinity;
    const dd = e.map((p, i) => {
      peak = Math.max(peak, p[1]);
      return `${x(i)},${y(peak)}`;
    });
    const line = e.map((p, i) => `${x(i)},${y(p[1])}`).join(" ");
    body = (
      <svg viewBox={`0 0 ${W} ${H}`} className="equity" role="img" aria-label={`Paper equity ${fmt.signed(ys.at(-1)!, 4)} SOL over ${e.length} closes`}>
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="zero" />
        <polygon points={`${dd.join(" ")} ${[...e].map((p, i) => `${x(e.length - 1 - i)},${y(e[e.length - 1 - i]![1])}`).join(" ")}`} className="dd" />
        <polyline points={line} className="eq" />
      </svg>
    );
  }
  return (
    <Panel title="Equity" figure={e.length ? `${fmt.signed(e.at(-1)![1], 3)}` : undefined} state={!snap ? "loading" : undefined}>
      {!snap ? <Skeleton /> : e.length < 2 ? <p className="empty">Drawn after the second closed position.</p> : body}
    </Panel>
  );
}

export function Pool() {
  const snap = useLive((s) => s.snap);
  const f = snap?.families ?? [];
  return (
    <Panel title="Strategy pool" figure={snap ? `${snap.pool.alive}/${snap.pool.born}` : undefined} state={!snap ? "loading" : undefined}>
      {!snap ? <Skeleton /> : (
        <table className="mini">
          <thead>
            <tr><th scope="col">Family</th><th scope="col">Alive</th><th scope="col">Trades</th><th scope="col">Net</th></tr>
          </thead>
          <tbody>
            {f.map((r) => (
              <tr key={r.family}>
                <th scope="row" className="mono">{r.family.replaceAll("_", " ")}</th>
                <td className="num">{r.alive}</td>
                <td className="num">{r.trades}</td>
                <td className="num" data-sign={r.net >= 0 ? "up" : "down"}>{fmt.signed(r.net, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** How well each probability signal predicted: Brier against the base rate. Lower is better. */
export function Scores() {
  const snap = useLive((s) => s.snap);
  const sc = (snap?.scores ?? []).filter((x) => x.n > 0);
  return (
    <Panel title="Forecast scores" figure={sc.length ? `${sc.length}` : undefined} state={!snap ? "loading" : undefined}>
      {!snap ? <Skeleton /> : !sc.length ? <p className="empty">Scores appear once predictions reach their horizon.</p> : (
        <table className="mini">
          <thead>
            <tr><th scope="col">Signal</th><th scope="col">n</th><th scope="col">Brier</th><th scope="col">Skill</th></tr>
          </thead>
          <tbody>
            {sc.map((r) => {
              const ref = r.base * (1 - r.base);
              const skill = ref > 0 ? 1 - r.brier / ref : null;
              return (
                <tr key={`${r.kind}${r.horizon_min}`}>
                  <th scope="row" className="mono">{r.kind} {r.horizon_min}m</th>
                  <td className="num">{r.n}</td>
                  <td className="num">{r.brier.toFixed(3)}</td>
                  <td className="num" data-sign={skill != null && skill > 0 ? "up" : "down"}>{skill == null ? "·" : skill.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export function Rates() {
  const snap = useLive((s) => s.snap);
  const r = snap?.rates;
  const rows: [string, number | undefined][] = [["Callouts", r?.callouts], ["Trades seen", r?.trades], ["Jev reads", r?.jev], ["Intents", r?.intents], ["Refused by risk", r?.refused]];
  return (
    <Panel title="Last 10 minutes" state={!snap ? "loading" : undefined}>
      {!snap ? <Skeleton /> : (
        <dl className="rates">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="micro">{k}</dt>
              <dd className="num">{v ?? "·"}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
