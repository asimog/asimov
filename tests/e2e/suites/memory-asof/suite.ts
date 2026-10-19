// Embedded memory (E5): the Librarian embeds callouts, replies and reports through its read-only MCP lane, a callout that
// repeats an earlier one records the copy, an as-of search never returns a row seen after its time, and embedding spend
// is metered on the EMBED lane.
import { Embedder } from "../../../../packages/lane/src/index.ts";
import { connect as agentsConnect, migrate as agentsMigrate, PgSpend } from "../../../../services/agents/src/db.ts";
import { recall } from "../../../../services/agents/src/memory.ts";
import { AgentsRuntime } from "../../../../services/agents/src/runtime.ts";
import { CAP, MINT_A, slowEnv, WALLETS } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const callout = (callout_id: string, text: string, wallet: string) => ({
  callout_id, mint: MINT_A, symbol: "PEPE", name: "Pepe", author_wallet: wallet, author_user_id: null, author_handle: null, author_x: null,
  author_followers: null, author_total_callouts: null, text, media_url: null, mcap_at_call_usd: null, price_at_call_usd: null,
  created_at: new Date().toISOString(), chain: "solana", quoted_callout_id: null, author_position: null, via: "push" as const,
});

export const suite: Suite = {
  name: "memory-asof",
  tier: "fast",
  covers: ["services/agents/src/memory.ts", "services/agents/src/runtime.ts", "packages/lane/src/embed.ts"],
  proves: "A replay search returns nothing seen after its time, copies of earlier callouts are recorded, and embedding spend is metered.",
  async run() {
    const w = await slowEnv("memory");
    const asql = agentsConnect(w.url);
    try {
      await agentsMigrate(asql);
      const mcp = await w.mcpUp();
      const spend = new PgSpend(asql);
      const emb = new Embedder({ env: { LLM_STUB: "1" }, spend });
      const rt = new AgentsRuntime({ sql: asql, mcpUrl: mcp.url, token: (a) => (a === "librarian" ? w.tok(CAP.memory) : undefined), lane: () => { throw new Error("no lane"); }, embedder: emb, enabled: ["librarian"] });
      const emit = async (topic: "callout.created" | "callout.reply" | "report.drafted", body: never, subject: string) =>
        (await w.sql.begin((tx) => w.tape.emitIn(tx as never, topic, body, { source: "feedreader", subject, after: new Date(Date.now() - 1).toISOString() }))).seen_time;
      const firstText = "PEPE is the next big runner, devs are building, buying the dip now";
      const t1 = await emit("callout.created", callout("co_1", firstText, WALLETS[0]!) as never, "co_1");
      await new Promise((r) => setTimeout(r, 20));
      const cut = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 20));
      await emit("callout.created", callout("co_2", firstText, WALLETS[1]!) as never, "co_2");
      await emit("callout.reply", { callout_id: "co_1", mint: MINT_A, reply_id: "r_1", parent_id: null, wallet: null, handle: null, text: "dev sold everything, this is a rug", likes: 2, media_url: null, created_at: new Date().toISOString() } as never, "r_1");
      await emit("report.drafted", { report_id: "rep_1", day: "2026-10-19", text: "PAPER. Two coins held, one closed at a small loss.", checks: [] } as never, "rep_1");
      const indexed = await rt.indexMemory();
      const again = await rt.indexMemory();
      const before = await recall(asql, emb, { text: firstText, kinds: ["callout", "reply", "report"], as_of: cut, k: 10 });
      const after = await recall(asql, emb, { text: firstText, kinds: ["callout", "reply", "report"], as_of: new Date().toISOString(), k: 10 });
      const rug = await recall(asql, emb, { text: "rug dev sold", kinds: ["reply"], as_of: new Date().toISOString(), k: 1 });
      const [copy] = await asql`select copy_of from agents.memory where ref = 'co_2'`;
      const [spent] = await asql`select coalesce(sum(usd), 0)::float usd from agents.spend where lane = 'EMBED'`;
      await rt.close();
      return {
        checks: [
          { name: "the Librarian embeds every new text once", pass: indexed === 4 && again === 0, detail: `first pass ${indexed}, second pass ${again}` },
          { name: "a search as of a past time returns nothing seen after it", pass: before.length === 1 && before.every((r) => r.seen_at <= cut), detail: `${before.map((r) => `${r.ref}@${r.seen_at}`).join(", ")} (cut ${cut}, first seen ${t1})` },
          { name: "a search as of now sees every row", pass: after.length === 4, detail: after.map((r) => r.ref).join(", ") },
          { name: "a repeated callout records the copy", pass: copy?.copy_of === "co_1", detail: String(copy?.copy_of) },
          { name: "a rug report is found by kind", pass: rug[0]?.ref === "r_1", detail: rug.map((r) => r.ref).join(", ") },
          { name: "embedding spend is metered on the EMBED lane", pass: Number(spent?.usd) > 0 && Math.abs(Number(spent?.usd) - emb.usd) < 1e-12, detail: `${Number(spent?.usd)} USD in agents.spend, ${emb.usd} USD counted by the embedder` },
        ],
        metrics: { indexed, before: before.length, after: after.length, embed_usd: emb.usd, calls: emb.calls },
      };
    } finally {
      await asql.end();
      await w.close();
    }
  },
};
