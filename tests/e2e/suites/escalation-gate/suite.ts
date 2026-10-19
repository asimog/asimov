// D1 (docs/SLOW-MIND.md section 3): the escalation gate grants a stage 1 slow run to an unsure in-play coin, none to a sure one,
// records control coins with no job, refreshes the hot set every HOT_SET_EVERY_S of Tape time, and a stage 1 result lands on
// the Board within 15 s of its grant. Synthetic rows on a fresh database with a replay clock.
import type { BodyOf } from "../../../../packages/contracts/src/index.ts";
import { slowSignals } from "../../../../services/core/src/analyzers/slow-signals.ts";
import { putSignal } from "../../../../services/core/src/board/board.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { CAP, Toolbox } from "../../../../services/core/src/mcp/toolbox.ts";
import { validate } from "../../../../services/core/src/mind/dsl.ts";
import { armOf, escalationGate, gateConfig } from "../../../../services/core/src/mind/escalate.ts";
import { seedSpecs } from "../../../../services/core/src/mind/seeds.ts";
import { step, type Tx } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

/** Mint-shaped names, picked by arm so each check has the arm it needs. */
const mints = Array.from({ length: 40 }, (_, i) => `Esc${String(i).padStart(2, "0")}${"x".repeat(38)}`);
const runs = mints.filter((m) => armOf(m) === "run");
const controls = mints.filter((m) => armOf(m) === "control");
const [UNSURE, SURE] = runs as [string, string];
const CONTROL = controls[0]!;
const HOT = runs.slice(2, 8); // six candidates; the hot set keeps five

