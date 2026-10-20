// The relay serves strangers. A viewer that stops reading must not freeze the others, and a malformed board time is a 400.
// A real relay process on a fresh database; one SSE viewer is paused at the socket while another reads every line.
import { spawn } from "node:child_process";
import http from "node:http";
import { liveClock } from "../../../../services/core/src/lib/clock.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const ROUNDS = 25;
const PER_ROUND = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const suite: Suite = {
  name: "relay-bounds",
  tier: "fast",
  covers: ["services/relay/src/main.ts"],
  proves: "With one SSE viewer paused at the socket, another viewer still receives every trade line; the stalled viewer is dropped; a non-numeric board time is refused with 400.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const db = await freshDb("relaybounds");
    const port = 7700 + Math.floor(Math.random() * 200);
    const base = `http://127.0.0.1:${port}`;
    const relay = spawn(process.execPath, ["--import", "tsx", "services/relay/src/main.ts"], { cwd: env.root, env: { ...process.env, DATABASE_URL: db.url, RELAY_PORT: String(port), AGENTS_DATABASE_URL: "" }, stdio: "ignore" });
    const tape = new Tape(db.sql, liveClock("live"));
    const reqs: http.ClientRequest[] = [];
    try {
      await tape.ensurePartitions();
      for (let i = 0; i < 100; i++) {
        if (await fetch(`${base}/health`).then((r) => r.ok, () => false)) break;
        await sleep(200);
      }
      let stalledBytes = 0;
      reqs.push(http.get(`${base}/v1/stream`, (res) => {
        res.once("data", (c: Buffer) => (stalledBytes += c.length));
        res.pause(); // reads the hello, then never again
      }));
      const seen = new Set<string>();
      let tail = "";
      reqs.push(http.get(`${base}/v1/stream`, (res) => res.on("data", (c: Buffer) => {
        const s = tail + c.toString("utf8");
        for (const m of s.matchAll(/"id":"(ev_[^"]+)","t":\d+,"topic":"trade\.curve"/g)) seen.add(m[1]!);
        tail = s.slice(-200);
      })));
      await sleep(1000);
      const both = (await (await fetch(`${base}/health`)).json()) as { viewers: number };
      add("both viewers connected", both.viewers === 2, `${both.viewers} viewers`);

      let n = 0;
      for (let r = 0; r < ROUNDS; r++) {
        for (let i = 0; i < PER_ROUND; i++)
          tape.emit("trade.curve", { mint: MINT, tx: `t${n++}`, slot_index_id: null, ts: new Date().toISOString(), side: "buy", wallet: `W${"x".repeat(40)}${i}`, sol: 0.001, usd: null, tokens: 1, price_sol: 1e-7, price_usd: null, mcap_usd: null, on_curve: true, program: null, pool_sol: null }, { source: "nats", subject: MINT });
        await tape.flush();
      }
      const want = ROUNDS * PER_ROUND;
      for (let i = 0; i < 150 && seen.size < want; i++) await sleep(200);
      const got = seen.size;
      add("the reading viewer receives every line while the other is stalled", got === want, `${got} of ${want} lines`);
      const after = (await (await fetch(`${base}/health`)).json()) as { viewers: number };
      add("the stalled viewer is dropped, the reader stays", after.viewers === 1, `${after.viewers} viewers, stalled read ${stalledBytes} bytes`);

      const bad = await fetch(`${base}/v1/board?at=abc`);
      add("a non-numeric board time is refused", bad.status === 400, `status ${bad.status}`);
      const good = await fetch(`${base}/v1/board?at=${Date.now()}`);
      add("a numeric board time answers", good.ok, `status ${good.status}`);
      return { checks, metrics: { lines: want, got } };
    } finally {
      for (const r of reqs) r.destroy();
      relay.kill();
      await tape.close();
      await db.done();
    }
  },
};
