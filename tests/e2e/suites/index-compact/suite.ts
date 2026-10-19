// B7: hourly rollups move into wallet x coin and wallet x day after 48 h; scores read the union, so they do not
// change; leaderboards are versioned and still answer after the raw rollup rows are gone.

import { buildLeaderboards, compact } from "../../../../services/core/src/index/compact.ts";
import { refresh } from "../../../../services/core/src/index/refresh.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const NOW = Date.UTC(2026, 9, 19, 12);
const DAY = 86_400_000;
const WALLETS = ["W1", "W2", "W3"];
const EXTRA = "W4"; // only has compacted rows: its leaderboard row must still answer

export const suite: Suite = {
  name: "index-compact",
  tier: "fast",
  covers: ["services/core/src/index/compact.ts", "services/core/src/index/refresh.ts", "services/core/src/sql/schema.sql"],
  proves: "A score for one window is equal before and after compaction, and every leaderboard answers from the rollups after the raw rows are gone.",
  async run() {
    const db = await freshDb("indexcompact");
    const clock = replayClock(NOW);
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const iso = (ms: number) => new Date(ms).toISOString();
    try {
      let n = 0;
      for (const wallet of [...WALLETS, EXTRA]) {
        const days = wallet === EXTRA ? 2 : 3;
        for (let d = 0; d < days; d++) {
          const mint = `M${n++}`;
          // W1-3: 4, 3 and 2 days old (the last is the 48 h edge); W4 has only 5 and 4 day old rows
          const at = NOW - ((wallet === EXTRA ? 4 : days) + 1 - d) * DAY;
          await db.sql`insert into idx.coin (mint, first_seen_at, creator, last_price, last_at, trades, graduated)
            values (${mint}, ${iso(at - 60_000)}, ${"Creator"}, 2e-7, ${iso(at)}, 10, ${d === 0})`;
          await db.sql`insert into idx.wallet_coin (wallet, mint, buys, sells, sol_in, sol_out, tok_in, tok_out, first_buy_at, first_buy_price, copy_price, peak_after, mark_price, last_at, early_slot)
            values (${wallet}, ${mint}, 2, 0, 0.1, 0, 1000, 0, ${iso(at - 60_000)}, 1e-7, ${wallet === "W1" ? 1e-6 : 1e-7}, 3e-7, 2e-7, ${iso(at)}, false)`;
        }
      }
      await db.sql`insert into mem.callers (wallet, first_seen) values ('W1', ${iso(NOW - 10 * DAY)})`;
      await db.sql`insert into mem.callouts (callout_id, mint, wallet, text, created_at, seen_at, first_on_coin, likes, replies, reposts, quotes, views, multiple)
        values ('K1', 'M0', 'W1', 'call', ${iso(NOW - 2 * DAY)}, ${iso(NOW - 2 * DAY)}, true, 10, 2, 1, 0, 100, 3)`;

      await refresh(db.sql, tape);
      await tape.flush();
      const before = Object.fromEntries((await db.sql`select wallet, n, copy_net, copy_win_lcb, early_right from idx.wallet order by wallet`).map((r) => [r.wallet, r]));

      const moved = await compact(db.sql, iso(NOW), 48);
      const [hot] = await db.sql`select count(*)::int n from idx.wallet_coin`;
      const [all] = await db.sql`select count(*)::int n from idx.wallet_coin_all`;
      const [days] = await db.sql`select count(*)::int n from idx.wallet_day`;
      add("hourly rollups older than 48 h move to wallet x coin and wallet x day", moved.moved === 8 && hot!.n === 3 && all!.n === 8 && days!.n === 8, `${moved.moved} moved; hot ${hot!.n}, all ${all!.n}, days ${days!.n}`);

      await refresh(db.sql, tape);
      await tape.flush();
      const after = Object.fromEntries((await db.sql`select wallet, n, copy_net, copy_win_lcb, early_right from idx.wallet order by wallet`).map((r) => [r.wallet, r]));
      const equal = Object.keys(before).length === Object.keys(after).length && Object.keys(before).every((w) => {
        const a = before[w]! as Record<string, unknown>;
        const b = after[w]! as Record<string, unknown>;
        return a.n === b.n && Math.abs((a.copy_net as number) - (b.copy_net as number)) < 1e-12 && Math.abs((a.copy_win_lcb as number) - (b.copy_win_lcb as number)) < 1e-12 && a.early_right === b.early_right;
      });
      add("scores equal before and after compaction", equal, `${Object.keys(before).length} wallets`);

      // a new trade on a coin that was already compacted: the pair is still one sample, not two
      await db.sql`insert into idx.wallet_coin (wallet, mint, buys, sells, sol_in, sol_out, tok_in, tok_out, first_buy_at, first_buy_price, copy_price, peak_after, mark_price, last_at, early_slot)
        values ('W1', 'M0', 1, 0, 0.05, 0, 500, 0, ${iso(NOW - 3_600_000)}, 2e-7, 2e-7, 2e-7, 2e-7, ${iso(NOW - 3_600_000)}, false)`;
      await refresh(db.sql, tape);
      await tape.flush();
      const [w1] = await db.sql`select n from idx.wallet where wallet = 'W1' and version = (select max(version) from idx.wallet)`;
      const nBefore = (before.W1 as Record<string, unknown>).n;
      add("a trade after compaction does not count its coin twice", w1!.n === nBefore, `W1 n ${w1!.n}, before ${String(nBefore)}`);

      const built = await buildLeaderboards(db.sql, iso(NOW));
      const kinds = new Set((await db.sql`select distinct kind from idx.leaderboard where version = ${built.version}`).map((r) => r.kind as string));
      const [w4] = await db.sql`select count(*)::int n from idx.leaderboard l where l.kind = 'wallets' and l.subject = ${EXTRA} and l.version = ${built.version}`;
      const [rawW4] = await db.sql`select count(*)::int n from idx.wallet_coin where wallet = ${EXTRA}`;
      add(
        "leaderboards answer after the raw partition is dropped",
        kinds.has("wallets") && kinds.has("traders") && kinds.has("callers") && kinds.has("callouts") && kinds.has("creators") && w4!.n === 1 && rawW4!.n === 0,
        `kinds ${[...kinds].sort().join(",")}; W4 on board ${w4!.n}, raw rows ${rawW4!.n}`,
      );

      // the traders board counts the last 48 h too: W1's net is its compacted days plus its hourly rows
      const [want] = await db.sql`select (select coalesce(sum(sol_out - sol_in), 0) from idx.wallet_day where wallet = 'W1')
        + (select coalesce(sum(sol_out - sol_in), 0) from idx.wallet_coin where wallet = 'W1') net,
        (select count(*)::int from idx.wallet_coin where wallet = 'W1') hot`;
      const [got] = await db.sql`select score from idx.leaderboard where kind = 'traders' and subject = 'W1' and version = ${built.version}`;
      add("the traders board includes the hourly rows not yet compacted", want!.hot > 0 && !!got && Math.abs((got.score as number) - (want!.net as number)) < 1e-12, `W1 board ${got?.score}, expected ${want!.net}, hourly rows ${want!.hot}`);

      const v1 = built.version;
      await buildLeaderboards(db.sql, iso(NOW + 1000), { newVersion: true });
      const [versions] = await db.sql`select count(distinct version)::int n from idx.leaderboard`;
      const [oldStill] = await db.sql`select count(*)::int n from idx.leaderboard where version = ${v1}`;
      add("weekly versions are kept", versions!.n === 2 && oldStill!.n > 0, `${versions!.n} versions, old rows ${oldStill!.n}`);
      return { checks, metrics: { moved: moved.moved, wallets: Object.keys(before).length } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
