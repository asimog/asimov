// C9 (docs/PIPELINE.md sections 3 and 4): Index features. Funder links read from a recorded RPC slice
// (tests/e2e/fixtures/rpc/funder-slice.json); a creator record from idx.coin; a mass deployer's coin refused by the gate
// with its reason, through risk.state; bundler and copier archetypes from synthetic Index rows. Fresh database.
import fs from "node:fs";
import path from "node:path";
import type { BodyOf } from "../../../../packages/contracts/src/index.ts";
import { indexSignals } from "../../../../services/core/src/analyzers/index-signals.ts";
import { creatorRecord } from "../../../../services/core/src/index/creators.ts";
import { funderIn, lookupFunder, type ParsedTx } from "../../../../services/core/src/index/funders.ts";
import { refresh } from "../../../../services/core/src/index/refresh.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import type { RpcPool } from "../../../../services/core/src/lib/rpc.ts";
import { defaultLimits, type GateRisk, riskGate } from "../../../../services/core/src/mind/risk.ts";
import { step } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

type Slice = { wallets: { wallet: string; signature_count: number; oldest: ParsedTx | null }[] };
const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const DEPLOYER = "DepLoyer111111111111111111111111111111111111";
const features: BodyOf<"coin.watched">["features"] = {
  from_birth: true, age_s: 30, first_slot: 100, creator: DEPLOYER, trades: 40, buyers: 20, holders_est: 20, mcap_usd: 9000, bundle_buys: 0, bundle_wallets: 0,
  bundle_share: 0, dev_buy_sol: 1, block0_sniper_share: 0, sniper_share: 0, top_buyer_share: 0.1, creator_sold: 0, smart_buyers: 0,
};

