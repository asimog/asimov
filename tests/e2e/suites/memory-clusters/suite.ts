// E7 narrative clusters (docs/PIPELINE.md section 10): the Librarian groups the callouts seen before a slot into
// stories and writes `narrative.clusters` once per slot; the same rows give the same clusters with the same ids, a
// callout seen after the slot never changes them, the callout pack sees the coin's story as a bucket, and without an
// embedder nothing is clustered. A fake embedding endpoint on localhost gives one axis per story (no keys, no network).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Embedder } from "../../../../packages/lane/src/index.ts";
import { clusterNarratives } from "../../../../services/agents/src/clusters.ts";
import { connect as agentsConnect, migrate as agentsMigrate, PgSpend } from "../../../../services/agents/src/db.ts";
import { AgentsRuntime } from "../../../../services/agents/src/runtime.ts";
import { type JevClient, reflexTrigger } from "../../../../services/core/src/reflex/reflex.ts";
import type { Check } from "../../lib/checks.ts";
import { CAP, MINT_A, MINT_B, slowEnv, WALLETS } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const STORIES = [["ai", "agent", "agents", "bot", "bots", "gpt", "model"], ["dog", "dogs", "puppy", "doge", "shiba"]];
function fakeVector(text: string): number[] {
  const v = new Array<number>(STORIES.length + 8).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const s = STORIES.findIndex((ws) => ws.includes(w));
    if (s >= 0) v[s]! += 1;
    else v[STORIES.length + ([...w].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 8)]! += 0.1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
async function fakeEndpoint() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const { input } = JSON.parse(body) as { input: string[] };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: fakeVector(t) })), usage: { prompt_tokens: 10 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const callout = (callout_id: string, mint: string, text: string, wallet: string) => ({
  callout_id, mint, symbol: "X", name: "X", author_wallet: wallet, author_user_id: null, author_handle: null, author_x: null,
  author_followers: 50_000, author_total_callouts: 3, text, media_url: null, mcap_at_call_usd: 20_000, price_at_call_usd: null,
  created_at: new Date().toISOString(), chain: "solana", quoted_callout_id: null, author_position: null, via: "push" as const,
});
const SLOT_MIN = 0.1; // a 6 s slot, so the test runs on the real clock (core refuses a slot in its future)
const SLOT = SLOT_MIN * 60_000;
const nextSlot = async () => {
  const t = Math.floor(Date.now() / SLOT) * SLOT + SLOT;
  await new Promise((r) => setTimeout(r, t - Date.now() + 50));
  return t;
};
const sig = (ks: { cluster_id: string; size?: number; callout_ids?: string[] }[]) => ks.map((k) => `${k.cluster_id}:${k.size ?? k.callout_ids!.length}`).join();

async function world(tag: string, embEnv: NodeJS.ProcessEnv | null) {
  const w = await slowEnv(tag);
  const asql = agentsConnect(w.url);
  await agentsMigrate(asql);
  const mcp = await w.mcpUp();
  const emb = embEnv ? new Embedder({ env: embEnv, spend: new PgSpend(asql) }) : undefined;
  const rt = new AgentsRuntime({
    sql: asql, mcpUrl: mcp.url, token: (a) => (a === "librarian" ? w.tok(CAP.memory) : undefined), lane: () => { throw new Error("no lane"); },
    embedder: emb, enabled: ["librarian"], env: { NARRATIVE_SIMILARITY: "0.85", NARRATIVE_WINDOW_H: "24", NARRATIVE_EVERY_MIN: String(SLOT_MIN) },
  });
  const emit = async (id: string, mint: string, text: string, wallet: string) => {
    const e = await w.sql.begin((tx) => w.tape.emitIn(tx as never, "callout.created", callout(id, mint, text, wallet) as never, { source: "feedreader", subject: id, after: new Date(Date.now() - 1).toISOString() }));
    await new Promise((r) => setTimeout(r, 10));
    return e;
  };
  const asked: Record<string, unknown>[] = [];
  const jev = {
    async systemOne(req: { state: Record<string, unknown>; questions: Record<string, unknown> }) {
      asked.push(req.state);
      return { model: "stand-in", answers: Object.fromEntries(Object.keys(req.questions).map((q) => [q, { type: "noul", noul: 0.1, confidence: 0.8 }])), usage: { input_tokens: 10 } };
    },
  } as unknown as JevClient;
  const trig = reflexTrigger(w.tape, w.clock, jev);
  const ask = async (e: { id: string }) => {
    const n = asked.length;
    const [row] = await w.sql`select id, topic, seen_time, subject, body, source from tape.events where id = ${e.id}`;
    await trig.handle([{ ...row, seen_time: (row!.seen_time as Date).toISOString() } as never], undefined as never);
    for (let i = 0; i < 50 && asked.length === n; i++) await new Promise((r) => setTimeout(r, 10));
    return (asked[n] ?? {}) as Record<string, unknown>;
  };
  const clusterEvents = async () =>
    (await w.sql`select body from tape.events where topic = 'narrative.clusters' order by seen_time, id`).map((r) => r.body as { as_of: string; clusters: { cluster_id: string; size: number; mints: string[] }[] });
  return {
    asql, rt, emit, ask, clusterEvents,
    async close() {
      await rt.close();
      await asql.end();
      await w.close();
    },
  };
}

export const suite: Suite = {
  name: "memory-clusters",
  tier: "fast",
  covers: ["services/agents/src/clusters.ts", "services/agents/src/runtime.ts", "services/core/src/memory/narratives.ts", "services/core/src/reflex/reflex.ts"],
  proves: "E7: narrative clusters are built once per hour slot from callouts seen before it; a replay gives the same clusters; the callout pack sees the coin's story; no embedder means no clusters.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const fake = await fakeEndpoint();
    const embEnv = { EMBEDDING_MODEL: "fake-stories-1", EMBEDDING_BASE_URL: fake.url, EMBEDDING_API_KEY: "fake-key", LLM_USD_HOUR_EMBED: "1" };
    try {
      const a = await world("clusters", embEnv);
      try {
        await a.emit("co_ai1", MINT_A, "ai agent coin, bots everywhere", WALLETS[0]!);
        await a.emit("co_dog", MINT_B, "dog coin for shiba lovers", WALLETS[1]!);
        await a.emit("co_ai2", MINT_A, "the agents are here, gpt model coin", WALLETS[1]!);
        await a.emit("co_ai3", MINT_B, "bot season, ai agent narrative", WALLETS[2]!);
        const slot = await nextSlot(); // a new slot starts after the four callouts; it is built as of its start
        await a.rt.indexMemory();
        const built = await a.rt.clusterSlot();
        const again = await a.rt.clusterSlot();
        const [ev] = await a.clusterEvents();
        const ai = ev?.clusters[0];
        add("one clusters event per slot, as of the slot start", built === 1 && again === null && ev?.as_of === new Date(slot).toISOString(), `built ${built}, again ${again}, as_of ${ev?.as_of}`);
        add("the AI story is one cluster named after its first callout", ai?.cluster_id === "co_ai1" && ai.size === 3 && ai.mints.join() === [MINT_A, MINT_B].sort().join(), JSON.stringify(ev?.clusters));
        // replay: the same rows give the same clusters, in any input order, and a callout seen after the slot changes nothing
        await a.emit("co_ai4", MINT_A, "another ai agents bot", WALLETS[0]!);
        await a.rt.indexMemory();
        const rows = (await a.asql`select ref, seen_at, embedding::text v from agents.memory where kind = 'callout' order by seen_at, id`).map((r) => ({ ref: r.ref as string, seen_at: (r.seen_at as Date).toISOString(), v: JSON.parse(r.v as string) as number[] }));
        const asOf = new Date(slot).toISOString();
        const r1 = clusterNarratives(rows, asOf, 0.85);
        const r2 = clusterNarratives([...rows].reverse(), asOf, 0.85);
        add("the same rows in any order give the same clusters, and the event matches them", JSON.stringify(r1) === JSON.stringify(r2) && sig(r1) === sig(ev!.clusters) && rows.length === 5, `event ${sig(ev!.clusters)}; replay ${sig(r1)} over ${rows.length} rows`);
        const late = await a.emit("co_ai5", MINT_A, "ai bots", WALLETS[2]!);
        const s = await a.ask(late);
        add("the callout pack sees the coin's story as a bucket", String(s.narrative_cluster).startsWith("a small shared story") && String(s.narrative_first_callout).includes("ai agent coin"),
          `${String(s.narrative_cluster)} | ${String(s.narrative_first_callout)}`);
      } finally {
        await a.close();
      }
      const b = await world("clusters_noemb", null);
      try {
        const e = await b.emit("co_ai1", MINT_A, "ai agent coin, bots everywhere", WALLETS[0]!);
        await nextSlot();
        await b.rt.indexMemory();
        const built = await b.rt.clusterSlot();
        const s = await b.ask(e);
        add("no clusters without an embedder", built === null && (await b.clusterEvents()).length === 0 && s.narrative_cluster === "unknown", `built ${built}; bucket ${String(s.narrative_cluster)}`);
      } finally {
        await b.close();
      }
    } finally {
      await fake.close();
    }
    return { checks, metrics: {} };
  },
};
