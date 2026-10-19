// D6 (docs/SLOW-MIND.md section 4): swarm and mood numbers on the Board are core's own recompute from raw counts. Through the real
// MCP tools, the slow-signal projection and the Scorekeeper on a fresh database: wave_p from per-sample caller counts over full
// samples, an engine-sent wave_p refused by the schema, the mood from the feed's cited stances, and the swarm Brier on the
// recomputed value (null while nothing is scored).
import { slowSignals } from "../../../../services/core/src/analyzers/slow-signals.ts";
import { liveFor } from "../../../../services/core/src/board/board.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import { CAP, Toolbox } from "../../../../services/core/src/mcp/toolbox.ts";
import { scorekeeper } from "../../../../services/core/src/scorekeeper/scorekeeper.ts";
import { slowScores } from "../../../../services/core/src/scorekeeper/slow-scores.ts";
import { step } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const WAVE = env.int("SWARM_WAVE_CALLERS");
type Sample = { branch: "A" | "B"; callers: number; actions: number; net_lamports: number; truncated: boolean };
const s = (branch: "A" | "B", callers: number, net_sol: number, truncated = false): Sample => ({ branch, callers, actions: 5, net_lamports: net_sol * 1e9, truncated });
const callout = (id: string, wallet: string, at: string) => ({
  callout_id: id, mint: MINT, symbol: null, name: null, author_wallet: wallet, author_user_id: null, author_handle: null, author_x: null, author_followers: null, author_total_callouts: null,
  text: "call", media_url: null, mcap_at_call_usd: null, price_at_call_usd: null, created_at: at, chain: null, quoted_callout_id: null, author_position: null, via: "history" as const,
});

export const suite: Suite = {
  name: "slow-numbers",
  tier: "fast",
  covers: ["services/core/src/mcp/toolbox.ts", "services/core/src/analyzers/slow-signals.ts", "services/core/src/scorekeeper/slow-scores.ts"],
  proves: "D6: the Board's swarm wave_p, d_callers and d_net_sol are core's recompute from raw per-sample counts over full samples; an engine-sent wave_p is refused; mood.feed is computed from the feed's cited bullish and bearish stances; the swarm Brier reads the recomputed wave_p and is null when empty.",
  async run() {
    const db = await freshDb("slownumbers");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const iso = (ms: number) => new Date(ms).toISOString();
    try {
      const box = new Toolbox({ sql: db.sql, tape, clock, soulFile: "" }, new Map([["swarm", CAP.swarm], ["synth", CAP.synth]]));
      const before = await slowScores(db.sql, iso(t0));

      // five full A samples, two of them waves; one A sample cut short with a wave in it (left out); two full B and one cut B
      const samples = [s("A", WAVE + 1, 0.1), s("A", WAVE, 0.2), s("A", 2, 0), s("A", 1, 0), s("A", 0, 0), s("A", WAVE + 9, 9, true), s("B", 7, 1), s("B", 8, 1.5), s("B", 0, 0, true)];
      const r = await box.call("swarm", "emit_swarm_result", { swarm_id: "sw1", mint: MINT, preset: "nano", usd: 0.01, samples, posts: [] });
      const proj = slowSignals(clock);
      while (await step(db.sql, proj)) { /* drain */ }
      const board = await liveFor(db.sql, MINT, iso(t0));
      const wave = board["swarm.wave_p"]?.value as { wave_p: number; samples: number; truncated: boolean } | undefined;
      add("Board wave_p equals the raw-count recompute", r.ok && wave?.wave_p === 2 / 5 && wave.samples === 5, `${wave?.wave_p?.toFixed(2)} = 2/${wave?.samples} full samples${r.ok ? "" : ` (${r.message})`}`);
      const sent = await box.call("swarm", "emit_swarm_result", { swarm_id: "sw2", mint: MINT, preset: "nano", usd: 0, samples, posts: [], wave_p: 0.99 });
      add("an engine-sent wave_p is refused by the schema", !sent.ok && sent.code === "bad_args" && /Unrecognized key.*wave_p/.test(sent.message), sent.ok ? "accepted" : `${sent.code}: ${sent.message}`);
      const impact = board["swarm.impact"]?.value as { d_callers: number; d_net_sol: number; truncated: boolean } | undefined;
      const aMean = (WAVE + 1 + WAVE + 2 + 1 + 0) / 5;
      const wantCallers = 7.5 - aMean;
      const wantNet = 1.25 - 0.06;
      add("truncated samples are left out of every mean", !!impact && Math.abs(impact.d_callers - wantCallers) < 1e-9 && Math.abs(impact.d_net_sol - wantNet) < 1e-9 && impact.truncated && wave?.truncated === true,
        `d_callers ${impact?.d_callers} (${wantCallers} without the cut samples), d_net_sol ${impact?.d_net_sol?.toFixed(4)}, truncated ${impact?.truncated}`);

      // the mood from the feed's kept stances: three callouts behind bullish stances, one behind a bearish one
      for (const [i, id] of ["m1", "m2", "m3", "m4"].entries()) await db.sql`insert into mem.callouts (callout_id, mint, wallet, text, created_at, seen_at, first_on_coin) values (${id}, ${MINT}, ${`W${i}`}, 'call', ${iso(t0 - 600_000)}, ${iso(t0 - 600_000)}, false)`;
      const stance = (st: string, cites: string[]) => ({ mint: MINT, symbol: "FROG", stance: st, why: "Callers read the flow.", cites });
      const feed = await box.call("synth", "emit_synthesis_feed", { synthesis_id: "sf1", as_of: iso(t0), window_min: 60, preset: "nano", narratives: [], suspicious: [], coin_stances: [stance("bullish", ["m1", "m2"]), stance("bullish", ["m3"]), stance("bearish", ["m4"])] });
      const [m] = await db.sql`select body from tape.events where topic = 'mood.feed'`;
      const mb = m?.body as { mood: number; label: string; n_bullish: number; n_bearish: number; bull_share: number } | undefined;
      add("mood is emitted from counts", feed.ok && mb?.n_bullish === 3 && mb.n_bearish === 1 && mb.mood === 0.5 && mb.label === "greedy" && mb.bull_share === 0.75, JSON.stringify(mb ?? (feed.ok ? "none" : feed.message)));

      // the Scorekeeper scores the recomputed 0.40: five distinct real callers call within the horizon (a hit), Brier (0.4 - 1)^2
      const sk = scorekeeper(tape, clock);
      for (let i = 0; i < 5; i++) {
        clock.advance!(t0 + (10 + i) * 60_000);
        tape.emit("callout.created", callout(`c${i}`, `R${i}`, clock.iso()), { source: "feedreader", subject: MINT });
      }
      clock.advance!(t0 + (env.int("SWARM_HORIZON_MIN") + 5) * 60_000);
      tape.emit("callout.created", callout("c_late", "R9", clock.iso()), { source: "feedreader", subject: MINT });
      await tape.flush();
      while (await step(db.sql, sk)) { /* drain */ }
      const after = await slowScores(db.sql, clock.iso());
      add("the swarm Brier reads the recomputed wave_p; empty is null", before.swarm === null && after.swarm?.n === 1 && Math.abs(after.swarm.brier - 0.36) < 1e-9,
        `before ${JSON.stringify(before.swarm)}, after n ${after.swarm?.n} brier ${after.swarm?.brier} (want (0.4 - 1)^2 = 0.36)`);
      return { checks, metrics: { wave_p: wave?.wave_p ?? null, brier: after.swarm?.brier ?? null } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
