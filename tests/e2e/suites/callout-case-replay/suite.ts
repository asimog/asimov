// Callout tracking v2 (docs/PIPELINE.md): outcomes ov2 with coverage, the caller ledger, case files, a late-reported gap,
// a consumer restart and duplicate ingestion. The worst ok call's case file is written as the artifact.
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import { buildCase, renderCase } from "../../../../services/core/src/hunt/case.ts";
import { coverage, ledger } from "../../../../services/core/src/scorekeeper/ledger.ts";
import { HORIZONS } from "../../../../services/core/src/scorekeeper/scorekeeper.ts";
import { derivedHash, everyReplayChecks, type Check } from "../../lib/checks.ts";
import { readTape, type Row } from "../../lib/replay.ts";
import type { Suite } from "../../lib/suite.ts";

const SECTIONS = ["OBSERVED", "STATISTICS", "AI JUDGMENTS", "INDICATORS", "UNRESOLVED", "OUTCOMES AND CORRECTIONS"];
const COVERAGE = ["ok", "no_entry", "no_trades", "gap"];

export const suite: Suite = {
  name: "callout-case-replay",
  proves:
    "Every callout outcome is ov2 with a coverage status; the caller ledger's denominators add up and keep losing calls; a case file has six evidence sections, fences untrusted text and rebuilds byte-identical; a late gap supersedes overlapping outcomes without deleting them; a consumer restart and duplicate ingestion change nothing.",
  tape: true,
  async run(ctx) {
    const checks: Check[] = [];
    const main = await ctx.replay();
    const sql = main.sql;
    checks.push(...(await everyReplayChecks(sql, main.netCalls)));

    // 1. outcomes ov2
    const [oc] = await sql`select count(*)::int n,
        count(*) filter (where body->>'method' <> 'ov2' or not (body->>'coverage' = any(${COVERAGE})))::int bad,
        count(*) filter (where body->>'coverage' = 'ok')::int ok
      from tape.events where topic = 'outcome.measured'`;
    checks.push({ name: "every outcome is ov2 with a coverage status", pass: oc!.n > 0 && oc!.bad === 0, detail: `${oc!.n} outcomes, ${oc!.bad} bad, ${oc!.ok} ok` });

    // 2. ledger: every callout counted once, exclusions by reason, losers kept
    const L = await ledger(sql, { horizon: HORIZONS.at(-1)! });
    const [cc] = await sql`select count(*)::int n from tape.events where topic = 'callout.created'`;
    const adds = (row: typeof L.all) => row.ok + Object.values(row.excluded).reduce((a, b) => a + b, 0) === row.calls;
    const badRows = L.rows.filter((r) => !adds(r)).length;
    checks.push({ name: "ledger denominators add up", pass: adds(L.all) && badRows === 0 && L.all.calls === cc!.n, detail: `all: ${L.all.calls} calls = ${L.all.ok} ok + ${JSON.stringify(L.all.excluded)}; ${badRows} bad rows; ${cc!.n} callouts on the tape` });
    const [losers] = await sql`
      select count(*)::int n from (select distinct on (body->>'callout_id') body from tape.events
        where topic = 'outcome.measured' and (body->>'horizon_min')::int = 5 order by body->>'callout_id', seen_time desc, id desc) x
      where body->>'coverage' = 'ok' and (body->>'net_multiple')::float < 1`;
    checks.push({ name: "losing calls are in the ledger", pass: losers!.n > 0 && L.all.ok >= losers!.n && L.all.net_win != null && L.all.net_win < 1, detail: `${losers!.n} losing ok calls of ${L.all.ok}; net_win ${L.all.net_win}` });

    // 3. the case file of the worst ok call at the longest horizon
    const [worst] = await sql`
      select body->>'callout_id' id, (body->>'net_multiple')::float net from (select distinct on (body->>'callout_id') body from tape.events
        where topic = 'outcome.measured' and (body->>'horizon_min')::int = 5 order by body->>'callout_id', seen_time desc, id desc) x
      where body->>'coverage' = 'ok' and exists (select 1 from tape.events c where c.topic = 'callout.created' and c.subject = x.body->>'callout_id') -- a stranger's callout, not our own paper post
      order by (body->>'net_multiple')::float, body->>'callout_id' limit 1`;
    const c1 = worst ? await buildCase(sql, worst.id as string) : null;
    const c2 = worst ? await buildCase(sql, worst.id as string) : null;
    const md = c1 ? renderCase(c1) : "";
    const j1 = JSON.stringify(c1);
    checks.push({ name: "case file rebuilds byte-identical", pass: !!c1 && j1 === JSON.stringify(c2) && md === renderCase(c2!), detail: worst ? `${worst.id} net ${(worst.net as number).toFixed(3)}` : "no ok outcome" });
    const missing = SECTIONS.filter((h) => !md.includes(`## ${h}`));
    const order = SECTIONS.map((h) => md.indexOf(`## ${h}`));
    checks.push({ name: "case file has six evidence sections in order", pass: missing.length === 0 && order.every((v, i) => i === 0 || v > order[i - 1]!), detail: missing.length ? `missing ${missing.join(", ")}` : "all six" });
    const text = c1?.observed.text ?? "";
    const fence = c1?.observed.fence ?? "";
    const fenced = !!fence && md.includes(`${fence}text\n${text}\n${fence}`) && !text.includes(fence);
    checks.push({ name: "untrusted text is fenced", pass: fenced, detail: `fence ${fence.length} backticks, text ${text.length} chars` });

    // 4. indicators over every callout: each has evidence, other explanations and limits
    const ids = (await sql`select body->>'callout_id' id from tape.events where topic = 'callout.created' order by seen_time, id`).map((r) => r.id as string);
    const fired: Record<string, number> = {};
    let incomplete = 0;
    for (const id of ids) {
      const c = await buildCase(sql, id);
      for (const i of c?.indicators ?? []) {
        if (!i.fired) continue;
        fired[i.name] = (fired[i.name] ?? 0) + 1;
        if (!i.evidence.length || !i.alternatives.length || !i.limits) incomplete++;
      }
    }
    checks.push({ name: "indicators carry evidence, alternatives and limits", pass: (fired.ticker_collision ?? 0) > 0 && incomplete === 0, detail: `${JSON.stringify(fired)}; ${incomplete} incomplete` });

    // 5. a gap reported late: trades missed from minute 2 to 4, reported at minute 7
    const first = Date.parse(main.first);
    const at = (s: number) => new Date(first + s * 1000).toISOString();
    const gapRow: Row = { id: "ev_00000000000000000000000GAP", topic: "system.gap", v: 2, event_time: at(420), seen_time: at(420), source: "nats", subject: null, causes: [], mode: "replay", body: { source: "trades", scope: null, from: at(120), to: at(240), reason: "fixture: NATS disconnect reported on reconnect" } };
    const g = await ctx.replay("gap", { extra: [gapRow] });
    const [gs] = await g.sql`select
        count(*) filter (where body->>'supersedes' is not null)::int superseding,
        count(*) filter (where body->>'supersedes' is not null and exists (select 1 from tape.events o where o.id = e.body->>'supersedes'))::int originals_kept,
        count(*) filter (where body->>'coverage' = 'gap')::int gap
      from tape.events e where topic = 'outcome.measured'`;
    const [overlap] = await g.sql`
      select count(*)::int n, count(*) filter (where body->>'coverage' <> 'gap')::int wrong from (
        select distinct on (body->>'callout_id', body->>'horizon_min') body from tape.events
        where topic = 'outcome.measured' order by body->>'callout_id', body->>'horizon_min', seen_time desc, id desc) x
      where (body->>'t0')::timestamptz <= ${at(240)} and (body->>'t0')::timestamptz + make_interval(mins => (body->>'horizon_min')::int) >= ${at(120)}`;
    const GL = await ledger(g.sql, { horizon: HORIZONS.at(-1)! });
    checks.push({ name: "late gap supersedes overlapping outcomes", pass: gs!.superseding > 0 && gs!.originals_kept === gs!.superseding && overlap!.n > 0 && overlap!.wrong === 0, detail: `${gs!.superseding} superseding (${gs!.originals_kept} originals kept), ${overlap!.n} overlapping, ${overlap!.wrong} not marked gap` });
    checks.push({ name: "ledger counts gap exclusions", pass: (GL.all.excluded.gap ?? 0) > 0 && GL.all.calls === L.all.calls, detail: `gap excluded ${GL.all.excluded.gap ?? 0}; calls ${GL.all.calls} vs ${L.all.calls}` });

    // 6. duplicates through the sense path: the same trades twice with sense dedupe keys are written once
    const trades = (await readTape(ctx.tape)).filter((r) => r.topic === "trade.curve").slice(0, 200);
    const tape = new Tape(g.sql, replayClock(Date.parse(main.last) + 600_000, 7));
    const [before] = await g.sql`select count(*)::int n from tape.events where topic = 'trade.curve'`;
    for (let k = 0; k < 2; k++) for (const t of trades) { const b = t.body as { tx: string; slot_index_id: string | null; mint: string }; tape.emit("trade.curve", b as never, { source: "nats", subject: b.mint, dedupe: `trade:${b.tx}:${b.slot_index_id ?? ""}` }); }
    await tape.flush();
    const [after] = await g.sql`select count(*)::int n from tape.events where topic = 'trade.curve'`;
    checks.push({ name: "duplicate trades are written once", pass: after!.n - before!.n === trades.length, detail: `${trades.length} trades sent twice, ${after!.n - before!.n} written` });

    // 7. a restart halfway changes nothing
    const r = await ctx.replay("restart", { restartAt: Number(process.env.E2E_RESTART_AT ?? 0.5) });
    const a = await derivedHash(sql);
    const b = await derivedHash(r.sql);
    checks.push({ name: "consumer restart gives the same derived hash", pass: a.sha256 === b.sha256 && a.events > 0, detail: `${a.sha256.slice(0, 16)} vs ${b.sha256.slice(0, 16)} (${a.events} vs ${b.events} events)` });

    return {
      checks,
      metrics: { replay: { inputs: main.inputs, from: main.first, to: main.last }, outcomes: oc, coverage: await coverage(sql), ledger_all: L.all, ledger_method: L.method, callers: L.rows.length, indicators: fired, case: worst ?? null },
      files: c1 ? { "case.md": md, "case.json": `${JSON.stringify(c1, null, 2)}\n` } : undefined,
    };
  },
};
