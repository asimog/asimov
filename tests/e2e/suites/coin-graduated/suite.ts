// coin.graduated (docs/SYSTEM.md coin lifecycle): replayed on the graduated fixture, the one called coin we saw trading on the
// curve gets exactly one, at its first AMM trade; coins first seen on the AMM (graduated before we watched) get none.
// The Index rollup, the one writer of idx.coin, marks a coin graduated from its AMM trades.
import path from "node:path";
import { Rollup } from "../../../../services/core/src/index/rollup.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const FIXTURE = path.join(import.meta.dirname, "..", "..", "fixtures", "tapes", "graduated-2m.ndjson.gz");
const CALLED = "24N8Fg6DFFGpoUcUmCD3VLeqdKjJ3sEvgWr12kLDpump"; // called 12:48:47, 278 curve trades, first AMM trade 12:49:55
const trade = (mint: string, tx: string, at: string, onCurve: boolean) => ({
  mint, tx, slot_index_id: null, ts: at, side: "buy" as const, wallet: "W0", sol: 0.1, usd: null, tokens: 1e6, price_sol: 4e-8, price_usd: null, mcap_usd: null, on_curve: onCurve, program: null,
});

export const suite: Suite = {
  name: "coin-graduated",
  tier: "slow",
  covers: ["services/core/src/analyzers/precall.ts", "services/core/src/index/rollup.ts"],
  proves: "On a recorded tape, the called coin that graduates gets exactly one coin.graduated at its first AMM trade, and every coin.graduated follows curve trades of that coin; the rollup marks AMM coins graduated in idx.coin.",
  async run(ctx) {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const r = await ctx.replay("grad", { tape: FIXTURE }); // the runner owns the database and drops it
    const rows = await r.sql`select subject, body, causes from tape.events where topic = 'coin.graduated' order by seen_time, id`;
    const mine = rows.filter((x) => x.subject === CALLED);
    const [first] = await r.sql`select id, body->>'tx' tx from tape.events where topic = 'trade.amm' and subject = ${CALLED} order by seen_time, id limit 1`;
    add("the called coin graduates exactly once, at its first AMM trade", mine.length === 1 && (mine[0]!.causes as string[])[0] === first?.id && (mine[0]!.body as { tx: string }).tx === first?.tx, `${mine.length} events`);
    const [bad] = await r.sql`select count(*)::int n from tape.events g where g.topic = 'coin.graduated'
      and not exists (select 1 from tape.events c where c.topic = 'trade.curve' and c.subject = g.subject and c.body->>'program' is not null and c.seen_time < g.seen_time)`;
    const [ammOnly] = await r.sql`select count(distinct subject)::int n from tape.events a where a.topic = 'trade.amm'
      and not exists (select 1 from tape.events c where c.topic = 'trade.curve' and c.subject = a.subject)`;
    add("no coin.graduated without curve trades before it, and the called coin is the only one", bad!.n === 0 && rows.length === 1, `${rows.length} graduations; ${ammOnly!.n} coins seen only on the AMM get none`);
    add("the replay ran under 60 s", r.ms < 60_000, `${r.ms} ms, ${r.steps} steps`);

    const db = await freshDb("coingrad");
    try {
      const t0 = Date.UTC(2026, 9, 18, 12, 0, 0);
      const iso = (min: number) => new Date(t0 + min * 60_000).toISOString();
      const rollup = new Rollup();
      rollup.trade(trade("GRAD", "c1", iso(0), true), t0);
      rollup.trade(trade("GRAD", "a1", iso(2), false), t0 + 2 * 60_000);
      rollup.trade(trade("CURVE", "c2", iso(3), true), t0 + 3 * 60_000);
      await rollup.flush(db.sql, t0 + 4 * 60_000);
      const g = Object.fromEntries((await db.sql`select mint, graduated from idx.coin`).map((x) => [x.mint as string, x.graduated as boolean]));
      add("idx.coin.graduated is true for the AMM coin and false for the curve-only coin", g.GRAD === true && g.CURVE === false, JSON.stringify(g));
    } finally {
      await db.done();
    }
    return { checks, metrics: { replay_ms: r.ms, steps: r.steps, inputs: r.inputs } };
  },
};
