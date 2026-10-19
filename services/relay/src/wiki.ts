// The wiki room (docs/UI.md /wiki, E3): page versions written by code, the Wiki writer's prose kept apart under its AI
// judgment label. Read-only; a page is shown as of its latest version unless a version is asked for.
import type postgres from "postgres";

type Deps = { sql: postgres.Sql; cached: (key: string, ms: number, fn: () => Promise<unknown>) => Promise<unknown> };

export function wikiRoom({ sql, cached }: Deps) {
  const list = () =>
    cached("wiki", 30_000, async () => {
      const rows = await sql`select distinct on (p.slug) p.slug, p.kind, p.version, p.as_of, split_part(p.body, E'\n', 1) title, w.slug is not null prose
        from wiki.pages p left join wiki.prose w on w.slug = p.slug and w.version = p.version order by p.slug, p.version desc`;
      return { pages: rows.map((r) => ({ slug: r.slug, kind: r.kind, version: r.version, as_of: (r.as_of as Date).toISOString(), title: String(r.title).replace(/^# /, ""), prose: r.prose })) };
    });
  const page = async (slug: string, version: number | null) => {
    const versions = await sql`select version, as_of, sha256 from wiki.pages where slug = ${slug} order by version desc`;
    if (!versions.length) return null;
    const v = version ?? (versions[0]!.version as number);
    const [p] = await sql`select p.slug, p.kind, p.version, p.as_of, p.sha256, p.body, w.text prose from wiki.pages p
      left join wiki.prose w on w.slug = p.slug and w.version = p.version where p.slug = ${slug} and p.version = ${v}`;
    if (!p) return null;
    return { ...p, as_of: (p.as_of as Date).toISOString(), versions: versions.map((x) => ({ version: x.version, as_of: (x.as_of as Date).toISOString(), sha256: x.sha256 })) };
  };
  return { list, page };
}
