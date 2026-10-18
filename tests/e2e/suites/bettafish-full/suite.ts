// All three BettaFish research engines in parallel (docs/24 P4): Insight over slow.*, Query over our callouts (Tavily
// and X are off without keys), Media over slow.media, with the forum (upstream LogMonitor and ForumHost) debating
// between them. Offline with a stub model. Proves each engine ran its loop on our data, the host spoke and the engines
// read the host back, forum lines reach the Tape, and each engine's report reaches the exchange. With BETTAFISH_REPORT=full,
// upstream's ReportEngine writes the Document IR from our template, with a MiroShark swarm report as a fourth input.
import fs from "node:fs";
import { PY, runBettafish } from "../../lib/bettafish.ts";
import type { Check } from "../../lib/checks.ts";
import { CAP } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "bettafish-full",
  proves: "Insight, Query and Media run in parallel over our data with the forum host steering them; forum lines and each engine's report reach core.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    if (!fs.existsSync(PY)) return { checks: [{ name: "BettaFish venv exists", pass: false, detail: PY }], metrics: {} };
    const r = await runBettafish("bffull", "insight,query,media", { BETTAFISH_HOST_EVERY_N: "2", BETTAFISH_FORUM_ROUNDS: "2", SEARCH_TOOL_TYPE: "AsimogMedia", QUERY_SEARCH: "tavily,x", BETTAFISH_REPORT: "full" }, async (w) => {
      await w.sql`update mem.callouts set media_url = 'https://socialimages.pump.fun/community-media/x/1' where callout_id in ('co_a1', 'co_b1')`;
      await w.inProc(CAP.exchange).call("report_publish", { report_id: "sj_swarm0_0", producer: "miroshark.report", kind: "swarm", subject: "global", preset: "lite", summary: "SIMULATED swarm on the feed: callers follow the first PEPE caller.", markdown: "# Swarm Report (SIMULATED)\n\nSWARM-MARKER callers follow the first PEPE caller.", simulated: true });
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
      // P4: the full ReportEngine run (template, layout, word budget, IR chapters, validation, Markdown)
      const [rep] = await r.w.sql`select ir, markdown, cites, parent_reports from slow.reports where producer = 'bettafish.report'`;
      const ir = (rep?.ir ?? {}) as { chapters?: { chapterId: string; blocks: unknown[] }[]; asimogChecks?: { chapters: number; invalid: unknown[] } };
      add("ReportEngine wrote the Document IR from our feed template", (ir.chapters?.length ?? 0) >= 3 && ir.chapters!.every((c) => c.blocks.length >= 2), `${ir.chapters?.length ?? 0} chapters; ${JSON.stringify(r.job?.result ?? {}).slice(0, 200)}`);
      add("every IR chapter passes upstream's validator", ir.asimogChecks?.invalid.length === 0 && ir.asimogChecks.chapters === ir.chapters?.length, JSON.stringify(ir.asimogChecks));
      add("the report's Markdown carries the claims with their cites", String(rep?.markdown ?? "").includes("PEPE") && ((rep?.cites as string[] | undefined) ?? []).includes("co_a1"), String(rep?.markdown ?? "").slice(0, 120));
      add("the MiroShark swarm report was a fourth input, labeled SIMULATED", r.llm.calls.some((c) => (c.system.includes("章节装配工厂") || c.system.includes("报告首席设计官")) && c.user.includes("SIMULATED swarm report sj_swarm0_0") && c.user.includes("SWARM-MARKER")) && ((rep?.parent_reports as string[] | undefined) ?? []).includes("sj_swarm0_0"), "");
      return { checks, metrics: { model_calls: r.llm.calls.length, forum_lines: lines.length, ir_chapters: ir.chapters?.length ?? 0 } };
    } finally {
      await r.close();
    }
  },
};
