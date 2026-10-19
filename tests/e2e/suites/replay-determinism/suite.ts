// Same tape, same code, same config, same seed: the derived events and signals hash the same twice.
import { derivedHash } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "replay-determinism",
  proves: "Two replays of the same tape in two fresh databases derive byte-identical events and signals, also with the live leg (gate, Trader, books, kill on the mock chain) trading beside the paper desk.",
  tape: true,
  async run(ctx) {
    const a = await derivedHash((await ctx.replay()).sql);
    const b = await derivedHash((await ctx.replay("again")).sql);
    const l1 = await ctx.replay("leg", { liveLeg: true });
    const l2 = await ctx.replay("leg2", { liveLeg: true });
    const [c, d] = [await derivedHash(l1.sql), await derivedHash(l2.sql)];
    const live = async (sql: typeof l1.sql) => (await sql`select topic, count(*)::int n from tape.events where topic in ('order.created', 'order.submitted', 'order.filled', 'order.failed', 'position.changed', 'ledger.entry') group by 1 order by 1`).map((r) => `${r.topic}:${r.n}`).join(" ");
    const [lc] = await l1.sql`select count(*)::int n from tape.events where topic = 'order.filled'`;
    return {
      checks: [
        { name: "derived hash equal", pass: a.sha256 === b.sha256, detail: `${a.sha256.slice(0, 16)} vs ${b.sha256.slice(0, 16)}` },
        { name: "derived something", pass: a.events > 0 && a.signals > 0, detail: `${a.events} events, ${a.signals} signals` },
        { name: "the live leg fills orders on the mock chain", pass: lc!.n > 0, detail: await live(l1.sql) },
        { name: "live-leg replay is deterministic", pass: c.sha256 === d.sha256, detail: `${c.sha256.slice(0, 16)} vs ${d.sha256.slice(0, 16)}; ${await live(l2.sql)}` },
      ],
      metrics: { first: a, second: b, leg: c, leg2: d },
    };
  },
};
