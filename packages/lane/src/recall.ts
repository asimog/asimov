// The one as-of search over the agents' embedded memory (E5, E7c): the agents' graphs, the relay's /v1/search and the Slow
// Bridge all call this, so they see the same rows. A search at time t never returns a row seen after t, and only vectors
// of the embedder's model are compared. `sql` is any postgres.js connection (read-only is enough).
import type { Embedder } from "./embed.ts";

export type MemoryKind = "callout" | "reply" | "report" | "wiki";
export type Recalled = { id: string; kind: MemoryKind; ref: string; mint: string | null; text: string; seen_at: string; similarity: number; copy_of: string | null };
export type RecallQuery = { text: string; kinds: MemoryKind[]; as_of: string; k?: number; mint?: string; /** one row per (kind, ref): the nearest version of a page or report */ unique?: boolean };
type Rows = readonly Record<string, unknown>[];
// biome-ignore lint/suspicious/noExplicitAny: postgres.js tagged template values are untyped
export type RecallSql = (strings: TemplateStringsArray, ...values: any[]) => PromiseLike<Rows>;

export const vectorLiteral = (v: number[]) => `[${v.join(",")}]`;

/** The `k` rows nearest to `text` among `kinds`, seen at or before `as_of`, optionally on one coin. */
export async function recall(sql: RecallSql, emb: Embedder, q: RecallQuery): Promise<Recalled[]> {
  const { vectors } = await emb.embed([q.text]);
  const v = vectorLiteral(vectors[0]!);
  const mint = q.mint ?? null;
  const rows = q.unique
    ? await sql`select * from (select distinct on (kind, ref) id, kind, ref, mint, text, seen_at, copy_of, embedding <=> ${v}::vector d from agents.memory
        where model = ${emb.model} and kind = any(${q.kinds}) and seen_at <= ${q.as_of} and (${mint}::text is null or mint = ${mint})
        order by kind, ref, d, id) x order by d, id limit ${q.k ?? 5}`
    : await sql`select id, kind, ref, mint, text, seen_at, copy_of, embedding <=> ${v}::vector d from agents.memory
        where model = ${emb.model} and kind = any(${q.kinds}) and seen_at <= ${q.as_of} and (${mint}::text is null or mint = ${mint})
        order by d, id limit ${q.k ?? 5}`;
  return rows.map((r) => ({ id: r.id as string, kind: r.kind as MemoryKind, ref: r.ref as string, mint: (r.mint as string | null) ?? null, text: r.text as string, seen_at: (r.seen_at as Date).toISOString(), similarity: 1 - Number(r.d), copy_of: (r.copy_of as string | null) ?? null }));
}
