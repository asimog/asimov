// Same tape, same code, same config, same seed: the derived events and signals hash the same, whatever the consumer order,
// across a restart halfway, and with the live leg trading beside the paper desk.
import { derivedHash } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "replay-determinism",
  tier: "slow",
  covers: ["services/core/src/tape/", "services/core/src/lib/clock.ts", "services/core/src/runtime.ts", "tests/e2e/lib/replay.ts", "services/core/src/hands/trader.ts", "services/core/src/treasury/", "services/core/src/mind/desk.ts", "services/core/src/analyzers/precall.ts"],
  proves: "Replays of one tape in fresh databases derive byte-identical events and signals when every consumer stage runs in reverse and when every consumer restarts halfway; the desk wakes on the same pre-call buys; the live leg (gate, Trader, books, kill on the mock chain) is deterministic too.",
  tape: true,
  async run(ctx) {
    const main = await ctx.replay();
    const rev = await ctx.replay("reversed", { reverse: true });
    const restart = await ctx.replay("restart", { restartAt: Number(process.env.E2E_RESTART_AT ?? 0.5) });
    const [a, b, r] = [await derivedHash(main.sql), await derivedHash(rev.sql), await derivedHash(restart.sql)];
    const entries = async (s: typeof main.sql) => JSON.stringify(await s`
      select i.seen_time, i.body->>'strategy_id' sid, i.body->>'mint' mint, i.body->>'size_sol' size from tape.events i
      join mind.strategies st on st.id = i.body->>'strategy_id'
      where i.topic = 'intent.created' and i.body->>'side' = 'buy' and st.family = 'pre_call' order by 1, 2, 3`);
    const [ea, eb] = [await entries(main.sql), await entries(rev.sql)];
    const l1 = await ctx.replay("leg", { liveLeg: true });
    const l2 = await ctx.replay("leg2", { liveLeg: true });
    const [c, d] = [await derivedHash(l1.sql), await derivedHash(l2.sql)];
    const live = async (sql: typeof l1.sql) => (await sql`select topic, count(*)::int n from tape.events where topic in ('order.created', 'order.submitted', 'order.filled', 'order.failed', 'position.changed', 'ledger.entry') group by 1 order by 1`).map((x) => `${x.topic}:${x.n}`).join(" ");
    const [lc] = await l1.sql`select count(*)::int n from tape.events where topic = 'order.filled'`;
    const short = (h: { sha256: string }) => h.sha256.slice(0, 16);
    return {
      checks: [
        { name: "derived something", pass: a.events > 0 && a.signals > 0, detail: `${a.events} events, ${a.signals} signals` },
        { name: "reversed consumer order gives the same derived hash", pass: a.sha256 === b.sha256, detail: `${short(a)} vs ${short(b)}` },
        { name: "pre-call entries do not depend on consumer order", pass: ea === eb, detail: `${JSON.parse(ea).length} vs ${JSON.parse(eb).length} entries` },
        { name: "a restart halfway gives the same derived hash", pass: a.sha256 === r.sha256, detail: `${short(a)} vs ${short(r)}` },
        { name: "the live leg fills orders on the mock chain", pass: lc!.n > 0, detail: await live(l1.sql) },
        { name: "live-leg replay is deterministic", pass: c.sha256 === d.sha256, detail: `${short(c)} vs ${short(d)}; ${await live(l2.sql)}` },
      ],
      metrics: { main: a, reversed: b, restart: r, leg: c, leg2: d },
    };
  },
};
