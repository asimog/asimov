// The agents' embedded memory (E5, docs/SYSTEM.md): callouts, scraped replies, published reports and wiki pages, each
// embedded once with the model that made the vector and the time core saw the source (`seen_at`). Search is as-of: a
// replay at time t never sees a row seen after t, and only vectors of the current model are compared.
import type { Embedder } from "@asimog/lane";
import type { Sql } from "./db.ts";

export type MemoryKind = "callout" | "reply" | "report" | "wiki";
export type MemoryItem = { id: string; kind: MemoryKind; ref: string; mint: string | null; text: string; seen_at: string };
export type Recalled = { id: string; kind: MemoryKind; ref: string; mint: string | null; text: string; seen_at: string; similarity: number; copy_of: string | null };

/** A callout this close to an earlier callout by text is a copy of it (copy-paste shills, docs/PIPELINE.md). Core's `mark_copy` holds the same bar. */
export const COPY_SIMILARITY = 0.97;
const vec = (v: number[]) => `[${v.join(",")}]`;

export type Copy = { callout_id: string; copy_of: string; similarity: number };
/** Embed and store items not stored yet. A callout records the earlier callout it copies, if any. Returns rows written and the copies found. */
export async function remember(sql: Sql, emb: Embedder, items: MemoryItem[]): Promise<{ written: number; copies: Copy[] }> {
  const copies: Copy[] = [];
  if (!items.length) return { written: 0, copies };
  const have = new Set((await sql`select id from agents.memory where id = any(${items.map((i) => i.id)})`).map((r) => r.id as string));
  const fresh = items.filter((i) => !have.has(i.id) && i.text.trim());
  if (!fresh.length) return { written: 0, copies };
  const { vectors } = await emb.embed(fresh.map((i) => i.text));
  for (const [n, i] of fresh.entries()) {
    const v = vec(vectors[n]!);
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
  return { written: fresh.length, copies };
}

/** The `k` rows nearest to `text` among `kinds`, seen at or before `as_of`, optionally on one coin. */
export async function recall(sql: Sql, emb: Embedder, q: { text: string; kinds: MemoryKind[]; as_of: string; k?: number; mint?: string }): Promise<Recalled[]> {
  const { vectors } = await emb.embed([q.text]);
  const v = vec(vectors[0]!);
  const rows = await sql`select id, kind, ref, mint, text, seen_at, copy_of, 1 - (embedding <=> ${v}::vector) similarity from agents.memory
    where model = ${emb.model} and kind = any(${q.kinds}) and seen_at <= ${q.as_of} ${q.mint ? sql`and mint = ${q.mint}` : sql``}
    order by embedding <=> ${v}::vector, id limit ${q.k ?? 5}`;
  return rows.map((r) => ({ id: r.id as string, kind: r.kind as MemoryKind, ref: r.ref as string, mint: (r.mint as string | null) ?? null, text: r.text as string, seen_at: (r.seen_at as Date).toISOString(), similarity: Number(r.similarity), copy_of: (r.copy_of as string | null) ?? null }));
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
