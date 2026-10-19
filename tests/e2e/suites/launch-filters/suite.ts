// B3: the launch door (docs/PIPELINE.md section 2, docs/tasks/B3.md) on shapes recorded from pump.fun on 2026-10-19.
// Each fact is taken from NATS first, then the RPC pool, then pump.fun HTTP; an unknown is decided by config.
// A chain recheck that disagrees writes system.source_disagree and drops the coin.
import fs from "node:fs";
import path from "node:path";
import type { Trade } from "../../../../packages/contracts/src/index.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { type Config, configValues } from "../../../../services/core/src/lib/config.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import type { RpcPool } from "../../../../services/core/src/lib/rpc.ts";
import { LaunchFacts } from "../../../../services/core/src/senses/launch-facts.ts";
import { Scout } from "../../../../services/core/src/senses/scout.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const trades = JSON.parse(fs.readFileSync(path.join(env.root, "tests/e2e/fixtures/pump/trades-slice.json"), "utf8")).nats[0].messages.map((m: { data: Record<string, unknown> }) => m.data);
const SAMPLE = trades[0]!;
const MINTS = ["J9aW6nFepXrKhCXnNQysx8onwrhtjNuzqzcQbtJspump", "GRdCoACDeT96j6fCRjkgiKR5grasLjph42WkXdbZpump", "DTv7s3yLWxgNTFAFQzuhy9nwNAXwoa9GjmWPiN3epump", "FGkCj28xhabWTYg9QyzACvs4NsN6LUyesP6EwiHepump", "95sT2JNsVHMkCayh4CeLqFzvmRrc93vE1yNPDYKCpump"];
const CREATOR = "BxFt85rRxGTiG1cxqtmGRCKnLigxXARz5csDj1mZuYGQ";
const CALLER = "AQYJbNRc5bePADUL1mm2befzdik6otQ5hLzT9ST5bVTY";

/** A trade input in the recorded shape, with only the scenario fields changed. */
function tradeMsg(o: { mint: string; wallet: string; side?: "buy" | "sell"; sol: number; tokens: number; price: number; slot?: number; tx: string }): Record<string, unknown> {
  return {
    ...SAMPLE,
    mintAddress: o.mint,
    mint: o.mint,
    tx: o.tx,
    userAddress: o.wallet,
    type: o.side ?? "buy",
    amountSol: String(o.sol),
    baseAmount: String(o.tokens),
    priceSol: String(o.price),
    timestamp: new Date(Date.UTC(2026, 9, 19, 12)).toISOString(),
    slotIndexId: `${String(o.slot ?? 100).padStart(12, "0")}0000000000000000`,
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(s: string): Buffer {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 255n);
    n >>= 8n;
  }
  return out;
}

/** A pump TradeEvent log line for LaunchFacts' RPC path: the real decoder's layout, 113 bytes. */
function logLine(mint: string, wallet: string, lamports: number, isBuy: boolean, ts: number): string {
  const b = Buffer.alloc(113);
  Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]).copy(b, 0);
  base58(mint).copy(b, 8);
  b.writeBigUInt64LE(BigInt(lamports), 40);
  b.writeBigUInt64LE(1_000_000n, 48);
  b[56] = isBuy ? 1 : 0;
  base58(wallet).copy(b, 57);
  b.writeBigInt64LE(BigInt(ts), 89);
  b.writeBigUInt64LE(30_000_000_000n, 97);
  b.writeBigUInt64LE(1_073_000_000_000_000n, 105);
  return `Program data: ${b.toString("base64")}`;
}

function fakeRpc(): RpcPool {
  return {
    call: async (method: string) => {
      if (method === "getSignaturesForAddress") return [{ signature: "creation", slot: 100, err: null, blockTime: 1_792_400_000 }];
      return {
        meta: { feePayer: CREATOR, logMessages: [logLine(MINTS[0]!, CREATOR, 500_000_000, true, 1_792_400_000)] },
        transaction: { message: { accountKeys: [CREATOR] } },
      };
    },
  } as unknown as RpcPool;
}

