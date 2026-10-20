// Site search (E7c, docs/UI.md /wiki): GET /v1/search?q=&as_of=&kinds=wiki,report&k= returns wiki pages and reports by
// meaning, as of a time, through the same as-of, model-scoped query the agents use (packages/lane/src/recall.ts). The
// question is embedded on the EMBED lane, its hourly limit checked first; over the limit, search answers 503 "search
// paused". The relay stays read-only: it reads the agents' spend for the lane and adds its own in memory, never writing.
import { BudgetExceeded, type Embedder, type MemoryKind, recall, type SpendStore } from "../../../packages/lane/src/index.ts";

type Sql = import("postgres").Sql<Record<string, unknown>>;
type Deps = { sql: Sql; embedder: Embedder | null; cached: (key: string, ms: number, fn: () => Promise<unknown>) => Promise<unknown> };
type Query = Record<string, string | undefined>;
export type Hit = { kind: "wiki" | "report"; ref: string; slug: string | null; report_id: string | null; snippet: string; similarity: number; seen_at: string };

const KINDS = ["wiki", "report"] as const;
const Q_MAX = 200;
const K_MAX = 20;
const mask = (t: string) => t.replace(/@\w+/g, "@…").replace(/\s+/g, " ").trim().slice(0, 280);

/** The lane's spend this hour: the agents' rows in agents.spend (read only) plus what this relay spent, kept in memory. */
export class ReadSpend implements SpendStore {
  private own = new Map<string, number>();
  constructor(private sql: Sql) {}
  async get(lane: string, hour: string) {
    const [r] = await this.sql`select coalesce(sum(usd), 0)::float usd from agents.spend where lane = ${lane} and hour = ${hour}`;
    return Number(r?.usd ?? 0) + (this.own.get(`${lane}|${hour}`) ?? 0);
  }
  async add(lane: string, hour: string, usd: number) {
    this.own.set(`${lane}|${hour}`, (this.own.get(`${lane}|${hour}`) ?? 0) + usd);
  }
}

export function searchRoom({ sql, embedder, cached }: Deps) {
  return async (p: Query): Promise<{ status: 200 | 400 | 503; body: Record<string, unknown> }> => {
    const q = (p.q ?? "").replace(/\s+/g, " ").trim().slice(0, Q_MAX);
    const asOf = p.as_of ? new Date(/^\d+$/.test(p.as_of) ? Number(p.as_of) : Date.parse(p.as_of)) : new Date(Math.floor(Date.now() / 5000) * 5000); // "now" in 5 s steps, so the cache holds
    const kinds = (p.kinds ?? KINDS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
    const k = Math.min(K_MAX, Math.max(1, Number.parseInt(p.k ?? "8", 10) || 8));
    if (!q) return { status: 400, body: { error: "empty question" } };
    if (Number.isNaN(asOf.getTime())) return { status: 400, body: { error: "as_of is not a time" } };
    if (!kinds.length || !kinds.every((x) => (KINDS as readonly string[]).includes(x))) return { status: 400, body: { error: "kinds are wiki and report only" } };
    if (!embedder) return { status: 503, body: { error: "search paused", reason: "no embedding model is set" } };
    const as_of = asOf.toISOString();
    try {
      // cached per (q, as_of, kinds): a repeat within the window costs no embedding
      return { status: 200, body: (await cached(`search|${q}|${as_of}|${[...kinds].sort().join(",")}|${k}`, 5000, async () => {
        const rows = await recall(sql, embedder, { text: q, kinds: kinds as MemoryKind[], as_of, k, unique: true });
        const hits: Hit[] = rows.map((r) => ({ kind: r.kind as Hit["kind"], ref: r.ref, slug: r.kind === "wiki" ? r.ref : null, report_id: r.kind === "report" ? r.ref : null, snippet: mask(r.text), similarity: Math.round(r.similarity * 1000) / 1000, seen_at: r.seen_at }));
        return { q, as_of, kinds, hits };
      })) as Record<string, unknown> };
    } catch (err) {
      if (err instanceof BudgetExceeded) return { status: 503, body: { error: "search paused", reason: err.message } };
      throw err;
    }
  };
}
