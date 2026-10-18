// MiroShark swarm runs (docs/07) against a stub model: results land on the Tape labeled simulated, branch B shows the
// impact of our callout, a run is repeatable from its seed, the USD cap truncates, unsafe posts never reach the Tape.
import { Lane, type Responder } from "../../../../packages/lane/src/index.ts";
import { Quota, runSwarm, type SwarmPreset, swarmPresetFromEnv } from "../../../../services/miroshark/src/swarm.ts";
import { slowSignals } from "../../../../services/core/src/analyzers/slow-signals.ts";
import { liveFor } from "../../../../services/core/src/board/board.ts";
import { drain } from "../../../../services/core/src/tape/consumer.ts";
import type { Check } from "../../lib/checks.ts";
import { CAP, MINT_A, slowEnv } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

export const suite: Suite = {
  name: "swarm-run",
  proves: "A swarm run writes wave_p, impact and simulated posts through core; branch B differs from A; the same seed repeats; the USD cap truncates; unsafe posts are refused.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const w = await slowEnv("swarm");
    try {
      await w.seed();
      for (let i = 0; i < 12; i++) await w.sql`insert into mem.callers (wallet, handle, followers, first_seen, calls_seen) values (${`Wallet${String(i).padStart(2, "0")}${"1".repeat(34)}`}, ${`c${i}`}, 100, now(), ${5 + i}) on conflict do nothing`;
      let calls = 0;
      const stub: Responder = ({ user }) => {
        calls++;
        const round = Number(/Round (\d+)/.exec(user)?.[1] ?? 1);
        const h = hash(user.slice(0, 120) + round);
        const sawUs = user.includes("asimog:");
        if (user.includes("Caller ")) {
          if (user.includes("Caller c11")) return JSON.stringify({ action: "post_callout", text: "@someone this is a scam, wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" });
          if (sawUs || h % 4 === 0) return JSON.stringify({ action: "post_callout", text: `Bought PEPE round ${round}` });
          return JSON.stringify({ action: "do_nothing" });
        }
        if (user.includes("paper hand") && round >= 2) return JSON.stringify({ action: "sell", fraction: 1 });
        if (user.includes("Feed:\n(empty)")) return JSON.stringify({ action: "do_nothing" });
        return JSON.stringify({ action: "buy", sol: 0.05 });
      };
      let n = 0;
      const deps = (p: SwarmPreset, lane = new Lane("SWARM", { stub, env: {} })) => ({ core: w.inProc(CAP.swarm), lane, preset: p, newId: () => `sw_test${++n}` });
      const small = (o: Record<string, string>) => swarmPresetFromEnv({ SWARM_CALLER_AGENTS: "12", SWARM_FOLLOWER_AGENTS: "12", SWARM_ROUNDS: "3", SWARM_SAMPLES: "2", SWARM_USD_CAP_PER_RUN: "1", ...o });

      // 1. nano: branch A only
      const nano = await runSwarm(deps(small({ SWARM_PRESET: "nano" })), { mint: MINT_A, seed: 5 });
      add("nano runs branch A only: impact is zero", nano.d_callers === 0 && nano.d_net_sol === 0 && nano.wave_p >= 0 && nano.wave_p <= 1, JSON.stringify(nano));

      // 2. lite: A and B
      const lite = await runSwarm(deps(small({ SWARM_PRESET: "lite" })), { mint: MINT_A, seed: 5 });
      add("lite runs A and B: our callout brings more callers and more SOL", lite.d_callers > 0 && lite.d_net_sol > 0, `d_callers ${lite.d_callers}, d_net_sol ${lite.d_net_sol.toFixed(3)}`);
      const ev = await w.sql`select topic, body from tape.events where topic in ('swarm.wave_p', 'swarm.impact', 'swarm.post') and body->>'swarm_id' = ${lite.swarm_id}`;
      const posts = ev.filter((e) => e.topic === "swarm.post").map((e) => e.body as { simulated: boolean; branch: string; text: string });
      add("wave_p, impact and posts are on the Tape; every post says simulated", ev.some((e) => e.topic === "swarm.wave_p") && ev.some((e) => e.topic === "swarm.impact") && posts.length > 0 && posts.every((p) => p.simulated === true), `${posts.length} posts`);
      add("both branches have posts, and only B has our callout", posts.some((p) => p.branch === "A") && posts.some((p) => p.branch === "B") && posts.filter((p) => p.branch === "A").every((p) => !/Bought 0\.02/.test(p.text)) && posts.some((p) => p.branch === "B" && /Bought 0\.02/.test(p.text)));
      add("a post with a handle, a wallet and a label never reaches the Tape", !posts.some((p) => /@|scam|7xKX/.test(p.text)), `${posts.length} kept`);

      // 3. repeatable
      const again = await runSwarm(deps(small({ SWARM_PRESET: "lite" })), { mint: MINT_A, seed: 5 });
      add("the same seed gives the same result", again.wave_p === lite.wave_p && again.d_callers === lite.d_callers && again.d_net_sol === lite.d_net_sol && again.posts_written === lite.posts_written);
      const other = await runSwarm(deps(small({ SWARM_PRESET: "lite" })), { mint: MINT_A, seed: 99 });
      add("a different seed changes the order of play", other.d_net_sol !== lite.d_net_sol || other.d_callers !== lite.d_callers, `${other.d_net_sol.toFixed(4)} vs ${lite.d_net_sol.toFixed(4)}`);

      // 4. the USD cap
      const callsBefore = calls;
      const capped = await runSwarm(deps(small({ SWARM_PRESET: "lite", SWARM_USD_CAP_PER_RUN: "0.000001" })), { mint: MINT_A, seed: 5 });
      const [tw] = await w.sql`select body from tape.events where topic = 'swarm.wave_p' and body->>'swarm_id' = ${capped.swarm_id}`;
      add("a run over its USD cap stops and is marked truncated", capped.truncated && (tw!.body as { truncated: boolean }).truncated && calls - callsBefore < callsBefore / 4, `${calls - callsBefore} calls vs ${callsBefore} before`);

      // 5. the Board
      await drain(w.sql, slowSignals(w.clock));
      const live = await liveFor(w.sql, MINT_A, w.clock.iso());
      add("the Board holds swarm.wave_p and swarm.impact for the coin", !!live["swarm.wave_p"] && !!live["swarm.impact"] && live["swarm.wave_p"]!.analyzer === "miroshark@1");

      // 6. quota and unknown coin
      let t = 0;
      const q = new Quota(2, () => t);
      const takes = [q.take(), q.take(), q.take()];
      t = 3_600_001;
      add("runs per hour are limited, and the hour rolls", takes.join() === "true,true,false" && q.take() === true, takes.join());
      const missing = await runSwarm(deps(small({ SWARM_PRESET: "nano" })), { mint: "1".repeat(44) }).then(() => "ran", (e: Error) => e.message);
      add("an unknown coin is refused by core", /no coin/.test(missing), missing);
      return { checks, metrics: { lite_wave_p: lite.wave_p, lite_d_callers: lite.d_callers, lite_d_net_sol: lite.d_net_sol, llm_calls: calls, usd_lite: lite.usd } };
    } finally {
      await w.close();
    }
  },
};