export const suite: Suite = {
  name: "index-features",
  tier: "fast",
  covers: ["services/core/src/index/funders.ts", "services/core/src/index/creators.ts", "services/core/src/index/refresh.ts", "services/core/src/analyzers/index-signals.ts", "services/core/src/mind/risk.ts"],
  proves: "C9: a fresh wallet's funder is read from its first transaction and a busy wallet's is left unknown; a creator's 7-day launches and rug rate come from idx.coin; a mass deployer's coin is refused with mass_deployer; bundler and copier archetypes are labelled.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const slice = JSON.parse(fs.readFileSync(path.join(env.root, "tests/e2e/fixtures/rpc/funder-slice.json"), "utf8")) as Slice;

    // ---- funder links on the real slice, through a pool that answers from it
    const pool = {
      async call(method: string, params: unknown[]) {
        const w = slice.wallets.find((x) => x.wallet === params[0])!;
        if (method === "getSignaturesForAddress") return Array.from({ length: w.signature_count }, (_, i) => ({ signature: `${w.wallet}:${i}` }));
        return slice.wallets.find((x) => (params[0] as string).startsWith(`${x.wallet}:`))!.oldest;
      },
    } as unknown as RpcPool;
    const found = await Promise.all(slice.wallets.map(async (w) => ({ w, r: await lookupFunder(pool, w.wallet) })));
    const fresh = found.filter((x) => x.w.signature_count < 1000);
    const busy = found.filter((x) => x.w.signature_count >= 1000);
    add("a fresh wallet's funder is the source of its first SOL transfer", fresh.length > 0 && fresh.every((x) => x.r.funder !== null && x.r.funder === funderIn(x.w.oldest, x.w.wallet)), fresh.map((x) => `${x.w.wallet.slice(0, 6)} <- ${x.r.funder?.slice(0, 6)}`).join(", "));
    add("a busy wallet's funder stays unknown", busy.length > 0 && busy.every((x) => x.r.funder === null), `${busy.length} wallets with a full page`);

    const db = await freshDb("indexfeatures");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    const iso = (ms: number) => new Date(ms).toISOString();
    try {
      // ---- creator record: 12 launches this week, 4 past coins, 3 of them rugs
      for (let i = 0; i < 12; i++) {
        const at = t0 - (i + 1) * 3 * 3_600_000;
        const rug = i < 3;
        await db.sql`insert into idx.coin (mint, first_seen_at, creator, last_price, peak_price, last_at, graduated) values (${`Coin${i}`}, ${iso(at)}, ${DEPLOYER}, ${rug ? 1 : 9}, 10, ${iso(at)}, false)`;
      }
      await db.sql`insert into idx.coin (mint, first_seen_at, creator, last_price, peak_price, last_at) values ('OldCoin', ${iso(t0 - 10 * 86_400_000)}, ${DEPLOYER}, 9, 10, ${iso(t0)})`;
      const rec = await creatorRecord(db.sql, DEPLOYER, t0, [["Unflushed", t0 - 60_000]]);
      add("the creator record counts 7-day launches, past coins and rugs", rec.launches_7d === 13 && rec.past === 13 && rec.rugs === 3, JSON.stringify(rec));

      // ---- the record rides coin.watched into risk.state; the gate refuses the mass deployer with its reason
      clock.advance!(t0);
      tape.emit("coin.watched", { mint: MINT, reason: "metrics", wallet: null, note: null, buyers_60s: 20, net_sol_60s: 5, trigger_tx: null, features, creator_record: rec }, { source: "nats", subject: MINT });
      await tape.flush();
      const sig = indexSignals(clock);
      while (await step(db.sql, sig)) { /* drain */ }
      const [rs] = await db.sql`select value from board.signals where kind = 'risk.state' and subject = ${MINT} order by produced_at desc limit 1`;
      const risk = rs?.value as GateRisk & { creator_rug_rate: number | null } | undefined;
      add("risk.state carries the creator's launches and rug rate", risk?.creator_launches_7d === 13 && Math.abs((risk?.creator_rug_rate ?? 0) - 3 / 13) < 1e-9, JSON.stringify({ l: risk?.creator_launches_7d, r: risk?.creator_rug_rate }));
      const g = riskGate({ id: "i", mint: MINT, side: "buy", size_sol: 0.005, duplicate: false }, { equity_sol: 0.2, open_cost_sol: 0, open_coins: new Set(), position_sol: new Map(), realized_today_sol: 0 }, defaultLimits(),
        { at_ms: t0, impact_bps: 20, real_sol: 8, graduated: false, risk: risk ?? null }, { kill: "running", mode_ok: true, strategy_live: true }, t0);
      add("a mass deployer is refused with its reason", !g.ok && g.reason_code === "mass_deployer", g.ok ? "passed" : `${g.reason_code}: ${g.detail}`);

      // ---- archetypes: two early buyers with one funder on two coins are bundlers; a wallet that follows a smart wallet is a copier
      await db.sql`insert into idx.wallet (wallet, version, n, archetype, refreshed_at) values ('Smart1', 1, 10, 'smart', ${iso(t0)})`;
      const row = async (wallet: string, mint: string, at: number, early: boolean, mult = 1.05) =>
        db.sql`insert into idx.wallet_coin (wallet, mint, buys, sol_in, sol_out, tok_in, tok_out, first_buy_at, first_buy_price, copy_price, peak_after, mark_price, last_at, early_slot)
          values (${wallet}, ${mint}, 1, 0.1, 0, 1000, 0, ${iso(at)}, 1e-7, 1e-7, 1e-7, ${1e-7 * mult}, ${iso(at)}, ${early})`;
      for (let i = 0; i < 10; i++) {
        const mint = `Arch${i}`;
        const at = t0 - 3 * 3_600_000 + i * 600_000;
        await db.sql`insert into idx.coin (mint, first_seen_at, last_price, peak_price, last_at) values (${mint}, ${iso(at)}, 1e-7, 1e-7, ${iso(at)})`;
        await row("Smart1", mint, at, false);
        await row("Copier1", mint, at + 10_000, false, 0.97);
        if (i < 2) for (const b of ["Bundler1", "Bundler2"]) await row(b, mint, at - 1000, true);
      }
      await db.sql`insert into idx.funder (wallet, funder, at) values ('Bundler1', 'Funder1', ${iso(t0)}), ('Bundler2', 'Funder1', ${iso(t0)})`;
      await refresh(db.sql, tape);
      const labels = Object.fromEntries((await db.sql`select wallet, archetype from idx.wallet`).map((r) => [r.wallet, r.archetype]));
      add("early buyers sharing a funder on two coins are bundlers", labels.Bundler1 === "bundler" && labels.Bundler2 === "bundler", JSON.stringify(labels));
      add("a wallet buying 10 s after a smart wallet on every coin is a copier", labels.Copier1 === "copier", `Copier1: ${labels.Copier1}`);
    } finally {
      await tape.close();
      await db.done();
    }
    return { checks, metrics: {} };
  },
};
