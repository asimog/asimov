// Pre-call desk and house callouts (docs/07 flow and precall, docs/08 pre-call, docs/09 thesis and Publisher).
// A known caller's buy on a coin they have not called must produce precall.callout_p, scored by Brier; pre_call
// strategies may enter only then; every house callout is committed before it is queued, passes the text checks,
// is revealed on close and scored as the caller `house`. A restart halfway changes nothing.
import { checkText } from "../../../../services/core/src/hands/text-checks.ts";
import { ledger } from "../../../../services/core/src/scorekeeper/ledger.ts";
import { derivedHash, everyReplayChecks, type Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "precall-replay",
  proves:
    "Known-caller buys before their callout become precall.callout_p signals with no lookahead and a Brier score; pre_call strategies enter only on those coins; every house callout has a thesis committed before it, passes the text checks, is revealed on close and appears as the caller house in the ledger; a restart changes nothing.",
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
    const brier = await sql`select horizon_min, n, round((brier_sum / n)::numeric, 4)::float brier, round((hits::float / n)::numeric, 4)::float base from mind.scores where kind = 'precall.callout_p'`;
    checks.push({ name: "precall.callout_p is Brier-scored", pass: brier.length > 0 && brier.every((b) => b.n > 0), detail: brier.map((b) => `${b.horizon_min}m n=${b.n} brier=${b.brier} base=${b.base}`).join("; ") || "no rows" });

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
    const L = await ledger(sql, { horizon: 5 });
    const house = L.rows.find((r) => r.wallet === "house");
    const adds = !!house && house.ok + Object.values(house.excluded).reduce((a, b) => a + b, 0) === house.calls;
    checks.push({ name: "the house is a caller in the ledger", pass: adds && house!.calls === callouts.length, detail: house ? `${house.calls} calls, ${house.ok} ok, net_win ${house.net_win}` : "no house row" });

    // 7. restart
    const r = await ctx.replay("restart", { restartAt: Number(process.env.E2E_RESTART_AT ?? 0.5) });
    const a = await derivedHash(sql);
    const b = await derivedHash(r.sql);
    checks.push({ name: "consumer restart gives the same derived hash", pass: a.sha256 === b.sha256 && a.events > 0, detail: `${a.sha256.slice(0, 16)} vs ${b.sha256.slice(0, 16)}` });

    const sample = posts.slice(0, 12).map((p) => `- ${(p.body as { kind: string }).kind}: ${(p.body as { text: string }).text}`).join("\n");
    return {
      checks,
      metrics: { replay: { inputs: main.inputs, from: main.first, to: main.last }, precall: got, flow: fl, brier, pre_call_intents: pi, posts: posts.length, house: house ?? null, all: L.all },
      files: { "house-posts.md": `# House posts (PAPER)\n\n${sample}\n` },
    };
  },
};
