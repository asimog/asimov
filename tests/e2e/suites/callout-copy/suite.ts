// Copied callouts (E7a): the Librarian finds a callout whose text repeats an earlier one and core writes `callout.copy`
// through `mark_copy`. The copy is marked on both case files and excluded from the caller ledger as `copy`; a forged mark
// (the "original" seen after the copy) is refused, and a second pass writes nothing new.
import { Embedder } from "../../../../packages/lane/src/index.ts";
import { connect as agentsConnect, migrate as agentsMigrate, PgSpend } from "../../../../services/agents/src/db.ts";
import { AgentsRuntime } from "../../../../services/agents/src/runtime.ts";
import { buildCase, renderCase } from "../../../../services/core/src/hunt/case.ts";
import { ledger } from "../../../../services/core/src/scorekeeper/ledger.ts";
import { CAP, MINT_A, slowEnv, WALLETS } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const callout = (callout_id: string, text: string, wallet: string) => ({
  callout_id, mint: MINT_A, symbol: "PEPE", name: "Pepe", author_wallet: wallet, author_user_id: null, author_handle: null, author_x: null,
  author_followers: null, author_total_callouts: null, text, media_url: null, mcap_at_call_usd: null, price_at_call_usd: null,
  created_at: new Date().toISOString(), chain: "solana", quoted_callout_id: null, author_position: null, via: "push" as const,
});

export const suite: Suite = {
  name: "callout-copy",
  tier: "fast",
  covers: ["services/core/src/mcp/toolbox.ts", "services/core/src/hunt/case.ts", "services/core/src/scorekeeper/ledger.ts", "services/agents/src/memory.ts", "services/agents/src/runtime.ts"],
  proves: "A copied callout reaches the Tape through core, is marked on its case file and is excluded from the caller ledger as a copy.",
  async run() {
    const w = await slowEnv("copy");
    const asql = agentsConnect(w.url);
    try {
      await agentsMigrate(asql);
      const mcp = await w.mcpUp();
      const emb = new Embedder({ env: { LLM_STUB: "1" }, spend: new PgSpend(asql) });
      const rt = new AgentsRuntime({ sql: asql, mcpUrl: mcp.url, token: (a) => (a === "librarian" ? w.tok(CAP.memory) : undefined), lane: () => { throw new Error("no lane"); }, embedder: emb, enabled: ["librarian"] });
      const emit = async (id: string, text: string, wallet: string) => {
        await w.sql.begin((tx) => w.tape.emitIn(tx as never, "callout.created", callout(id, text, wallet) as never, { source: "feedreader", subject: id, after: new Date(Date.now() - 1).toISOString() }));
        await new Promise((r) => setTimeout(r, 5));
      };
      const shill = "PEPE is the next big runner, devs are building, buying the dip now";
      await emit("co_1", shill, WALLETS[0]!);
      await emit("co_2", shill, WALLETS[1]!);
      await emit("co_3", "Quiet chart, small holders, nothing to see yet on this one", WALLETS[2]!);
      await rt.indexMemory();
      await rt.indexMemory();
      const marks = await w.sql`select id, subject, body, seen_time from tape.events where topic = 'callout.copy' order by seen_time, id`;
      const forged = await w.box.call(w.tok(CAP.memory), "mark_copy", { callout_id: "co_1", copy_of: "co_3", similarity: 0.99, model: emb.model });
      const copyCase = (await buildCase(w.sql, "co_2"))!;
      const origCase = (await buildCase(w.sql, "co_1"))!;
      const plainCase = (await buildCase(w.sql, "co_3"))!;
      const ind = (c: typeof copyCase) => c.indicators.find((i) => i.name === "copied_text")!;
      const again = renderCase((await buildCase(w.sql, "co_2"))!) === renderCase(copyCase);
      const led = await ledger(w.sql);
      const copier = led.rows.find((r) => r.wallet === WALLETS[1]);
      const before = await ledger(w.sql, { at: new Date((marks[0]!.seen_time as Date).getTime() - 1).toISOString() });
      await rt.close();
      const v = ind(copyCase).value as { copy_of: string | null; copied_by: string[] };
      return {
        checks: [
          { name: "the Librarian writes one callout.copy through core, once", pass: marks.length === 1 && marks[0]!.subject === "co_2" && (marks[0]!.body as { copy_of: string }).copy_of === "co_1", detail: JSON.stringify(marks.map((m) => [m.subject, m.body])) },
          { name: "a mark whose original was seen after the copy is refused", pass: !forged.ok, detail: JSON.stringify(forged) },
          { name: "the copy's case file marks it copied_text", pass: ind(copyCase).fired && v.copy_of === "co_1" && ind(copyCase).evidence.includes(marks[0]?.id as string), detail: JSON.stringify(ind(copyCase).value) },
          { name: "the original's case file lists who copied it", pass: !ind(origCase).fired && JSON.stringify((ind(origCase).value as { copied_by: string[] }).copied_by) === '["co_2"]', detail: JSON.stringify(ind(origCase).value) },
          { name: "an unrelated callout is not marked", pass: !ind(plainCase).fired && !ind(plainCase).evidence.length, detail: JSON.stringify(ind(plainCase).value) },
          { name: "the case file is byte-identical when rebuilt", pass: again && renderCase(copyCase).includes("copied_text: present"), detail: `same ${again}` },
          { name: "the ledger excludes the copy by reason", pass: led.method === "cl2" && copier?.excluded.copy === 1 && copier.calls === 1 && led.all.excluded.copy === 1, detail: JSON.stringify(copier?.excluded) },
          { name: "the ledger as of before the mark does not exclude it", pass: before.all.calls === 3 && !before.all.excluded.copy, detail: `${before.all.calls} calls, ${JSON.stringify(before.all.excluded)}` },
        ],
        metrics: { marks: marks.length },
      };
    } finally {
      await asql.end();
      await w.close();
    }
  },
};
