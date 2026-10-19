// B5: Backfill reads our rollups first and asks RPC only for the gap; getTransaction fans out over every healthy
// provider in parallel and falls back when one refuses. The trade shape is the recorded pump.fun slice.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import { type EndpointSpec, RpcPool } from "../../../../services/core/src/lib/rpc.ts";
import { Backfill } from "../../../../services/core/src/senses/backfill.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const TRADES = JSON.parse(fs.readFileSync(path.join(env.root, "tests/e2e/fixtures/pump/trades-slice.json"), "utf8")).nats[0].messages.map((m: { data: Record<string, unknown> }) => m.data);
const SAMPLE = TRADES[0]!;
const MINT = SAMPLE.mintAddress as string;
const USER = SAMPLE.userAddress as string;
const OTHER = "GRdCoACDeT96j6fCRjkgiKR5grasLjph42WkXdbZpump";

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

/** The recorded trade as a pump TradeEvent log line: the decoder's real 113-byte layout. */
function logLine(mint: string, wallet: string, lamports: number, ts: number): string {
  const b = Buffer.alloc(113);
  Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]).copy(b, 0);
  base58(mint).copy(b, 8);
  b.writeBigUInt64LE(BigInt(lamports), 40);
  b.writeBigUInt64LE(1_000_000n, 48);
  b[56] = 1;
  base58(wallet).copy(b, 57);
  b.writeBigInt64LE(BigInt(ts), 89);
  b.writeBigUInt64LE(30_000_000_000n, 97);
  b.writeBigUInt64LE(1_073_000_000_000_000n, 105);
  return `Program data: ${b.toString("base64")}`;
}

function fakePool(sigs: { signature: string; slot: number; err: unknown; blockTime: number | null }[]) {
  const out = { sigCalls: 0, txCalls: 0, fanBatches: 0 };
  const pool = {
    call: async (method: string) => {
      if (method === "getSignaturesForAddress") {
        out.sigCalls++;
        return sigs;
      }
      out.txCalls++;
      return { meta: { logMessages: [logLine(MINT, USER, 1_000_000_000, 1_792_400_000)] } };
    },
    fanOut: async (method: string, list: unknown[][]) => {
      out.fanBatches++;
      return Promise.all(list.map(() => pool.call(method)));
    },
  };
  return { pool: pool as unknown as RpcPool, out };
}

async function jsonServer(answer: (method: string) => unknown, status = 200) {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as { id: number; method: string };
      seen.push(body.method);
      if (status !== 200) {
        res.statusCode = status;
        res.end("busy");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: answer(body.method) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen };
}

export const suite: Suite = {
  name: "backfill-rollup",
  tier: "fast",
  covers: ["services/core/src/senses/backfill.ts", "services/core/src/lib/rpc.ts"],
  proves: "A coin already in our rollups costs fewer RPC calls than a fresh one, and getTransaction calls spread across every healthy provider with fallback when one refuses.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

    // 1. rollup coverage
    {
      const db = await freshDb("backfillrollup");
      try {
        const clock = replayClock(Date.UTC(2026, 9, 19, 12));
        const sigs = [
          { signature: "s1", slot: 100, err: null, blockTime: 1_792_400_001 },
          { signature: "s2", slot: 101, err: null, blockTime: 1_792_400_002 },
          { signature: "s3", slot: 102, err: null, blockTime: 1_792_400_003 },
        ];
        const fresh = fakePool(sigs);
        const tape = new Tape(db.sql, clock);
        const backfill = new Backfill(tape, db.sql, fresh.pool);
        await backfill.fill(MINT);
        await tape.flush();
        const freshCalls = fresh.out.txCalls;

        await db.sql`insert into idx.coin (mint, first_seen_at, last_at, trades) values (${OTHER}, ${new Date(1_792_400_000_000).toISOString()}, ${new Date(1_792_400_003_000).toISOString()}, 9)`;
        const rolled = fakePool(sigs);
        const b2 = new Backfill(tape, db.sql, rolled.pool);
        await b2.fill(OTHER);
        await tape.flush();
        add(
          "a coin already in our rollups costs fewer RPC calls than a fresh one",
          freshCalls === 3 && rolled.out.txCalls === 0,
          `fresh ${freshCalls}, rolled up ${rolled.out.txCalls}`,
        );
        await tape.close();
      } finally {
        await db.done();
      }
    }

    // 2. three providers, one refuses: calls spread and the refused calls fall back
    {
      const answer = (method: string) =>
        method === "getTransaction" ? { meta: { logMessages: [logLine(MINT, USER, 1_000_000_000, 1_792_400_000)] } } : [];
      const a = await jsonServer(answer);
      const b = await jsonServer(answer, 429);
      const c = await jsonServer(answer);
      try {
        const specs: EndpointSpec[] = [
          { name: "a", url: a.url, rps: 1000, budget: 1_000_000 },
          { name: "b", url: b.url, rps: 1000, budget: 1_000_000 },
          { name: "c", url: c.url, rps: 1000, budget: 1_000_000 },
        ];
        const pool = new RpcPool({ endpoints: specs, usageFile: null, maxTries: 6 });
        const out = await pool.fanOut("getTransaction", Array.from({ length: 9 }, (_, i) => [`sig${i}`, {}]));
        add(
          "getTransaction calls spread across every healthy provider",
          out.length === 9 && out.every((x) => x != null) && a.seen.length >= 3 && c.seen.length >= 3 && b.seen.length >= 1,
          `a ${a.seen.length}, b(refused) ${b.seen.length}, c ${c.seen.length}, results ${out.filter(Boolean).length}`,
        );
        add(
          "a refused provider falls back instead of failing the call",
          out.every((x) => x != null) && a.seen.length + c.seen.length >= 9,
          `${a.seen.length + c.seen.length} served, ${b.seen.length} refused`,
        );
      } finally {
        a.server.close();
        b.server.close();
        c.server.close();
      }
    }

    return { checks, metrics: { checks: checks.length } };
  },
};
