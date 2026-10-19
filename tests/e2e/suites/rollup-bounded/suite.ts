// The rollup holds a map per wallet on every live coin, so full coins are what memory grows with. Mock trades over many more coins
// than INDEX_MAX_COINS never push the wallet maps past the cap, idx.coin still holds every trade, and a coin still owed a copy price
// is slimmed, not forgotten.
import { Rollup } from "../../../../services/core/src/index/rollup.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const CAP = 50;
const COINS = 400;
const WALLETS = 10;
const mint = (i: number) => `M${String(i).padStart(8, "0")}1111111111111111111111111111111`;
const trade = (m: string, wallet: string, n: number) => ({
  mint: m, tx: `tx${n}`, slot_index_id: null, ts: new Date(0).toISOString(), side: "buy" as const, wallet, sol: 0.1, usd: null, tokens: 1e6,
  price_sol: 4e-8, price_usd: null, mcap_usd: null, on_curve: true, program: null,
});

export const suite: Suite = {
  name: "rollup-bounded",
  tier: "fast",
  covers: ["services/core/src/index/rollup.ts"],
  proves: "The rollup keeps wallet maps for at most INDEX_MAX_COINS coins however many coins trade, touches only coins already written, and idx.coin still holds every trade.",
  async run() {
    const db = await freshDb("rollupbounded");
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    try {
      const r = new Rollup(CAP);
      let now = Date.UTC(2026, 9, 19, 12, 0, 0);
      let n = 0;
      let peak = 0;
      for (let i = 0; i < COINS; i++) {
        for (let w = 0; w < WALLETS; w++) r.trade(trade(mint(i), `W${w}`, n++), now + w);
        now += 1000;
        if (i % 20 === 19) {
          await r.flush(db.sql, now);
          peak = Math.max(peak, r.stats.coin_wallets);
        }
      }
      await r.flush(db.sql, now);
      const bound = (CAP + 20) * WALLETS * 2; // a coin has a balance and a bought entry per wallet; up to one flush interval of new coins
      add("wallet-map entries stay within the cap", peak <= bound, `peak ${peak}, now ${r.stats.coin_wallets}, bound ${bound}`);
      add("coins were evicted", r.stats.evicted >= COINS - CAP - 20, `${r.stats.evicted} evicted`);
      const [row] = await db.sql`select count(*)::int coins, sum(trades)::int trades from idx.coin`;
      add("idx.coin holds every coin and every trade", row!.coins === COINS && row!.trades === COINS * WALLETS, `${row!.coins} coins, ${row!.trades} trades`);

      const p = new Rollup(1);
      p.trade(trade(mint(9000), "A", n++), now); // owes a copy price and a mark
      p.trade(trade(mint(9001), "B", n++), now + 1);
      await p.flush(db.sql, now + 2);
      add("a coin owed a copy price is slimmed, not forgotten", p.stats.coins === 2 && p.stats.evicted === 1 && p.stats.coin_wallets === 2, `${p.stats.coins} coins, ${p.stats.coin_wallets} wallet entries`);
      return { checks, metrics: { peak_wallet_entries: peak, evicted: r.stats.evicted } };
    } finally {
      await db.done();
    }
  },
};
