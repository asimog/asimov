// Which sees a pump.fun trade first: the pump.fun NATS feed or our RPC providers' `logsSubscribe` (processed)? Run for a short while,
// then compare arrival times of the same signature on this one machine's clock. Prints names and numbers only, never URLs or keys.
//   npx tsx scripts/latency-nats-vs-rpc.ts [seconds=90]

import { specsFromEnv } from "../services/core/src/lib/rpc.ts";
import { decodeJson, natsConnect } from "../services/core/src/senses/nats.ts";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const seconds = Number(process.argv[2] ?? 90);
const first = new Map<string, Map<string, number>>(); // signature -> source -> first arrival (ms)
const seen = (sig: string, source: string) => {
  const m = first.get(sig) ?? first.set(sig, new Map()).get(sig)!;
  if (!m.has(source)) m.set(source, Date.now());
};

const sources = ["nats"];
const nc = await natsConnect("trades", Date.now, () => {});
void (async () => {
  for await (const msg of nc.subscribe("unifiedTradeEvent.lite.>")) {
    const t = decodeJson(msg.data) as { tx?: string };
    if (t.tx) seen(t.tx, "nats");
  }
})();

for (const s of specsFromEnv()) {
  const ws = new WebSocket(s.url.replace(/^http/, "ws"));
  sources.push(s.name);
  ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [PUMP] }, { commitment: "processed" }] }));
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { params?: { result?: { value?: { signature?: string; err?: unknown } } }; error?: unknown };
    if (m.error) console.log(`${s.name}: refused logsSubscribe`);
    const v = m.params?.result?.value;
    if (v?.signature && !v.err) seen(v.signature, s.name);
  };
  ws.onerror = () => console.log(`${s.name}: websocket error`);
}

await new Promise((r) => setTimeout(r, seconds * 1000));
await nc.close();

const q = (a: number[], p: number) => a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
console.log(`\n${seconds}s, ${first.size} signatures; delta = this source's arrival minus NATS's, in ms (negative: faster than NATS)`);
for (const name of sources) {
  const have = [...first.values()].filter((m) => m.has(name));
  const both = have.filter((m) => m.has("nats") && name !== "nats").map((m) => m.get(name)! - m.get("nats")!);
  const only = have.filter((m) => m.size === 1).length;
  const line = both.length ? `p10 ${q(both, 0.1)}  median ${q(both, 0.5)}  p90 ${q(both, 0.9)}  (${both.length} shared)` : "";
  console.log(`${name.padEnd(12)} saw ${String(have.length).padStart(5)} (${only} seen by no other source)  ${line}`);
}
process.exit(0);
