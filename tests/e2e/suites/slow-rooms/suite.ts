// The slow-mind rooms' data (docs/SLOW-MIND.md P8): what /v1/synthesis and /v1/simulations serve, from events written through
// the real core tools. Proves the forum, coin stance, reports with cites and claim survival reach /synthesis; and that
// every swarm run on /simulations carries simulated: true, its branches, belief drift, posts per platform and its report.
// Ways it fails: a report's body leaks into the Board instead of slow.reports (the room reads slow.reports); a swarm run
// shows without its SIMULATED flag; claim survival counts dropped cites as kept.
import { slowRooms } from "../../../../services/relay/src/slow-rooms.ts";
import type { Check } from "../../lib/checks.ts";
import { CAP, MINT_A, slowEnv } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

type Syn = { forum: { agent: string; cites: string[] }[]; coins: { stance: string; claims: unknown[]; claims_dropped: number }[]; reports: { producer: string; cites: string[] }[]; scores: { claims: { producer: string; kept: number; dropped: number; survival: number }[] } };
type Sims = { runs: { id: string; simulated: boolean; wave_p: number; d_callers: number; drift: Record<string, unknown[]>; posts: { platform: string }[]; report: { markdown: string } | null }[] };

export const suite: Suite = {
  name: "slow-rooms",
  tier: "fast",
  covers: ["services/relay/src/slow-rooms.ts"],
  proves: "/v1/synthesis serves the forum, coin stances, reports with cites and claim survival per engine; /v1/simulations serves each swarm with simulated: true, impact, belief drift, posts per platform and its Swarm Report.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const w = await slowEnv("rooms");
    try {
      await w.seed();
      const synth = w.inProc(CAP.synth);
      const swarm = w.inProc(CAP.swarm);
      const ex = w.inProc(CAP.exchange);
      await synth.call("emit_forum_line", { synthesis_id: "sj_r1", as_of: w.clock.iso(), window_min: 1440, round: 0, agent: "host", text: "PEPE has two early callers [cid:co_a1].", cites: ["co_a1"] });
      await synth.call("emit_synthesis_coin", { synthesis_id: "sj_r1", mint: MINT_A, as_of: w.clock.iso(), window_min: 1440, stance: "bullish", narrative: "Two early callers.", preset: "lite", claims: [{ text: "Early callers [cid:co_a1]", cites: ["co_a1"] }, { text: "Invented", cites: ["co_FAKE"] }] });
      await ex.call("report_publish", { report_id: "sj_r1_0", producer: "bettafish.report", kind: "coin", subject: MINT_A, preset: "lite", summary: "PEPE has two early callers.", cites: ["co_a1", "co_a2", "co_FAKE"], markdown: "# Coin\n\nEarly [cid:co_a1]." });
      await swarm.call("emit_swarm_result", { swarm_id: "sj_s1", mint: MINT_A, preset: "lite", usd: 0, samples: [{ branch: "A", callers: 5, actions: 4, net_lamports: 0, truncated: false }, { branch: "A", callers: 5, actions: 4, net_lamports: 0, truncated: false }, { branch: "A", callers: 0, actions: 4, net_lamports: 0, truncated: false }, { branch: "A", callers: 0, actions: 4, net_lamports: 0, truncated: false }, { branch: "A", callers: 0, actions: 4, net_lamports: 0, truncated: false }, { branch: "B", callers: 3, actions: 4, net_lamports: 5e7, truncated: false }, { branch: "B", callers: 3, actions: 4, net_lamports: 5e7, truncated: false }], posts: [{ branch: "A", platform: "pumpfun", round: 0, agent: "caller_0001", archetype: "caller", text: "PEPE early" }, { branch: "B", platform: "twitter", round: 0, agent: "sniper_000", archetype: "sniper", text: "watching PEPE" }] });
      await swarm.call("emit_swarm_beliefs", { swarm_id: "sj_s1", mint: MINT_A, topic: "PEPE", branches: { A: [[{ round: 0, stance: { caller: 0.3 } }]], B: [[{ round: 0, stance: { caller: 0.5 } }]] } });
      await ex.call("report_publish", { report_id: "sj_s1_0", producer: "miroshark.report", kind: "swarm", subject: MINT_A, preset: "lite", summary: "SIMULATED swarm on PEPE: wave probability 0.40.", cites: ["co_a1"], markdown: "# Swarm Report (SIMULATED)\n\n## Spread path", simulated: true });
      const r = slowRooms({ sql: w.sql as never, cached: (_k, _ms, fn) => fn(), sym: () => "$PEPE" });
      const syn = (await r.synthesis()) as Syn;
      add("the forum line reaches /synthesis with its cites", syn.forum.length === 1 && syn.forum[0]!.agent === "host" && syn.forum[0]!.cites.includes("co_a1"), JSON.stringify(syn.forum));
      add("the coin stance keeps cited claims and counts the dropped one", syn.coins[0]?.stance === "bullish" && syn.coins[0].claims.length === 1 && syn.coins[0].claims_dropped === 1, JSON.stringify(syn.coins[0]));
      add("only BettaFish reports are listed on /synthesis", syn.reports.length === 1 && syn.reports[0]!.producer === "bettafish.report", syn.reports.map((x) => x.producer).join(","));
      const bf = syn.scores.claims.find((c) => c.producer === "bettafish.report");
      add("claim survival counts kept against dropped cites", bf?.kept === 2 && bf.dropped === 1 && Math.abs(bf.survival - 2 / 3) < 1e-9, JSON.stringify(bf));
      const sims = (await r.simulations()) as Sims;
      const run = sims.runs[0];
      add("a swarm run reaches /simulations marked simulated", sims.runs.length === 1 && run?.simulated === true && run.wave_p === 0.4 && run.d_callers === 1, JSON.stringify(run).slice(0, 160));
      add("belief drift for both branches and posts per platform", !!run?.drift.A && !!run.drift.B && run.posts.map((p) => p.platform).sort().join(",") === "pumpfun,twitter", JSON.stringify(run?.posts));
      add("the run links its Swarm Report (SIMULATED)", run?.report?.markdown.startsWith("# Swarm Report (SIMULATED)") === true, "");
      return { checks, metrics: { runs: sims.runs.length } };
    } finally {
      await w.close();
    }
  },
};
