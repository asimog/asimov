// B4: the owner's follow_wallets list (docs/tasks/B4.md). A listed wallet's buy promotes its coin with reason follow,
// a list update applies through the `lists` notify without a restart, and a wallet with no Index trades shows no score.
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { configValues } from "../../../../services/core/src/lib/config.ts";
import { loadList } from "../../../../services/core/src/mind/owner.ts";
import { LaunchFacts } from "../../../../services/core/src/senses/launch-facts.ts";
import { Scout } from "../../../../services/core/src/senses/scout.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT = "J9aW6nFepXrKhCXnNQysx8onwrhtjNuzqzcQbtJspump";
const A = "AQYJbNRc5bePADUL1mm2befzdik6otQ5hLzT9ST5bVTY";
const B = "GwyGY4HZ5h7BgUkQZ3Gm7fwkYdGvCSFDPLHk1r1apTqX";
const CREATOR = "BxFt85rRxGTiG1cxqtmGRCKnLigxXARz5csDj1mZuYGQ";

export const suite: Suite = {
  name: "follow-wallets",
  tier: "fast",
  covers: ["services/core/src/senses/scout.ts", "services/core/src/cli/ctl.ts", "services/core/src/senses/feed-reader.ts"],
  proves: "A followed wallet's buy promotes its coin with reason follow; a list update applies without a restart; a wallet with no Index trades shows no score.",
  async run() {
    const db = await freshDb("followwallets");
    const tape = new Tape(db.sql, replayClock(Date.UTC(2026, 9, 19, 12)));
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const promoted: { mint: string; reason: string }[] = [];
    const config = configValues();
    config.filters.launch = { ...config.filters.launch, on_unknown: { ...config.filters.launch.on_unknown, follow: "pass" } };
    tape.onFlush((es) => { for (const e of es) if (e.topic === "coin.watched") promoted.push({ mint: e.subject!, reason: "follow" }); });
    const scout = new Scout(tape, db.sql, () => false, 100, {
      config, facts: new LaunchFacts(null, false), samplePct: 100,
    });
    try {
      await scout.refresh();
      void scout.watchLists();
      await db.sql`insert into idx.wallet (wallet, version, n, archetype, refreshed_at) values (${A}, 1, 9, 'sniper', now())`;

      const buy = (wallet: string, mint: string) =>
        scout.onTrade({
          mint, mintAddress: mint, tx: `tx-${wallet}`, userAddress: wallet, type: "buy", amountSol: "1", baseAmount: "1000",
          priceSol: "0.00000007", timestamp: new Date(tape.clock.now()).toISOString(),
        });

      await loadList(db.sql, tape, "t", "follow_wallets", A, "t");
      for (let i = 0; i < 40 && scout.hot.get(A) !== "follow"; i++) await new Promise((r) => setTimeout(r, 50));
      scout.onLaunch({ mint: MINT, creator: CREATOR, associated_bonding_curve: "curve", created_timestamp: Date.UTC(2026, 9, 19, 11, 59) });
      buy(A, MINT);
      await scout.resolve();
      await tape.flush();
      const [first] = await db.sql<{ body: { reason: string; wallet: string; note: string | null } }[]>`select body from tape.events where topic = 'coin.watched' order by seen_time desc limit 1`;
      add(
        "a followed wallet's buy promotes its coin with reason follow",
        scout.stats.follow === 1 && first?.body.reason === "follow" && first.body.wallet === A,
        `stats ${JSON.stringify(scout.stats)}, watched ${first?.body.reason ?? "none"}`,
      );
      add("a listed wallet the Index marks sniper keeps its role and gets a note", first?.body.note === "follow wallet is marked sniper", `${first?.body.note}`);

      await loadList(db.sql, tape, "t", "follow_wallets", `${A}\n${B}`, "t");
      for (let i = 0; i < 40 && scout.hot.get(B) !== "follow"; i++) await new Promise((r) => setTimeout(r, 50));
      buy(B, "GRdCoACDeT96j6fCRjkgiKR5grasLjph42WkXdbZpump");
      await scout.resolve();
      await tape.flush();
      const [second] = await db.sql<{ body: { reason: string; wallet: string } }[]>`select body from tape.events where topic = 'coin.watched' order by seen_time desc limit 1`;
      add(
        "a list update applies without a restart",
        scout.hot.get(B) === "follow" && scout.stats.follow === 2 && second?.body.wallet === B,
        `role ${scout.hot.get(B)}, promotions ${scout.stats.follow}`,
      );

      const [score] = await db.sql`select count(*)::int n from idx.wallet where wallet = ${B}`;
      const [role] = await db.sql`select role from idx.scout_wallet where wallet = ${B}`;
      add("an unproven wallet shows no score", score!.n === 0 && role?.role === "follow", `${score!.n} score rows, role ${role?.role}`);
      return { checks, metrics: { promoted: promoted.length } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
