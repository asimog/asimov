// Narrative clusters (E7, docs/PIPELINE.md section 10): callouts that tell the same story, grouped as of a time. Greedy
// single-link on cosine: rows are visited in (seen_at, id) order and each joins the first cluster holding a row at least
// `threshold` similar, else starts its own. A cluster's id is its first row's id. Pure, so a replay over the same rows
// gives the same clusters with the same ids.

export const CLUSTER_METHOD = "greedy-single-link@1";

export type ClusterRow = { ref: string; seen_at: string; v: number[] };
export type Cluster = { cluster_id: string; callout_ids: string[] };

const cos = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) (d += a[i]! * b[i]!), (na += a[i]! * a[i]!), (nb += b[i]! * b[i]!);
  return na && nb ? d / Math.sqrt(na * nb) : 0;
};

export { cos as cosine };

/** Clusters of two or more rows, largest first (ties by id). Rows seen after `as_of` are ignored. */
export function clusterNarratives(rows: ClusterRow[], as_of: string, threshold: number): Cluster[] {
  const seen = rows.filter((r) => r.seen_at <= as_of).sort((a, b) => (a.seen_at < b.seen_at ? -1 : a.seen_at > b.seen_at ? 1 : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const groups: { id: string; members: ClusterRow[] }[] = [];
  for (const r of seen) {
    const g = groups.find((x) => x.members.some((m) => cos(m.v, r.v) >= threshold));
    if (g) g.members.push(r);
    else groups.push({ id: r.ref, members: [r] });
  }
  return groups
    .filter((g) => g.members.length >= 2)
    .map((g) => ({ cluster_id: g.id, callout_ids: g.members.map((m) => m.ref) }))
    .sort((a, b) => b.callout_ids.length - a.callout_ids.length || (a.cluster_id < b.cluster_id ? -1 : 1));
}
