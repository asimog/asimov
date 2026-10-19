// The Scout's wallet set lives in idx.scout_wallet; memory holds only a bounded hot set (SCOUT_HOT_WALLETS). Feeding many more
// distinct wallets than the bound through the Scout's trade entry point never grows it past the bound, and a caller or smart wallet
// that fell out of memory (or a fresh process after a restart) is still recognised from the table.
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { LaunchFacts } from "../../../../services/core/src/senses/launch-facts.ts";
import { Scout } from "../../../../services/core/src/senses/scout.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const BOUND = 20;
const CALLER = "CaLLer1111111111111111111111111111111111111";
const SMART = "SmaRt11111111111111111111111111111111111111";
const mint = (i: number) => `M${String(i).padStart(8, "0")}1111111111111111111111111111111`;

export const suite: Suite = {
  name: "scout-bounded",
  tier: "fast",
  covers: ["services/core/src/senses/scout.ts"],
  proves:
    "The Scout keeps at most SCOUT_HOT_WALLETS wallets in memory however many distinct wallets trade, and a known caller or smart wallet that was evicted, or met after a restart, still promotes its coin from idx.scout_wallet.",
  async run() {
    const db = await freshDb("scoutbounded");
    const clock = replayClock(Date.UTC(2026, 9, 19, 12, 0, 0));
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const scouts: Scout[] = [];
    try {
      await db.sql`insert into mem.callers (wallet, first_seen) values (${CALLER}, now())`;
      for (let i = 0; i < 5; i++)
        await db.sql`insert into mem.callers (wallet, first_seen) values (${`Filler${i}`}, now())`;
      await db.sql`insert into idx.wallet (wallet, version, n, archetype, refreshed_at) values (${SMART}, 1, 9, 'smart', now())`;
      const promoted: string[] = [];
      const make = () => {
        const s = new Scout(
          tape,
          db.sql,
          () => false,
          (m) => promoted.push(m),
          BOUND,
          { facts: new LaunchFacts(null, false) }, // no RPC and no HTTP in this suite
        );
        scouts.push(s);
        return s;
      };
      const buy = (s: Scout, wallet: string, m: string, n: number) =>
        s.onTrade({
          mint: m,
          mintAddress: m,
          tx: `tx${n}`,
          userAddress: wallet,
          type: "buy",
          amountSol: "0.1",
          baseAmount: "1000000",
          priceSol: "0.00000003",
          timestamp: new Date(clock.now()).toISOString(),
        });

      const a = make();
      await a.refresh();
      add(
        "a refresh warms the hot set from the table, within the bound",
        a.hot.size > 0 && a.hot.size <= BOUND,
        `hot ${a.hot.size}`,
      );
      let max = 0;
      for (let i = 0; i < 200; i++) {
        buy(a, `Plain${i}`, mint(i), i);
        if (i % 10 === 9) await a.resolve();
        max = Math.max(max, a.hot.size);
      }
      await a.resolve();
      max = Math.max(max, a.hot.size);
      add(
        "200 distinct wallets never push the hot set past the bound",
        max <= BOUND,
        `max ${max}, bound ${BOUND}`,
      );
      add("a plain wallet promotes nothing", promoted.length === 0, `${promoted.length} promoted`);
      add("the caller was evicted from memory", !a.hot.has(CALLER));
      buy(a, CALLER, mint(1000), 1000);
      await a.resolve();
      add(
        "an evicted caller is recognised from the table",
        promoted.includes(mint(1000)) && a.stats.caller_buy === 1,
        JSON.stringify(a.stats),
      );

      const b = make();
      buy(b, SMART, mint(2000), 2000);
      await b.resolve();
      add(
        "after a restart a smart wallet is recognised from the table",
        promoted.includes(mint(2000)) && b.stats.smart_buy === 1,
        JSON.stringify(b.stats),
      );
      add("the restarted Scout is within the bound too", b.hot.size <= BOUND, `hot ${b.hot.size}`);
      const [row] = await db.sql`select count(*)::int n from idx.scout_wallet`;
      add("the table holds every caller and the smart wallet", row!.n === 7, `${row!.n} rows`);
      return { checks, metrics: { max_hot: max } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
