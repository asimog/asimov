"use client";
// One wiki page (E3): the code-written body, then the Wiki writer's prose under its AI judgment label, then the versions.
// The body is our own markdown (headings, tables, lines); it is rendered as plain text elements, never as HTML.
import Link from "next/link";
import { use, useState } from "react";
import { RELAY, useRoom } from "@/lib/live";

type Page = { slug: string; kind: string; version: number; as_of: string; sha256: string; body: string; prose: string | null; versions: { version: number; as_of: string; sha256: string }[] };

function Body({ md }: { md: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("# ")) continue; // the title is the room heading
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i]!.startsWith("|"); i++) if (!/^\|[-|\s]+\|$/.test(lines[i]!)) rows.push(lines[i]!.slice(1, -1).split("|").map((c) => c.trim()));
      i--;
      const [head, ...rest] = rows;
      blocks.push(
        <div className="table-wrap" key={i}>
          <table className="ruled">
            <thead><tr>{head!.map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead>
            {/* biome-ignore lint/suspicious/noArrayIndexKey: rows render once from a fixed page version */}
            <tbody>{rest.map((r, j) => <tr key={j}>{r.map((c, k) => (k ? <td className="num" key={k}>{c}</td> : <th scope="row" key={k}>{c}</th>))}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (l.trim()) blocks.push(<p key={i}>{l}</p>);
  }
  return <>{blocks}</>;
}

export default function WikiSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [v, setV] = useState<number | null>(null);
  const { data, error } = useRoom<Page>(`/v1/wiki/${encodeURIComponent(slug)}${v ? `?v=${v}` : ""}`, 30_000);
  const title = data?.body.split("\n")[0]?.replace(/^# /, "") ?? "Wiki page";
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>{title} <span className="chip">PAPER</span></h1>
          <p><Link href="/wiki">All pages</Link>. Numbers below are written by code from the caller ledger and our paper books.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Version</dt><dd className="num">{data ? data.version : "·"}</dd></div>
          <div><dt className="micro">As of</dt><dd className="num">{data ? data.as_of.slice(0, 16).replace("T", " ") : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">No such page ({error}).</p> : null}
      {data ? (
        <>
          <section className="room-section case-section" data-class="statistics" aria-label="Numbers">
            <h2 className="micro">Statistics · written by code</h2>
            <Body md={data.body} />
          </section>
          <section className="room-section case-section" data-class="ai_judgments" aria-label="AI judgment">
            <h2 className="micro">AI judgment · written by the Wiki writer agent, may be wrong</h2>
            {data.prose ? <p>{data.prose}</p> : <p className="empty">No prose for this version yet.</p>}
          </section>
          <section className="room-section" aria-label="Versions">
            <h2 className="micro">Versions · a new one only when a number changed</h2>
            <ol className="case-list">
              {data.versions.map((x) => (
                <li key={x.version}>
                  <button type="button" className="chip" aria-pressed={x.version === data.version} onClick={() => setV(x.version)}>v{x.version}</button>{" "}
                  <span className="num">{x.as_of.slice(0, 16).replace("T", " ")}</span> <span className="mono micro">{x.sha256.slice(0, 12)}</span>
                </li>
              ))}
            </ol>
            <p className="micro"><a href={`${RELAY}/v1/wiki/${encodeURIComponent(slug)}?v=${data.version}`}>Raw JSON</a></p>
          </section>
        </>
      ) : null}
    </main>
  );
}
