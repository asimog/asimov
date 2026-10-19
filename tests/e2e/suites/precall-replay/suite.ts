// Pre-call desk and house callouts (docs/PIPELINE.md flow and precall, docs/STRATEGY.md pre-call, docs/EXECUTION.md thesis and Publisher).
// A known caller's buy on a coin they have not called must produce precall.callout_p, scored by Brier; pre_call
// strategies may enter only then; every house callout is committed before it is queued, passes the text checks,
// is revealed on close and scored as the caller `house`. Order and restart proofs live in replay-determinism.
import { checkText } from "../../../../services/core/src/hands/text-checks.ts";
import { ledger } from "../../../../services/core/src/scorekeeper/ledger.ts";
import { HORIZONS, scoresAsOf } from "../../../../services/core/src/scorekeeper/scorekeeper.ts";
import { type Check, everyReplayChecks } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "precall-replay",
  tier: "slow",
  covers: ["services/core/src/analyzers/precall.ts", "services/core/src/mind/desk.ts", "services/core/src/scorekeeper/scorekeeper.ts"],
  proves:
    "Known-caller buys before their callout become precall.callout_p signals with no lookahead and a Brier score; pre_call strategies enter only on those coins; every house callout has a thesis committed before it, passes the text checks, is revealed on close and appears as the caller house in the ledger; order and restart proofs are in replay-determinism.",
  tape: true,
  async run(ctx) {
    const checks: Check[] = [];
    const main = await ctx.replay();
    const sql = main.sql;
    checks.push(...(await everyReplayChecks(sql, main.netCalls)));

    // 1. one precall signal per known-caller buy on a coin that caller has not called (computed here from Tape and Memory)
    const [want] = await sql`
      with t as (select id, subject mint, body->>'wallet' w, seen_time from tape.events where topic in ('trade.curve', 'trade.amm') and body->>'side' = 'buy')
      select count(*)::int n from t
      where exists (select 1 from mem.callouts c where c.wallet = t.w and c.seen_at < t.seen_time)
        and not exists (select 1 from mem.callouts c where c.wallet = t.w and c.mint = t.mint and c.seen_at <= t.seen_time)`;
    const [got] = await sql`select count(*)::int n, count(distinct subject)::int coins from board.signals where kind = 'precall.callout_p'`;
    checks.push({ name: "a precall signal on every known-caller buy before their callout", pass: got!.n === want!.n && want!.n > 0, detail: `${got!.n} signals on ${got!.coins} coins, ${want!.n} qualifying buys` });

    // 2. a caller's record counts only buys whose horizon ended before the signal
    const [early] = await sql`select count(*)::int n from board.signals where kind = 'precall.callout_p' and (value->>'n_called')::int > (value->>'n_buys')::int`;
    checks.push({ name: "caller record never counts more calls than closed buys", pass: early!.n === 0, detail: `${early!.n} signals with n_called > n_buys` });

    // 3. flow and Brier
    const [fl] = await sql`select count(*)::int n, count(distinct subject)::int coins from board.signals where kind = 'flow.state'`;
    checks.push({ name: "flow.state on traded coins", pass: fl!.n > 0, detail: `${fl!.n} signals on ${fl!.coins} coins` });
    const brier = (await scoresAsOf(sql, main.last, ["precall.callout_p"])).map((b) => ({ horizon_min: b.horizon_min, n: b.n, brier: (b.brier_sum / b.n).toFixed(4), base: (b.hits / b.n).toFixed(4) }));
    checks.push({ name: "precall.callout_p is Brier-scored", pass: brier.length > 0 && brier.every((b) => b.n > 0), detail: brier.map((b) => `${b.horizon_min}m n=${b.n} brier=${b.brier} base=${b.base}`).join("; ") || "no rows" });
    const [undated] = await sql`select count(*)::int n, count(distinct day)::int days from mind.score_days where day is null or day <> (${main.last}::timestamptz at time zone 'utc')::date`;
    const later = new Date(Date.parse(main.last) + Number(process.env.SCORE_WINDOW_DAYS ?? 30) * 86_400_000).toISOString();
    const gone = await scoresAsOf(sql, later);
    checks.push({ name: "Brier rows carry a day bucket and leave the window", pass: undated!.n === 0 && gone.length === 0, detail: `${undated!.n} rows outside the tape's day; ${gone.length} kinds still live ${process.env.SCORE_WINDOW_DAYS ?? 30} days later` });

    // 3b. the pre-call score: one sample per coin and buying caller, a hit only when that caller calls it (recomputed from the Tape)
    const samples = await sql`select w.mint, w.caller, w.at, w.hit, w.horizon_min,
        (select count(*)::int from tape.events c where c.topic = 'callout.created' and c.body->>'mint' = w.mint and c.body->>'author_wallet' = w.caller
          and c.seen_time > w.at and c.seen_time <= w.at + make_interval(mins => w.horizon_min)) own,
        (select count(*)::int from tape.events c where c.topic = 'callout.created' and c.body->>'mint' = w.mint
          and c.seen_time > w.at and c.seen_time <= w.at + make_interval(mins => w.horizon_min)) anyone,
        (select min(seen_time) from tape.events d where d.topic = 'precall.detected' and d.body->>'mint' = w.mint and d.body->>'caller' = w.caller) first_seen
      from mind.prob_watch w where w.kind = 'precall.callout_p' and w.done order by w.caller, w.at`;
    const [pairs] = await sql`select count(distinct (body->>'mint', body->>'caller'))::int n from tape.events where topic = 'precall.detected'`;
    const [watched] = await sql`select count(*)::int n from mind.prob_watch where kind = 'precall.callout_p'`;
    checks.push({ name: "one pre-call sample per coin and caller", pass: watched!.n === pairs!.n && pairs!.n > 0, detail: `${watched!.n} samples, ${pairs!.n} coin-caller pairs` });
    const wrong = samples.filter((s) => s.hit !== (s.own > 0 ? 1 : 0) || (s.first_seen as Date).getTime() !== (s.at as Date).getTime());
    const top3 = [...new Set(samples.map((s) => s.caller as string))].map((c) => ({ c, n: samples.filter((s) => s.caller === c).length })).sort((a, b) => b.n - a.n || (a.c < b.c ? -1 : 1)).slice(0, 3).map((x) => x.c);
    const table = samples.filter((s) => top3.includes(s.caller as string)).map((s) => `| ${(s.caller as string).slice(0, 8)} | ${(s.mint as string).slice(0, 8)} | ${(s.at as Date).toISOString()} | ${s.own} | ${s.anyone} | ${s.hit} |`);
    const othersOnly = samples.filter((s) => s.own === 0 && s.anyone > 0).length;
    checks.push({ name: "pre-call hits match the buying caller's own calls (three callers by hand)", pass: samples.length > 0 && wrong.length === 0 && top3.length === 3, detail: `${samples.length} resolved samples, ${wrong.length} disagree; ${othersOnly} were called only by someone else and count as misses` });

    // 4. pre_call strategies: seeded, and entering only on coins with a precall signal live at the intent
    const [seeds] = await sql`select count(*)::int n from mind.strategies where family = 'pre_call' and origin = 'seed'`;
    checks.push({ name: "six pre_call seeds", pass: seeds!.n === 6, detail: `${seeds!.n}` });
    const [pi] = await sql`
      select count(*)::int n, count(*) filter (where not exists (select 1 from board.signals s where s.kind = 'precall.callout_p' and s.subject = i.body->>'mint'
        and s.produced_at <= i.seen_time and s.valid_until > i.seen_time))::int bad
      from tape.events i join mind.strategies st on st.id = i.body->>'strategy_id'
      where i.topic = 'intent.created' and i.body->>'side' = 'buy' and st.family = 'pre_call'`;
    checks.push({ name: "pre_call entries only with a live precall signal", pass: pi!.bad === 0, detail: `${pi!.n} pre_call buy intents, ${pi!.bad} without a live signal` });

    // 5. house callouts: thesis committed first, text checks pass, revealed on close
    const posts = await sql`select seen_time, body from tape.events where topic = 'post.queued' order by seen_time, id`;
    const callouts = posts.filter((p) => (p.body as { kind: string }).kind === "callout");
    const [order] = await sql`
      select count(*)::int n, count(*) filter (where c.seen_time is null or c.seen_time >= p.seen_time)::int bad
      from tape.events p join tape.events t on t.topic = 'thesis.formed' and t.body->>'thesis_id' = p.body->>'thesis_id'
      left join tape.events c on c.topic = 'commit.made' and c.body->>'commit_id' = t.body->>'commit_id'
      where p.topic = 'post.queued' and p.body->>'kind' = 'callout'`;
    checks.push({ name: "every house callout has a thesis committed before it", pass: callouts.length > 0 && order!.n === callouts.length && order!.bad === 0, detail: `${callouts.length} callouts, ${order!.n} with a thesis, ${order!.bad} committed late` });
    const failed = posts.map((p) => p.body as { text: string; kind: "callout" | "update" | "reply"; paper: boolean }).filter((b) => !checkText(b.text, { kind: b.kind, paper: b.paper }).ok);
    checks.push({ name: "every post passes the text checks", pass: posts.length > 0 && failed.length === 0, detail: `${posts.length} posts, ${failed.length} failing${failed[0] ? `: ${failed[0].text}` : ""}` });
    const [rev] = await sql`
      select count(*)::int closed, count(r.id)::int revealed, count(*) filter (where (r.body->>'matches')::boolean is not true)::int bad
      from mind.house h left join tape.events t on t.topic = 'thesis.formed' and t.body->>'thesis_id' = h.thesis_id
      left join tape.events r on r.topic = 'commit.revealed' and r.body->>'commit_id' = t.body->>'commit_id'
      where h.closed_at is not null`;
    checks.push({ name: "closed house callouts reveal a matching thesis", pass: rev!.closed === rev!.revealed && rev!.bad === 0, detail: `${rev!.closed} closed, ${rev!.revealed} revealed, ${rev!.bad} not matching` });

    // 6. the house in the caller ledger
    const L = await ledger(sql, { horizon: HORIZONS.at(-1)! });
    const house = L.rows.find((r) => r.wallet === "house");
    const adds = !!house && house.ok + Object.values(house.excluded).reduce((a, b) => a + b, 0) === house.calls;
    checks.push({ name: "the house is a caller in the ledger", pass: adds && house!.calls === callouts.length, detail: house ? `${house.calls} calls, ${house.ok} ok, net_win ${house.net_win}` : "no house row" });

    const [det] = await sql`select count(*)::int n from tape.events where topic = 'precall.detected'`;
    checks.push({ name: "one precall.detected per precall signal", pass: det!.n === got!.n, detail: `${det!.n} events, ${got!.n} signals` });

    const sample = posts.slice(0, 12).map((p) => `- ${(p.body as { kind: string }).kind}: ${(p.body as { text: string }).text}`).join("\n");
    return {
      checks,
      metrics: { replay: { inputs: main.inputs, from: main.first, to: main.last }, precall: got, flow: fl, brier, pre_call_intents: pi, posts: posts.length, house: house ?? null, all: L.all },
      files: {
        "house-posts.md": `# House posts (PAPER)\n\n${sample}\n`,
        "precall-callers.md": `# Pre-call samples for three callers\n\nOwn: calls by the buying caller within the horizon. Anyone: calls by anyone. Hit is the Scorekeeper's.\n\n| Caller | Coin | Bought at | Own | Anyone | Hit |\n|---|---|---|---|---|---|\n${table.join("\n")}\n`,
      },
    };
  },
};
