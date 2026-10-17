"use client";
// The Lab (docs/11): every decision and thesis is hashed before its outcome (commit) and opened after (reveal).
// The arc holds the last commits in time order; a revealed one sends a ray outward, crimson if the hash did not match.
import { fmt, useRoom } from "@/lib/live";

type Item = {
  id: string; kind: string; sha: string; made: number; revealed: number | null; matches: boolean | null; sym: string;
  thesis: { kind: string; what: string; p: number; claims: { class: string; text: string }[]; plan: { stop: number; max_hold_min: number; ladder: { mult: number; sell: number }[] } } | null;
};
type Lab = { total: number; revealed: number; items: Item[] };

const W = 1200;
const H = 560;
const CX = W / 2;
const CY = 1180;
const R = 940;
const A0 = (-90 - 40) * (Math.PI / 180);
const A1 = (-90 + 40) * (Math.PI / 180);

function Arc({ items }: { items: Item[] }) {
  const xs = [...items].sort((a, b) => a.made - b.made);
  const t0 = xs[0]?.made ?? 0;
  const t1 = xs.at(-1)?.made ?? 1;
  const at = (t: number) => A0 + ((t - t0) / Math.max(1, t1 - t0)) * (A1 - A0);
  const pt = (a: number, r: number) => [CX + Math.cos(a) * r, CY + Math.sin(a) * r] as const;
  const ticks = Array.from({ length: 69 }, (_, i) => A0 + (i / 68) * (A1 - A0));
  return (
    <svg viewBox={`0 120 ${W} ${H - 120}`} className="lab-arc" role="img" aria-label={`${items.length} commits on the arc, ${items.filter((i) => i.revealed).length} revealed`}>
      <path d={`M ${pt(A0, R).join(" ")} A ${R} ${R} 0 0 1 ${pt(A1, R).join(" ")}`} className="arc-line" />
      {ticks.map((a, i) => {
        const [x1, y1] = pt(a, R);
        const [x2, y2] = pt(a, R + (i % 4 === 0 ? 14 : 6));
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="arc-tick" />;
      })}
      {xs.map((it) => {
        const a = at(it.made);
        // the commit points inward; its reveal leaves the arc outward, longer the longer the outcome took
        const [x1, y1] = pt(a, R - 4);
        const [x2, y2] = pt(a, R - (it.thesis ? 46 : 22));
        const ray = it.revealed ? pt(a, R + 18 + Math.min(90, ((it.revealed - it.made) / 60_000) * 6)) : null;
        const [rx, ry] = pt(a, R + 16);
        return (
          <g key={it.id} data-kind={it.thesis ? "thesis" : it.kind} data-match={it.matches === false ? "no" : "yes"}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="arc-commit" />
            {ray ? <line x1={rx} y1={ry} x2={ray[0]} y2={ray[1]} className="arc-ray" /> : null}
            {it.thesis ? <circle cx={x2} cy={y2} r="3" className="arc-dot" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

export default function LabPage() {
  const { data, error } = useRoom<Lab>("/v1/lab", 6000);
  const theses = (data?.items ?? []).filter((i) => i.thesis).slice(0, 12);
  const bad = data?.items.filter((i) => i.matches === false).length ?? 0;
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>What it believed, before it knew.</h1>
          <p>Every decision and every thesis is hashed and published before its outcome, then opened afterwards. A reveal that does not match its hash would show in crimson here.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Committed</dt><dd className="num">{data?.total ?? "·"}</dd></div>
          <div><dt className="micro">Revealed</dt><dd className="num">{data?.revealed ?? "·"}</dd></div>
          <div><dt className="micro">Mismatches</dt><dd className="num" data-sign={bad ? "down" : undefined}>{data ? bad : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">The relay is unreachable ({error}). The arc returns when it answers.</p> : null}
      {data ? <Arc items={data.items} /> : <div className="lab-arc lab-arc-loading" aria-hidden="true" />}
      <section className="room-section" aria-label="Latest theses">
        <h2 className="micro">Latest theses</h2>
        {!theses.length ? <p className="empty">A thesis is written the first time a calling strategy buys a coin. None in this window yet.</p> : (
          <ol className="theses">
            {theses.map((t) => (
              <li key={t.id}>
                <header>
                  <span className="mono">{t.sym}</span>
                  <span className="chip" data-tone={t.thesis!.kind === "pre_call" ? "accent" : undefined}>{t.thesis!.kind.replace("_", " ")}</span>
                  <span className="chip" data-tone={t.revealed ? (t.matches === false ? "stress" : undefined) : "accent"}>{t.revealed ? "revealed" : "open"}</span>
                </header>
                <p className="thesis-claim"><span className="num">{t.thesis!.p.toFixed(2)}</span> {t.thesis!.what}</p>
                <ul>
                  {t.thesis!.claims.map((c, i) => (
                    <li key={i}><span className="micro">{c.class.replace("_", " ")}</span> {c.text}</li>
                  ))}
                </ul>
                <p className="micro thesis-plan">
                  Stop {t.thesis!.plan.stop.toFixed(2)}x · hold {t.thesis!.plan.max_hold_min} min · {fmt.ago(Date.now() - t.made)} ago · <span className="mono">{t.sha.slice(0, 16)}</span>
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
