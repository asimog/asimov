"use client";
// Case file (docs/PIPELINE.md): everything known about one callout, in six sections that never mix evidence classes.
// Callout text is data: it is shown in a fenced block as plain text and never interpreted.
import { use } from "react";
import { RELAY, useRoom } from "@/lib/live";

type Case = Record<string, any> & { callout_id: string; as_of: string; observed: Record<string, any> };

const SECTIONS = [
  { cls: "observed", title: "Observed", what: "Facts the feeds told us" },
  { cls: "statistics", title: "Statistics", what: "Outcomes we measured with our own method" },
  { cls: "ai_judgments", title: "AI judgments", what: "What the model said, with its confidence" },
  { cls: "indicators", title: "Indicators", what: "Patterns, each with its evidence, other explanations and limits" },
  { cls: "unresolved", title: "Unresolved", what: "What we could not see" },
  { cls: "corrections", title: "Outcomes and corrections", what: "Later measurements that replaced earlier ones" },
] as const;

function Value({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="micro">none</span>;
  // biome-ignore lint/suspicious/noArrayIndexKey: case fields render once from a fixed snapshot, never reordered
  if (Array.isArray(v)) return v.length ? <ol className="case-list">{v.map((x, i) => <li key={i}><Value v={x} /></li>)}</ol> : <span className="micro">none</span>;
  if (typeof v === "object")
    return (
      <dl className="case-dl">
        {Object.entries(v).map(([k, x]) => (
          <div key={k}><dt className="micro">{k.replaceAll("_", " ")}</dt><dd><Value v={x} /></dd></div>
        ))}
      </dl>
    );
  return <span className="mono">{String(v)}</span>;
}

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useRoom<Case>(`/v1/case/${encodeURIComponent(id)}`, 30_000);
  const { text, fence: _fence, ...observed } = data?.observed ?? {};
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>One callout, laid out.</h1>
          <p>Each fact sits in the section for its kind. Indicators are lower bounds on what we saw, never a verdict about a person. The same file is available with <span className="mono">ctl case {id.slice(0, 8)}…</span>.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Callout</dt><dd className="num mono">{id.slice(0, 8)}</dd></div>
          <div><dt className="micro">As of</dt><dd className="num">{data ? data.as_of.slice(11, 19) : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">No case file ({error}).</p> : null}
      {data
        ? SECTIONS.map((s) => (
            <section key={s.cls} className="room-section case-section" data-class={s.cls} aria-label={s.title}>
              <h2 className="micro">{s.title} · {s.what}</h2>
              {s.cls === "observed" ? (
                <>
                  <Value v={observed} />
                  <p className="micro">Callout text, untrusted, shown as plain text:</p>
                  <pre className="case-fence">{text}</pre>
                </>
              ) : (
                <Value v={data[s.cls]} />
              )}
            </section>
          ))
        : null}
      <p className="micro"><a href={`${RELAY}/v1/case/${id}`}>Raw JSON</a></p>
    </main>
  );
}