function config(o: Partial<Config["filters"]["launch"]> = {}): Config {
  const c = configValues();
  c.filters.launch = { ...c.filters.launch, max_dev_buy_sol: 5, max_block0_sniper_share: 1, max_bundle_share: 1, on_unknown: { ...c.filters.launch.on_unknown }, ...o };
  return c;
}

type Env = { db: Awaited<ReturnType<typeof freshDb>>; tape: Tape; scout: Scout; promoted: string[]; demoted: string[] };

async function setup(tag: string, cfg: Config, facts: LaunchFacts): Promise<Env> {
  const db = await freshDb(tag);
  const tape = new Tape(db.sql, replayClock(Date.UTC(2026, 9, 19, 12)));
  await db.sql`insert into mem.callers (wallet, first_seen) values (${CALLER}, now())`;
  const promoted: string[] = [];
  const demoted: string[] = [];
  const scout = new Scout(tape, db.sql, () => false, (m) => promoted.push(m), 100, { config: cfg, facts, samplePct: 100, onDemote: (m) => demoted.push(m) });
  await scout.refresh();
  return { db, tape, scout, promoted, demoted };
}

async function close(e: Env) {
  await e.tape.close();
  await e.db.done();
}

export const suite: Suite = {
  name: "launch-filters",
  tier: "fast",
  covers: ["services/core/src/senses/scout.ts", "services/core/src/senses/filters.ts", "services/core/src/senses/launch-facts.ts"],
  proves: "A launch refused by the owner lists or by the configurable launch filters never reaches the watched set; NATS, the RPC pool and pump.fun HTTP answer in order; an unknown is decided by config; a disagreeing chain recheck writes source_disagree and drops the coin.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

    // 1. blocked creator
    {
      const e = await setup("launchblocked", config(), new LaunchFacts(null, false));
      try {
        await e.db.sql`insert into mind.lists (kind, version, items, set_by, set_at) values ('blocked_creators', 1, ${[CREATOR]}, 'admin', now())`;
        await e.scout.refresh();
        e.scout.onLaunch({ mint: MINTS[0], creator: CREATOR, associated_bonding_curve: "curve", created_timestamp: Date.UTC(2026, 9, 19, 11, 59) });
        e.scout.onTrade(tradeMsg({ mint: MINTS[0]!, wallet: CALLER, sol: 1, tokens: 1000, price: 7e-8, tx: "t1" }));
        await e.scout.resolve();
        await e.tape.flush();
        const [n] = await e.db.sql`select count(*)::int n from tape.events where topic = 'coin.watched'`;
        add("a blocked creator's coin is never watched", n!.n === 0 && e.promoted.length === 0 && e.scout.stats.launch_refused === 1, `${n!.n} watched, refused ${e.scout.stats.launch_refused}`);
      } finally {
        await close(e);
      }
    }

    // 2. bundle share over the config
    {
      const e = await setup("launchbundle", config({ max_bundle_share: 0.3 }), new LaunchFacts(null, false));
      try {
        e.scout.onLaunch({ mint: MINTS[1], creator: CREATOR, associated_bonding_curve: "curve", created_timestamp: Date.UTC(2026, 9, 19, 11, 59) });
        e.scout.onTrade(tradeMsg({ mint: MINTS[1]!, wallet: CALLER, sol: 35, tokens: 500_000_000, price: 7e-8, tx: "t2" }));
        await e.scout.resolve();
        await e.tape.flush();
        const [s] = await e.db.sql`select body from tape.events where topic = 'filter.sampled' and body->>'reason' = 'bundle' limit 1`;
        const [w] = await e.db.sql`select count(*)::int n from tape.events where topic = 'coin.watched'`;
        add("a launch over the bundle share is refused with reason bundled", w!.n === 0 && s != null && e.promoted.length === 0, `${w!.n} watched, sampled ${s ? "yes" : "no"}`);
      } finally {
        await close(e);
      }
    }

    // 3. NATS silent: the RPC pool answers
    {
      const facts = new LaunchFacts(fakeRpc(), false);
      const e = await setup("launchrpc", config(), facts);
      try {
        e.scout.onTrade(tradeMsg({ mint: MINTS[0]!, wallet: CALLER, sol: 1, tokens: 1000, price: 1e-6, tx: "t3" }));
        await e.scout.resolve();
        await e.tape.flush();
        const [w] = await e.db.sql<{ body: { features: { creator: string | null; dev_buy_sol: number | null } } }[]>`select body from tape.events where topic = 'coin.watched' limit 1`;
        add("with NATS silent the RPC pool answers", e.promoted.length === 1 && w?.body.features.creator === CREATOR && facts.stats.rpc === 1, `promoted ${e.promoted.length}, creator ${w?.body.features.creator}, rpc answers ${facts.stats.rpc}`);
      } finally {
        await close(e);
      }
    }

    // 4. every source down: the fact is unknown and on_unknown decides
    {
      const e = await setup("launchunknown", config({ on_unknown: { caller_buy: "refuse", smart_buy: "pass", follow: "pass", heat: "refuse", metrics: "refuse" } }), new LaunchFacts(null, false));
      try {
        e.scout.onTrade(tradeMsg({ mint: MINTS[0]!, wallet: CALLER, sol: 1, tokens: 1000, price: 1e-6, tx: "t4" }));
        await e.scout.resolve();
        await e.tape.flush();
        const [s] = await e.db.sql`select body from tape.events where topic = 'filter.sampled' and body->>'reason' like 'unknown_%' limit 1`;
        add(
          "with the pump.fun API resting and the RPC pool down the fact is unknown and on_unknown decides",
          e.promoted.length === 0 && e.scout.stats.launch_refused === 1 && (e.scout.stats.unknown.dev_buy ?? 0) === 1 && s != null,
          `promoted ${e.promoted.length}, unknown ${JSON.stringify(e.scout.stats.unknown)}, sampled ${s ? "yes" : "no"}`,
        );
      } finally {
        await close(e);
      }
    }

    // 5. the chain recheck disagrees and drops the coin
    {
      const e = await setup("launchrecheck", config({ max_dev_buy_sol: 5 }), new LaunchFacts(null, false));
      try {
        e.scout.onLaunch({ mint: MINTS[2], creator: CREATOR, associated_bonding_curve: "curve", created_timestamp: Date.UTC(2026, 9, 19, 11, 59) });
        e.scout.onTrade(tradeMsg({ mint: MINTS[2]!, wallet: CALLER, sol: 1, tokens: 1000, price: 7e-8, tx: "t5" }));
        await e.scout.resolve();
        const chain: Trade[] = [{
          mint: MINTS[2]!, tx: "rpc1", slot_index_id: "000000000100000000000000", ts: new Date(Date.UTC(2026, 9, 19, 12)).toISOString(), side: "buy" as const, wallet: CREATOR,
          sol: 100, usd: null, tokens: 1000, price_sol: 7e-8, price_usd: null, mcap_usd: null, on_curve: true, program: "pump", pool_sol: null,
        }];
        e.scout.recheck(MINTS[2]!, chain);
        await e.tape.flush();
        const [d] = await e.db.sql`select count(*)::int n from tape.events where topic = 'system.source_disagree'`;
        const [u] = await e.db.sql`select count(*)::int n from tape.events where topic = 'coin.unwatched'`;
        add(
          "a chain recheck that disagrees writes source_disagree and drops the coin",
          d!.n >= 1 && u!.n === 1 && e.demoted.includes(MINTS[2]!),
          `${d!.n} disagreements, ${u!.n} unwatched, demoted ${e.demoted.length}`,
        );
      } finally {
        await close(e);
      }
    }

    return { checks, metrics: { checks: checks.length } };
  },
};
