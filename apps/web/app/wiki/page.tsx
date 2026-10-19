"use client";
// Wiki (docs/UI.md /wiki, E3): one page per measured caller and per coin the house traded. Numbers are written by code;
// prose, where there is any, is the Wiki writer's and is labelled AI judgment on the page itself.
import Link from "next/link";
import { useRoom } from "@/lib/live";

type Row = { slug: string; kind: "caller" | "coin"; version: number; as_of: string; title: string; prose: boolean };

export default function WikiPage() {
  const { data, error } = useRoom<{ pages: Row[] }>("/v1/wiki", 30_000);
  const pages = data?.pages ?? [];
  const groups = [
    { kind: "caller", title: "Callers measured often enough to judge" },
    { kind: "coin", title: "Coins the house traded" },
  ] as const;
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>Who trades how, in numbers. <span className="chip">PAPER</span></h1>
          <p>Each page is rebuilt when the Index refreshes. A new version is written only when a number changes, and the same data always gives the same page. Prose under a page is a model's reading of those numbers, labelled as such.</p>
        </div>
        <dl className="room-kpis">
          <div className="hot"><dt className="micro">Pages</dt><dd className="num">{data ? pages.length : "·"}</dd></div>
          <div><dt className="micro">With prose</dt><dd className="num">{data ? pages.filter((p) => p.prose).length : "·"}</dd></div>
        </dl>
      </header>
      {error && !data ? <p className="empty">The relay is unreachable ({error}).</p> : null}
      {groups.map((g) => {
        const rows = pages.filter((p) => p.kind === g.kind);
        return (
          <section key={g.kind} className="room-section" aria-label={g.title}>
            <h2 className="micro">{g.title}</h2>
            {!data ? <p className="empty">Loading the wiki.</p> : !rows.length ? <p className="empty">No pages yet. They appear after the next Index refresh.</p> : (
              <div className="table-wrap">
                <table className="ruled">
                  <thead><tr><th scope="col">Page</th><th scope="col" className="num">Version</th><th scope="col">As of</th><th scope="col">Prose</th></tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.slug}>
                        <th scope="row"><Link href={`/wiki/${encodeURIComponent(p.slug)}`}>{p.title}</Link></th>
                        <td className="num">{p.version}</td>
                        <td className="num">{p.as_of.slice(0, 16).replace("T", " ")}</td>
                        <td>{p.prose ? <span className="chip">AI judgment</span> : <span className="micro">none</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}
