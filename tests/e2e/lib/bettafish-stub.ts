// Scripted model answers for the real BettaFish engines (docs/24 P3, P4), chosen by the output keys each node's system
// prompt asks for, so one responder serves the Insight, Query and Media engines, the forum host and the keyword optimizer.
// `fakeFor(user)` lets a test put an invented callout id into one paragraph only.
export function bettafishAnswer(system: string, user: string, fakeFor = "DOGE risk"): string {
  const has = (k: string) => system.includes(k);
  const tool = (names: string[]) => names.find((n) => has(n)) ?? names[0]!;
  if (has("论坛主持人")) return "HOST: PEPE has two early callers [cid:co_a1]; DOGE looks bundled [cid:co_b1]. Engines should check flow next.";
  if (has("舆情数据挖掘专家")) return JSON.stringify({ keywords: ["PEPE", "DOGE"], reasoning: "tickers" });
  if (has("updated_paragraph_latest_state")) return JSON.stringify({ updated_paragraph_latest_state: user.includes(fakeFor) ? "DOGE looks bundled [cid:co_b1] [cid:co_FAKE]." : "Two callers early on PEPE [cid:co_a1] [cid:co_a2]." });
  if (has("search_tool") && has("paragraph_latest_state")) return JSON.stringify({ search_query: "DOGE", search_tool: tool(["get_comments_for_topic", "search_news_last_week", "search_last_week"]), reasoning: "deepen" });
  if (has("search_tool")) return JSON.stringify({ search_query: "PEPE", search_tool: tool(["search_topic_globally", "basic_search_news", "comprehensive_search"]), reasoning: "find callouts" });
  if (has("paragraph_latest_state")) return JSON.stringify({ paragraph_latest_state: "Callers early on PEPE [cid:co_a1]." });
  if (has("规划")) return JSON.stringify([{ title: "PEPE callers", content: "Who is early on PEPE" }, { title: "DOGE risk", content: "Rug signals on DOGE" }]);
  return "# Synthesis\n\nPEPE early [cid:co_a1]. DOGE flagged [cid:co_b1].";
}
