// Narrative clusters as core reads them (E7): the Librarian writes `narrative.clusters`; the callout pack and the Slow
// Bridge read the coin's cluster from the newest event seen by their time, so a replay reads the same one.
import type { Sql } from "../lib/db.ts";

/** The coin's cluster in the newest `narrative.clusters` seen at or before `at` (E7). `known` is false when no clusters were made yet. */
export async function narrativeFor(sql: Sql, mint: string, at: string): Promise<{ known: boolean; size: number; first_text: string | null; as_of: string | null }> {
  const [e] = await sql`select body from tape.events where topic = 'narrative.clusters' and seen_time <= ${at} order by seen_time desc, id desc limit 1`;
  if (!e) return { known: false, size: 0, first_text: null, as_of: null };
  const b = e.body as { as_of: string; clusters: { size: number; mints: string[]; first_text: string }[] };
  const k = b.clusters.filter((x) => x.mints.includes(mint)).sort((x, y) => y.size - x.size)[0];
  return { known: true, size: k?.size ?? 0, first_text: k?.first_text ?? null, as_of: b.as_of };
}
