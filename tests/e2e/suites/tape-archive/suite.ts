// B6 archiver (docs/tasks/B6-archiver.md): a closed inputs_hot partition is exported, read back and verified, its
// offset gate is honoured, and only then dropped. The archive file reads through the replay driver's reader.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { configValues } from "../../../../services/core/src/lib/config.ts";
import { Archiver } from "../../../../services/core/src/tape/archiver.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import { readTape } from "../../lib/replay.ts";
import type { Suite } from "../../lib/suite.ts";

const SEVEN = Date.UTC(2026, 9, 19, 7, 5);
const NOON = Date.UTC(2026, 9, 19, 12, 10);

export const suite: Suite = {
  name: "tape-archive",
  tier: "fast",
  covers: ["services/core/src/tape/archiver.ts", "services/core/src/sql/schema.sql", "services/core/src/tape/tape.ts"],
  proves: "A closed inputs_hot partition is exported, read back and verified, recorded in tape.archived, blocked while a consumer lags, then dropped; the file replays.",
  async run() {
    const db = await freshDb("tapearchive");
    const clock = replayClock(SEVEN);
    const tape = new Tape(db.sql, clock);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tape-archive-"));
    const config = configValues();
    config.retention.archive_targets = [{ kind: "local", dir }];
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    try {
      const hotIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const e = tape.emit("trade.curve", {
          mint: `M${i}`, tx: `tx${i}`, slot_index_id: null, ts: clock.iso(), side: "buy", wallet: "W1", sol: 1, usd: null, tokens: 1, price_sol: 1, price_usd: null, mcap_usd: 1, on_curve: true, program: "pump", pool_sol: null,
        }, { source: "nats", subject: `M${i}` });
        hotIds.push(e.id);
      }
      tape.emit("coin.watched", {
        mint: "M1", reason: "heat", wallet: null, note: null, buyers_60s: 1, net_sol_60s: 1, trigger_tx: null, creator_record: null,
        features: { from_birth: true, age_s: 1, first_slot: 1, creator: null, trades: 1, buyers: 1, holders_est: 1, mcap_usd: 1, bundle_buys: 0, bundle_wallets: 0, bundle_share: 0, dev_buy_sol: 0, block0_sniper_share: 0, sniper_share: 0, top_buyer_share: 0, creator_sold: 0, smart_buyers: 0 },
      }, { source: "nats", subject: "M1" });
      tape.emit("index.refreshed", { version: 1, window_days: 30, wallets: 0, coins: 1, smart: [] }, { source: "analyzer", subject: "index:1" });
      await tape.flush();

      clock.advance!(NOON);
      const archiver = new Archiver(tape, db.sql, config, undefined, ["lagging", "fresh"]);
      const table = "tape.events_p_2026101907_inputs_hot";
      const exists = async () => (await db.sql`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'tape' and c.relname = ${table.split(".")[1]}`).length > 0;

      // a lagging consumer keeps the partition in place
      await db.sql`insert into tape.consumer_offsets (consumer, last_seen_time) values ('lagging', ${new Date(Date.UTC(2026, 9, 19, 7, 30)).toISOString()})`;
      const blocked = await archiver.runOnce();
      const [arch] = await db.sql`select rows, verified, sha256, file from tape.archived where partition = ${table}`;
      add("a closed inputs_hot partition is exported to a file, read back and verified", !!arch && arch.rows === 3 && arch.verified === true, `${arch?.rows} rows, verified ${arch?.verified}`);
      add("a lagging consumer blocks the drop", blocked.skipped.includes(table) && (await exists()), `${blocked.skipped.length} skipped`);

      // offsets past the partition: it drops
      await db.sql`update tape.consumer_offsets set last_seen_time = ${new Date(Date.UTC(2026, 9, 19, 8, 30)).toISOString()} where consumer = 'lagging'`;
      // a consumer the runtime runs but that has never written a bookmark still keeps the partition
      const unread = await archiver.runOnce();
      add("a consumer with no bookmark yet blocks the drop", unread.skipped.includes(table) && (await exists()), `${unread.skipped.length} skipped`);
      await db.sql`insert into tape.consumer_offsets (consumer, last_seen_time) values ('fresh', ${new Date(Date.UTC(2026, 9, 19, 8, 30)).toISOString()})`;
      const dropped = await archiver.runOnce();
      add("with the offsets past it the partition is dropped", dropped.dropped.includes(table) && !(await exists()), `${dropped.dropped.length} dropped`);

      const file = path.join(dir, arch!.file as string);
      const rows = await readTape(file);
      const ids = rows.map((r) => r.id);
      add("the last row of the partition is in the file", rows.length === 3 && ids.includes(hotIds.at(-1)!), `${rows.length} rows, last ${ids.at(-1) === hotIds.at(-1)}`);
      add("the archive file replays", rows.length === 3 && rows.every((r) => r.topic === "trade.curve") && rows.every((r) => r.class === "inputs_hot"), `${rows.length} trades, classes ${[...new Set(rows.map((r) => r.class))].join(",")}`);
      return { checks, metrics: { rows: rows.length, bytes: fs.statSync(file).size } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