export const suite: Suite = {
  name: "escalation-gate",
  tier: "fast",
  covers: ["services/core/src/mind/escalate.ts", "services/core/src/mind/dsl.ts"],
  proves: "D1: an unsure in-play coin gets a stage 1 grant (arm run), a sure one none, a control coin a record with no job; the hot set grants stage 1 to the top five every 90 s of Tape time; a slow kind in a fast strategy is refused; stage 1 lands on the Board within 15 s.",
  async run() {
    const db = await freshDb("escgate");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const at = (s: number) => {
      clock.advance!(t0 + s * 1000);
      return new Date(t0 + s * 1000).toISOString();
    };
    try {
      const sig = (mint: string, p: number, caller_p: number) =>
        putSignal(db.sql as unknown as Tx, clock, { kind: "precall.callout_p", subject: mint, value: { p, caller_p }, confidence: 0.8, validMs: 3_600_000, inputs: [], analyzer: "test", at: new Date(t0).toISOString() });
      await sig(UNSURE, 0.5, 0);
      await sig(SURE, 0.9, 0);
      await sig(CONTROL, 0.5, 0);
      for (const [i, m] of HOT.entries()) await sig(m, 0.9 - i * 0.1, 0.8);
      const precall = (mint: string, s: number) => {
        at(s);
        tape.emit("precall.detected", { mint, caller: "Caller1", trade_id: `t_${mint.slice(0, 5)}`, buy_sol: 0.5, p: 0.5, horizon_min: 5 }, { source: "analyzer", subject: mint });
      };
      precall(UNSURE, 1);
      precall(SURE, 2);
      precall(CONTROL, 3);
      await tape.flush();
      const gate = escalationGate(tape, clock, { ...gateConfig(), perHour: { 1: 100, 2: 100 } });
      while (await step(db.sql, gate)) { /* drain */ }
      const [first] = await db.sql`select seen_time from tape.events where topic = 'jev.escalated' and subject = ${UNSURE} and not (body->'gate_reasons' ? 'hot_set')`;
      const grantMs = first ? (first.seen_time as Date).getTime() : t0;

      // the Bridge's stage 1 result 10 s after the grant, through the real MCP tool, then the Board projection
      const callAt = at((grantMs - t0) / 1000 + 10);
      await db.sql`insert into mem.callouts (callout_id, mint, wallet, text, created_at, seen_at, first_on_coin) values ('co_1', ${UNSURE}, 'Caller1', 'call', ${callAt}, ${callAt}, true)`;
      const box = new Toolbox({ sql: db.sql, tape, clock, soulFile: "" }, new Map([["tok", CAP.synth]]));
      const r = await box.call("tok", "emit_synthesis_coin", { synthesis_id: "sj_1", mint: UNSURE, stance: "bullish", narrative: "Callers see a fresh launch.", preset: "nano", claims: [{ text: "One caller bought early.", cites: ["co_1"] }] });
      const slow = slowSignals(clock);
      while (await step(db.sql, slow)) { /* drain */ }
      const [b] = await db.sql`select produced_at from board.signals where kind = 'synthesis.coin' and subject = ${UNSURE}`;
      const lag = b ? ((b.produced_at as Date).getTime() - grantMs) / 1000 : null;

      tape.emit("trade.curve", { mint: HOT[0]!, tx: "tick", slot_index_id: null, ts: at(91), side: "buy", wallet: "W", sol: 0.1, usd: null, tokens: 1, price_sol: 1e-8, price_usd: null, mcap_usd: null, on_curve: true, program: null, pool_sol: null }, { source: "nats", subject: HOT[0]! });
      await tape.flush();
      while (await step(db.sql, gate)) { /* drain */ }

      const esc = (await db.sql`select seen_time, body from tape.events where topic = 'jev.escalated' order by seen_time, id`).map((r) => ({ at: (r.seen_time as Date).getTime(), ...(r.body as BodyOf<"jev.escalated">) }));
      const of = (m: string) => esc.filter((x) => x.subject === m && !x.gate_reasons.includes("hot_set"));
      const u = of(UNSURE).filter((x) => x.stage === 1);
      add("an unsure precall coin gets a stage 1 grant", u.length === 1 && u[0]!.arm === "run" && u[0]!.stage === 1 && u[0]!.job === "synthesis_coin", `${u.length} grant, arm ${u[0]?.arm}`);
      add("a sure coin (p 0.9) gets none", of(SURE).length === 0, `${of(SURE).length} grants`);
      const c = of(CONTROL);
      add("the control arm records without a job", c.length === 1 && c[0]!.arm === "control" && c[0]!.job === null && c[0]!.gate_reasons.includes("control"), `arm ${c[0]?.arm}, job ${c[0]?.job ?? "none"}`);
      const hot = esc.filter((x) => x.gate_reasons.includes("hot_set"));
      const ticks = [...new Set(hot.map((x) => x.at))];
      const perTick = ticks.map((t) => new Set(hot.filter((x) => x.at === t).map((x) => x.subject)));
      const top5 = HOT.slice(0, 5);
      add("the hot set grants stage 1 every 90 s of Tape time", ticks.length === 2 && ticks[1]! - ticks[0]! === 90_000 && perTick.every((s) => s.size === 5 && top5.every((m) => s.has(m))) && hot.every((x) => x.stage === 1),
        `${perTick.map((s) => s.size).join(" and ")} coins at ${ticks.map((t) => (t - t0) / 1000).join(", ")} s`);

      const fast = structuredClone(seedSpecs().find((s) => s.horizon === "fast")!);
      fast.universe.all.push({ sig: "synthesis.coin", field: "stance", op: "==", v: "bullish" });
      const v = validate(fast);
      add("a slow kind in a fast strategy is refused", !v.ok && v.reasons.some((r) => r.includes("synthesis.coin")), v.ok ? "accepted" : v.reasons.join("; "));

      add("stage 1 lands on the Board within 15 s", r.ok && lag !== null && lag <= 15, `${lag ?? "no signal"} s after the grant${r.ok ? "" : ` (${r.message})`}`);
      return { checks, metrics: { escalations: esc.length, hot: hot.length } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
