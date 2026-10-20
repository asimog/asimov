// Who each thinking agent is: its capability, its model lane, its token variable and the only tools its graph may call
// (docs/SYSTEM.md). Core enforces the capability; the graph refuses anything outside this list before it leaves the process.
import type { LaneName } from "@asimog/lane";

export const AGENT_NAMES = ["noop", "postmortem", "researcher", "ops", "reporter", "integrity", "wiki", "librarian"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const AGENTS: Record<AgentName, { cap: string; lane: LaneName; tokenEnv: string; tools: string[] }> = {
  noop: { cap: "cap:ops.stop", lane: "OPS", tokenEnv: "MCP_TOKEN_OPS", tools: ["job_event"] },
  postmortem: { cap: "cap:mind.propose", lane: "THINK", tokenEnv: "MCP_TOKEN_POSTMORTEM", tools: ["why", "strategies_list", "propose_strategy", "events_since", "missed_waves", "job_event"] },
  researcher: { cap: "cap:jev.propose", lane: "THINK", tokenEnv: "MCP_TOKEN_RESEARCHER", tools: ["worst_cases", "scores", "propose_question", "job_event"] },
  ops: { cap: "cap:ops.stop", lane: "OPS", tokenEnv: "MCP_TOKEN_OPS", tools: ["doctor", "state", "events_since", "ops_alert", "ops_stop", "ops_restart_request", "job_event"] },
  reporter: { cap: "cap:report", lane: "OPS", tokenEnv: "MCP_TOKEN_REPORTER", tools: ["state", "ledger_summary", "scores", "board_signals", "soul_read", "draft_report", "job_event"] },
  integrity: { cap: "cap:integrity.write", lane: "OPS", tokenEnv: "MCP_TOKEN_INTEGRITY", tools: ["board_signals", "integrity_evidence", "write_integrity_text", "job_event"] },
  wiki: { cap: "cap:wiki.write", lane: "OPS", tokenEnv: "MCP_TOKEN_WIKI", tools: ["events_since", "write_wiki_prose", "job_event"] },
  // no graph and no chat model: it embeds new texts into agents.memory on every tick (E5), metered on the EMBED lane
  librarian: { cap: "cap:memory.read", lane: "OPS", tokenEnv: "MCP_TOKEN_LIBRARIAN", tools: ["events_since", "mark_copy", "job_event"] },
};
