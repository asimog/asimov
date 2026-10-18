// BettaFish feed and coin runs (docs/07) against a stub model: every claim that reaches the Tape cites a callout that
// exists, invented and mismatched claims are dropped (by the service, and again by core), presets set the forum, and
// untrusted text only ever sits inside its fence.
import { BudgetExceeded, Lane, type Responder } from "../../../../packages/lane/src/index.ts";
import { moodOf } from "../../../../services/bettafish/src/mood.ts";
import { type Preset, presetFromEnv } from "../../../../services/bettafish/src/preset.ts";
import { Runner, runCoin, runFeed } from "../../../../services/bettafish/src/synth.ts";
import { slowSignals } from "../../../../services/core/src/analyzers/slow-signals.ts";
import { liveFor } from "../../../../services/core/src/board/board.ts";
import { drain } from "../../../../services/core/src/tape/consumer.ts";
import type { Check } from "../../lib/checks.ts";
import { CAP, MINT_A, MINT_B, slowEnv, TEXTS } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "synthesis-run",
  proves: "Every synthesis claim on the Tape cites a callout that exists and is about the coin it names; presets change the forum; untrusted text stays fenced.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const w = await slowEnv("synth");
    try {
      await w.seed();
      const prompts: string[] = [];
      const stub: Responder = ({ user }) => {
        prompts.push(user);
        const ids = [...user.matchAll(/\[(co_\w+)\]/g)].map((m) => m[1]!);
        if (user.includes('"text": string')) return JSON.stringify({ text: `Insight reads ${ids.length} callouts.`, cites: [ids[0], "co_FAKE"] });
        if (user.includes("coin synthesis"))
          return JSON.stringify({ stance: "bullish", narrative: "PEPE callers are buying", claims: [{ text: "PEPE chart looks strong per callers", cites: ["co_a2"] }, { text: "PEPE has a rug per a callout", cites: ["co_b1"] }, { text: "PEPE is great", cites: [] }] });
        return JSON.stringify({
          narratives: [{ title: "PEPE buyers gather", summary: "Callers say PEPE looks early", cites: ["co_a1", "co_a2"] }, { title: "Invented story", summary: "Nothing here", cites: ["co_FAKE"] }, { title: "No sources", summary: "Trust me", cites: [] }],
          coin_stances: [{ mint: MINT_A, symbol: "PEPE", stance: "bullish", why: "buying more per callers", cites: ["co_a2"] }, { mint: MINT_A, symbol: "PEPE", stance: "bullish", why: "DOGE is rugging", cites: ["co_b1"] }],
          suspicious: [{ pattern: "bundle", text: "DOGE bundled per a callout", cites: ["co_b1"] }],
        });
      };
      let n = 0;
      const newId = () => `sy_test${++n}`;
      const mk = (preset: Preset, lane = new Lane("SYNTH", { stub, env: {} })) => ({ core: w.inProc(CAP.synth), lane, preset, newId });
      const env = (o: Record<string, string>) => presetFromEnv({ ...o });

      // 1. a lite feed run: 6 claims offered, 3 survive
      const lite = await runFeed(mk(env({ BETTAFISH_PRESET: "lite" })));
      const ok = "synthesis_id" in lite;
      add("feed run keeps the 3 supported claims and drops the 3 others", ok && lite.kept === 3 && lite.dropped === 3, JSON.stringify(lite));
      const [feed] = await w.sql`select body from tape.events where topic = 'synthesis.feed' and subject = 'global'`;
      const fb = feed!.body as { claims_total: number; claims_dropped: number; narratives: { cites: string[] }[]; coin_stances: { mint: string; cites: string[] }[] };
      add("the Tape body counts what was dropped", fb.claims_total === 6 && fb.claims_dropped === 3 && fb.narratives.length === 1 && fb.coin_stances.length === 1, `${fb.claims_total} total, ${fb.claims_dropped} dropped`);

      // 2. the coin run: 3 offered, 1 survives
      const coin = await runCoin(mk(env({ BETTAFISH_PRESET: "nano" })), MINT_A);
      add("coin run drops the claim about another coin and the one without a cite", "kept" in coin && coin.kept === 1 && coin.dropped === 2, JSON.stringify(coin));

      // 3. the second wall: core drops what a careless client sends
      const raw = await w.inProc(CAP.synth).call<{ claims_kept: number; claims_dropped: number }>("emit_synthesis_feed", {
        synthesis_id: "sy_raw", window_min: 60, preset: "raw", narratives: [{ title: "x", summary: "y", cites: ["co_FAKE"] }], coin_stances: [{ mint: MINT_A, symbol: "PEPE", stance: "bullish", why: "z", cites: ["co_b1"] }], suspicious: [{ pattern: "p", text: "t", cites: [] }],
      });
      add("core drops invented, empty and wrong-coin cites on its own", raw.claims_kept === 0 && raw.claims_dropped === 3, JSON.stringify(raw));

      // 4. every cite on the Tape exists and was seen before the event
      const bad = await w.sql`
        with cites as (
          select e.id, e.seen_time, c.cite from tape.events e
          cross join lateral (
            select jsonb_array_elements_text(x) cite from (
              select coalesce(jsonb_path_query_array(e.body, '$.**.cites[*]'), '[]'::jsonb) x
            ) q
          ) c
          where e.topic in ('synthesis.feed', 'synthesis.coin', 'synthesis.forum_line')
        )
        select count(*)::int total, count(*) filter (where m.callout_id is null or m.seen_at > cites.seen_time)::int missing
        from cites left join mem.callouts m on m.callout_id = cites.cite`;
      add("no cite on the Tape is missing or from the future", bad[0]!.total > 0 && bad[0]!.missing === 0, `${bad[0]!.total} cites, ${bad[0]!.missing} missing`);

      // 5. presets set the forum
      const lines = async (id: string) => (await w.sql`select count(*)::int n from tape.events where topic = 'synthesis.forum_line' and body->>'synthesis_id' = ${id}`)[0]!.n as number;
      const nano = await runFeed(mk(env({ BETTAFISH_PRESET: "nano" })));
      const full = await runFeed(mk(env({ BETTAFISH_PRESET: "full" })));
      const tuned = await runFeed(mk(env({ BETTAFISH_PRESET: "nano", BETTAFISH_FORUM_ROUNDS: "3", BETTAFISH_HOST_EVERY_N: "3" })));
      const idOf = (r: unknown) => (r as { synthesis_id: string }).synthesis_id;
      add("nano has no forum, lite 2 lines, full 4 lines", (await lines(idOf(nano))) === 0 && (await lines(idOf(lite))) === 2 && (await lines(idOf(full))) === 4, `${await lines(idOf(nano))}, ${await lines(idOf(lite))}, ${await lines(idOf(full))}`);
      add("a single knob overrides the preset (3 rounds, host every 3rd speech = 4 lines)", (await lines(idOf(tuned))) === 4, String(await lines(idOf(tuned))));
      add("engines without a sense are skipped and reported", "skipped_engines" in lite && lite.skipped_engines.join() === "query" && "skipped_engines" in full && full.skipped_engines.join() === "query,media");

      // 6. untrusted text only inside its fence
      const outside = prompts.map((p) => p.replace(/<untrusted>[\s\S]*?<\/untrusted>/g, "")).filter((p) => /ignore previous/i.test(p));
      add("a callout that says 'ignore previous instructions' is only ever inside <untrusted>", prompts.some((p) => /<untrusted>ignore previous/.test(p)) && outside.length === 0, `${prompts.length} prompts`);

      // 7. mood by code
      const m = moodOf(Object.values(TEXTS));
      const [mood] = await w.sql`select body from tape.events where topic = 'mood.feed' and body->>'synthesis_id' = ${idOf(lite)}`;
      add("mood.feed is computed by code from the callout text", Math.abs((mood!.body as { mood: number }).mood - m.mood) < 1e-9, `${(mood!.body as { mood: number }).mood} vs ${m.mood}`);

      // 8. the Board shows it
      await drain(w.sql, slowSignals(w.clock));
      const g = await liveFor(w.sql, "global", w.clock.iso());
      const c = await liveFor(w.sql, MINT_A, w.clock.iso());
      add("the Board holds synthesis.feed, mood.feed and synthesis.coin", !!g["synthesis.feed"] && !!g["mood.feed"] && !!c["synthesis.coin"], Object.keys({ ...g, ...c }).join(", "));

      // 9. one run at a time
      const runner = new Runner();
      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      const first = runner.once(() => hold);
      const second = await runner.once(async () => "ran");
      release();
      await first;
      add("a run that overlaps a running one is skipped, never queued", second === null && runner.skipped === 1 && (await runner.once(async () => "ran")) === "ran");

      // 10. a lane over its limit writes nothing
      const before = (await w.sql`select count(*)::int n from tape.events where topic = 'synthesis.feed'`)[0]!.n as number;
      const broke = new Lane("SYNTH", { stub, env: {}, capUsdHour: 0 });
      const refused = await runFeed(mk(env({ BETTAFISH_PRESET: "lite" }), broke)).then(() => "ran", (e) => (e instanceof BudgetExceeded ? "budget" : String(e)));
      add("a lane over its hourly limit is refused and writes nothing", refused === "budget" && (await w.sql`select count(*)::int n from tape.events where topic = 'synthesis.feed'`)[0]!.n === before, refused);
      return { checks, metrics: { runs: n, prompts: prompts.length, usd: Math.round(1e6 * (lite as { usd: number }).usd) / 1e6 } };
    } finally {
      await w.close();
    }
  },
};
