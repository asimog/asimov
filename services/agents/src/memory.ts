// The agents' embedded memory (E5, docs/SYSTEM.md): callouts, scraped replies, published reports and wiki pages, each
// embedded once with the model that made the vector and the time core saw the source (`seen_at`). Search is as-of: a
// replay at time t never sees a row seen after t, and only vectors of the current model are compared.
import { type Embedder, type MemoryKind, vectorLiteral as vec } from "@asimog/lane";
import type { Sql } from "./db.ts";

// the as-of search is shared with the relay and the Slow Bridge (E7c): one query, in packages/lane/src/recall.ts
export { type MemoryKind, type Recalled, recall } from "@asimog/lane";
export type MemoryItem = { id: string; kind: MemoryKind; ref: string; mint: string | null; text: string; seen_at: string };

/** A callout this close to an earlier callout by text is a copy of it (copy-paste shills, docs/PIPELINE.md). Core's `mark_copy` holds the same bar. */
export const COPY_SIMILARITY = 0.97;

export type Copy = { callout_id: string; copy_of: string; similarity: number };
/**
 * Embed and store items not stored yet. A callout records the earlier callout it copies, if any. Returns rows written, the
 * copies found and each new reply's vector (the Librarian scores replies against the rug examples, E7b).
 */
export async function remember(sql: Sql, emb: Embedder, items: MemoryItem[]): Promise<{ written: number; copies: Copy[]; replies: { ref: string; v: number[] }[] }> {
  const copies: Copy[] = [];
  const replies: { ref: string; v: number[] }[] = [];
  if (!items.length) return { written: 0, copies, replies };
  const have = new Set((await sql`select id from agents.memory where id = any(${items.map((i) => i.id)})`).map((r) => r.id as string));
  const fresh = items.filter((i) => !have.has(i.id) && i.text.trim());
  if (!fresh.length) return { written: 0, copies, replies };
  const { vectors } = await emb.embed(fresh.map((i) => i.text));
  for (const [n, i] of fresh.entries()) {
    const v = vec(vectors[n]!);
    if (i.kind === "reply") replies.push({ ref: i.ref, v: vectors[n]! });
    let copy_of: string | null = null;
    if (i.kind === "callout") {
      const [c] = await sql`select ref, 1 - (embedding <=> ${v}::vector) similarity from agents.memory where model = ${emb.model} and kind = 'callout' and seen_at <= ${i.seen_at} and ref <> ${i.ref}
        and 1 - (embedding <=> ${v}::vector) >= ${COPY_SIMILARITY} order by seen_at, id limit 1`;
      copy_of = (c?.ref as string | undefined) ?? null;
      if (copy_of) copies.push({ callout_id: i.ref, copy_of, similarity: Math.min(1, Number(c!.similarity)) });
    }
    await sql`insert into agents.memory (id, kind, ref, mint, text, model, embedding, seen_at, copy_of)
      values (${i.id}, ${i.kind}, ${i.ref}, ${i.mint}, ${i.text}, ${emb.model}, ${v}::vector, ${i.seen_at}, ${copy_of}) on conflict (id) do nothing`;
  }
  return { written: fresh.length, copies, replies };
}

type Ev = { id: string; topic: string; seen_time: string; subject: string | null; body: Record<string, unknown> };
/** What each indexed topic becomes in memory. Pure. */
export function itemOf(e: Ev): MemoryItem | null {
  const b = e.body;
  const seen_at = new Date(e.seen_time).toISOString();
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : null);
  if (e.topic === "callout.created") return { id: e.id, kind: "callout", ref: s("callout_id") ?? e.id, mint: s("mint"), text: s("text") ?? "", seen_at };
  if (e.topic === "callout.reply") return { id: e.id, kind: "reply", ref: s("reply_id") ?? e.id, mint: s("mint"), text: s("text") ?? "", seen_at };
  if (e.topic === "report.published") return { id: e.id, kind: "report", ref: s("report_id") ?? e.id, mint: b.kind === "coin" ? s("subject") : null, text: s("summary") ?? "", seen_at };
  if (e.topic === "report.drafted") return { id: e.id, kind: "report", ref: s("report_id") ?? e.id, mint: null, text: s("text") ?? "", seen_at };
  if (e.topic === "wiki.page") return { id: e.id, kind: "wiki", ref: s("slug") ?? e.id, mint: s("mint"), text: s("body") ?? "", seen_at };
  return null;
}
export const MEMORY_TOPICS = ["callout.created", "callout.reply", "report.published", "report.drafted", "wiki.page"];
