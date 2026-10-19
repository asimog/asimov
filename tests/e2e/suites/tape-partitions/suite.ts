// B6 partitions: the Tape is one hour, then one list partition per class; a clock rolled forward creates the next
// hour before it writes; no row can be edited or deleted (docs/tasks/B6-partitions.md).
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const at = (h: number, m = 0) => Date.UTC(2026, 9, 19, h, m);

export const suite: Suite = {
  name: "tape-partitions",
  tier: "fast",
  covers: ["services/core/src/sql/schema.sql", "services/core/src/tape/tape.ts"],
  proves: "Rows land in the hour and class partition their topic names, a clock rolled forward creates the next hour before it writes, and UPDATE or DELETE on the Tape is refused.",
  async run() {
    const db = await freshDb("tapepartitions");
    const clock = replayClock(at(12, 10));
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const count = async (table: string) => {
      const [r] = await db.sql.unsafe(`select count(*)::int n from ${table}`);
      return (r as unknown as { n: number }).n;
    };
    try {
      tape.emit("callout.created", {
        callout_id: "c1", mint: "M1", symbol: null, name: null, author_wallet: "W1", author_user_id: null, author_handle: null, author_x: null,
        author_followers: null, author_total_callouts: null, text: "", media_url: null, mcap_at_call_usd: null, price_at_call_usd: null,
        created_at: clock.iso(), chain: "solana", quoted_callout_id: null, author_position: { amount_held: null, cost_basis_usd: null, pnl_usd: null }, via: "poll",
      }, { source: "feedreader", subject: "c1" });
      tape.emit("coin.watched", {
        mint: "M1", reason: "heat", wallet: null, note: null, buyers_60s: 10, net_sol_60s: 2, trigger_tx: null, creator_record: null,
        features: { from_birth: true, age_s: 1, first_slot: 1, creator: null, trades: 1, buyers: 1, holders_est: 1, mcap_usd: 1, bundle_buys: 0, bundle_wallets: 0, bundle_share: 0, dev_buy_sol: 0, block0_sniper_share: 0, sniper_share: 0, top_buyer_share: 0, creator_sold: 0, smart_buyers: 0 },
      }, { source: "nats", subject: "M1" });
      tape.emit("index.refreshed", { version: 1, window_days: 30, wallets: 0, coins: 1, smart: [] }, { source: "analyzer", subject: "index:1" });
      await tape.flush();

      const hour12 = "tape.events_p_2026101912";
      const hot = await count(`${hour12}_inputs_hot`);
      const kept = await count(`${hour12}_inputs_kept`);
      const derived = await count(`${hour12}_derived`);
      add("rows land in the hour and class partition their topic names", hot === 1 && kept === 1 && derived === 1, `hot ${hot}, kept ${kept}, derived ${derived}`);

      const [ahead] = await db.sql`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'tape' and c.relkind = 'r' and c.relname like 'events\\_p\\_2026101914%'`;
      add("the next two hours are created ahead of the Clock", ahead!.n >= 3, `${ahead!.n} class partitions for 14:00`);

      clock.advance!(at(13, 5));
      tape.emit("callout.created", {
        callout_id: "c2", mint: "M2", symbol: null, name: null, author_wallet: "W1", author_user_id: null, author_handle: null, author_x: null,
        author_followers: null, author_total_callouts: null, text: "", media_url: null, mcap_at_call_usd: null, price_at_call_usd: null,
        created_at: clock.iso(), chain: "solana", quoted_callout_id: null, author_position: { amount_held: null, cost_basis_usd: null, pnl_usd: null }, via: "poll",
      }, { source: "feedreader", subject: "c2" });
      await tape.flush();
      const next = await count("tape.events_p_2026101913_inputs_hot");
      add("a clock rolled forward creates the next hour's partition before it writes", next === 1, `${next} row in 13:00`);

      // one batch across an hour nobody created yet: 16:59 and 17:01, flushed together
      const call = (id: string) => tape.emit("callout.created", {
        callout_id: id, mint: "M3", symbol: null, name: null, author_wallet: "W1", author_user_id: null, author_handle: null, author_x: null,
        author_followers: null, author_total_callouts: null, text: "", media_url: null, mcap_at_call_usd: null, price_at_call_usd: null,
        created_at: clock.iso(), chain: "solana", quoted_callout_id: null, author_position: { amount_held: null, cost_basis_usd: null, pnl_usd: null }, via: "poll",
      }, { source: "feedreader", subject: id });
      clock.advance!(at(16, 59));
      call("c3");
      clock.advance!(at(17, 1));
      call("c4");
      await tape.flush();
      const h16 = await count("tape.events_p_2026101916_inputs_hot");
      const h17 = await count("tape.events_p_2026101917_inputs_hot");
      const stray = await count("tape.events_default");
      add("a batch across an hour boundary lands in both hour partitions, never the default", h16 === 1 && h17 === 1 && stray === 0, `16:00 ${h16}, 17:00 ${h17}, default ${stray}`);

      let updateRefused = false;
      try {
        await db.sql`update tape.events set topic = 'x'`;
      } catch {
        updateRefused = true;
      }
      let deleteRefused = false;
      try {
        await db.sql`delete from tape.events`;
      } catch {
        deleteRefused = true;
      }
      const total = await count("tape.events");
      add("UPDATE and DELETE on the Tape are refused", updateRefused && deleteRefused && total === 6, `update ${updateRefused}, delete ${deleteRefused}, ${total} rows`);
      return { checks, metrics: { partitions: 2 } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
