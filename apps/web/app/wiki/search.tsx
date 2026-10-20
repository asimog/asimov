"use client";
// Wiki search (E7c, docs/UI.md /wiki): asks the relay's /v1/search for wiki pages and reports by meaning, as of now, and
// links each hit. The relay embeds the question on a metered lane; when that lane is over its hourly limit, search pauses.
import Link from "next/link";
import { useEffect, useState } from "react";
import { RELAY } from "@/lib/live";
import css from "./search.module.css";

type Hit = { kind: "wiki" | "report"; ref: string; slug: string | null; report_id: string | null; snippet: string; similarity: number; seen_at: string };
type State = { q: string; hits: Hit[] } | { q: string; paused: string } | { q: string; error: string } | null;

export function WikiSearch() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const text = q.trim();
    if (!text) return setState(null);
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`${RELAY}/v1/search?${new URLSearchParams({ q: text, kinds: "wiki,report", k: "8" })}`, { cache: "no-store" });
        const body = (await r.json()) as { hits?: Hit[]; error?: string; reason?: string };
        if (!alive) return;
        if (r.status === 503) setState({ q: text, paused: body.reason ?? "" });
        else if (!r.ok) setState({ q: text, error: body.error ?? `relay answered ${r.status}` });
        else setState({ q: text, hits: body.hits ?? [] });
      } catch (e) {
        if (alive) setState({ q: text, error: (e as Error).message });
      } finally {
        if (alive) setBusy(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <section className="room-section" aria-label="Search the wiki and reports" data-search>
      <h2 className="micro">Search pages and reports by meaning</h2>
      <search className={css.form}>
        <input aria-label="Question" className={css.field} type="search" maxLength={200} placeholder="a coin, a caller, a pattern" value={q} onChange={(e) => setQ(e.currentTarget.value)} autoComplete="off" />
      </search>
      <div aria-live="polite">
        {!state ? null : "paused" in state ? (
          <p className="empty" data-search-state="paused">Search paused. {state.paused || "The embedding lane has no room this hour."}</p>
        ) : "error" in state ? (
          <p className="empty" data-search-state="error">Search failed ({state.error}).</p>
        ) : !state.hits.length ? (
          <p className="empty" data-search-state="empty">No page or report matches yet.</p>
        ) : (
          <ol className={css.hits} data-search-state="hits">
            {state.hits.map((h) => (
              <li key={`${h.kind}:${h.ref}`} data-kind={h.kind} data-ref={h.ref}>
                <Link href={h.kind === "wiki" ? `/wiki/${encodeURIComponent(h.slug ?? h.ref)}` : "/synthesis"}>
                  <span className="chip">{h.kind === "wiki" ? "page" : "report"}</span>
                  <span className="mono">{h.ref}</span>
                  <span className="micro">{h.seen_at.slice(0, 16).replace("T", " ")}, match {h.similarity.toFixed(2)}</span>
                </Link>
                <p className={css.snippet}>{h.snippet}</p>
              </li>
            ))}
          </ol>
        )}
        {busy ? <p className="micro">Searching.</p> : null}
      </div>
    </section>
  );
}
