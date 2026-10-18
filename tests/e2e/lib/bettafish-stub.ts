// Scripted model answers for the real BettaFish engines (docs/24 P3, P4), chosen by the output keys each node's system
// prompt asks for, so one responder serves the Insight, Query and Media engines, the forum host and the keyword optimizer.
// `fakeFor(user)` lets a test put an invented callout id into one paragraph only.
export function bettafishAnswer(system: string, user: string, fakeFor = "DOGE risk"): string {
  const has = (k: string) => system.includes(k);
  const tool = (names: string[]) => names.find((n) => has(n)) ?? names[0]!;
  // ReportEngine (BETTAFISH_REPORT=full): layout, word budget, then one IR chapter per template section
  const ids = () => [...new Set([...user.matchAll(/"chapterId":\s*"([^"]+)"/g)].map((m) => m[1]!))];
  if (has("报告首席设计官")) return JSON.stringify({ title: "Callout synthesis", subtitle: "From our callouts", tagline: "Data only", tocTitle: "Contents", hero: { summary: "Two narratives.", highlights: ["PEPE early callers"], actions: [], kpis: [] }, tocPlan: [], layoutNotes: [] });
  if (has("报告篇幅规划官")) return JSON.stringify({ totalWords: 3000, globalGuidelines: ["short and exact"], chapters: ids().map((id) => ({ chapterId: id, title: id, targetWords: 400, min: 300, max: 600, emphasis: [], sections: [], rationale: "fixed template" })) });
  if (has("章节装配工厂")) {
    const id = ids()[0] ?? "S1";
    const title = user.match(/"title":\s*"([^"]+)"/)?.[1] ?? id;
    const para = (t: string) => ({ type: "paragraph", inlines: [{ text: t }] });
    return JSON.stringify({ chapterId: id, title, anchor: `section-${id.toLowerCase()}`, order: 1, blocks: [
      { type: "heading", level: 2, text: title, anchor: `section-${id.toLowerCase()}` },
      para("Two callers were early on PEPE before the price moved, and both still hold according to the flow we measured over the window; the callouts that came later repeated the first one almost word for word, which is what an echo looks like in our data [cid:co_a1] [cid:co_a2]."),
      para("DOGE drew calls that read as warnings rather than pitches: the texts name a bundle and a dump, the sellers outnumber the buyers in the same minutes, and the wallets that called it are the ones that left first, so the stance here is avoid until the flow says otherwise [cid:co_b1] [cid:co_b2]."),
      para("The simulated swarm on this subject is SIMULATED and only a reference: it suggests our own callout would add few new callers, which matches the small number of distinct callers on the real feed in this window; nothing here is advice and no person is named."),
    ] });
  }
  if (has("论坛主持人")) return "HOST: PEPE has two early callers [cid:co_a1]; DOGE looks bundled [cid:co_b1]. Engines should check flow next.";
  if (has("舆情数据挖掘专家")) return JSON.stringify({ keywords: ["PEPE", "DOGE"], reasoning: "tickers" });
  if (has("updated_paragraph_latest_state")) return JSON.stringify({ updated_paragraph_latest_state: user.includes(fakeFor) ? "DOGE looks bundled [cid:co_b1] [cid:co_FAKE]." : "Two callers early on PEPE [cid:co_a1] [cid:co_a2]." });
  if (has("search_tool") && has("paragraph_latest_state")) return JSON.stringify({ search_query: "DOGE", search_tool: tool(["get_comments_for_topic", "search_news_last_week", "search_last_week"]), reasoning: "deepen" });
  if (has("search_tool")) return JSON.stringify({ search_query: "PEPE", search_tool: tool(["search_topic_globally", "basic_search_news", "comprehensive_search"]), reasoning: "find callouts" });
  if (has("paragraph_latest_state")) return JSON.stringify({ paragraph_latest_state: "Callers early on PEPE [cid:co_a1]." });
  if (has("规划")) return JSON.stringify([{ title: "PEPE callers", content: "Who is early on PEPE" }, { title: "DOGE risk", content: "Rug signals on DOGE" }]);
  return "# Synthesis\n\nPEPE early [cid:co_a1]. DOGE flagged [cid:co_b1].";
}
