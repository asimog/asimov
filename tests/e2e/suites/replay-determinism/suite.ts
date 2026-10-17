// Same tape, same code, same config, same seed: the derived events and signals hash the same twice.
import { derivedHash } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

export const suite: Suite = {
  name: "replay-determinism",
  proves: "Two replays of the same tape in two fresh databases derive byte-identical events and signals.",
  tape: true,
  async run(ctx) {
    const a = await derivedHash((await ctx.replay()).sql);
    const b = await derivedHash((await ctx.replay("again")).sql);
    return {
      checks: [
        { name: "derived hash equal", pass: a.sha256 === b.sha256, detail: `${a.sha256.slice(0, 16)} vs ${b.sha256.slice(0, 16)}` },
        { name: "derived something", pass: a.events > 0 && a.signals > 0, detail: `${a.events} events, ${a.signals} signals` },
      ],
      metrics: { first: a, second: b },
    };
  },
};
