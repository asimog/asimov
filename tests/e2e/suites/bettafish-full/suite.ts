// All three BettaFish research engines in parallel (docs/24 P4): Insight over slow.*, Query over our callouts (Tavily
// and X are off without keys), Media over slow.media, with the forum (upstream LogMonitor and ForumHost) debating
// between them. Offline with a stub model. Proves each engine ran its loop on our data, the host spoke and the engines
// read the host back, forum lines reach the Tape, and each engine's report reaches the exchange.
import fs from "node:fs";
import { PY, runBettafish } from "../../lib/bettafish.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "bettafish-full",
  proves: "Insight, Query and Media run in parallel over our data with the forum host steering them; forum lines and each engine's report reach core.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    if (!fs.existsSync(PY)) return { checks: [{ name: "BettaFish venv exists", pass: false, detail: PY }], metrics: {} };
    const r = await runBettafish("bffull", "insight,query,media", { BETTAFISH_HOST_EVERY_N: "2", BETTAFISH_FORUM_ROUNDS: "2", SEARCH_TOOL_TYPE: "AsimogMedia", QUERY_SEARCH: "tavily,x" }, async (w) => {
      await w.sql`update mem.callouts set media_url = 'https://socialimages.pump.fun/community-media/x/1' where callout_id in ('co_a1', 'co_b1')`;
    });
    try {
      add("the run finishes", r.job?.state === "done", `${r.job?.state} ${r.job?.error ?? ""}`);
      const producers = (await r.w.sql`select producer from slow.reports order by producer`).map((x) => x.producer as string);
      add("each engine published its report", ["bettafish.insight", "bettafish.media", "bettafish.query"].every((p) => producers.includes(p)), producers.join(","));
      add("the forum host spoke", r.nodes("论坛主持人") >= 1, `${r.nodes("论坛主持人")} host calls`);
      add("engines read the host's speech back into later summaries", r.llm.calls.some((c) => c.user.includes("HOST: PEPE has two early callers") || c.system.includes("HOST: PEPE has two early callers")), "host text seen in a later prompt");
      const lines = await r.w.sql`select body from tape.events where topic = 'synthesis.forum_line'`;
      const agents = new Set(lines.map((l) => (l.body as { agent: string }).agent));
      add("forum lines from every engine and the host reach the Tape", ["insight", "query", "media", "host"].every((a) => agents.has(a)), [...agents].join(","));
      const mediaUser = r.llm.calls.filter((c) => c.system.includes("多媒体")).map((c) => c.user).join("\n");
      add("the Media engine saw our callout media and nothing from the web", mediaUser.includes("cid:co_a1") || mediaUser.includes("socialimages.pump.fun"), `${mediaUser.length} chars of media prompts`);
      add("every prompt carried our English and voice rules", r.llm.calls.length > 0 && r.llm.calls.every((c) => c.system.includes("[Asimog rules]")), `${r.llm.calls.length} calls`);
      return { checks, metrics: { model_calls: r.llm.calls.length, forum_lines: lines.length } };
    } finally {
      await r.close();
    }
  },
};
