// Record a real pump.fun slice for a suite (docs/WORKFLOW.md, docs/tasks/B2.md step 0).
// One run reads the smallest slice that shows the shapes: by default two pages of each HTTP feed source and
// 20 seconds of each NATS subject named with --nats. Nothing is guessed: the fixture keeps the request, status
// and the real payload, and a refusal is recorded as its status and never retried around.
import fs from "node:fs";
import path from "node:path";
import { env } from "../services/core/src/lib/env.ts";
import { log } from "../services/core/src/lib/log.ts";
import { decodeJson, natsConnect } from "../services/core/src/senses/nats.ts";

type HttpSlice = { name: string; request: string; status: number; headers: Record<string, string>; body: unknown; raw: string };
type NatsSlice = { subject: string; seconds: number; messages: { subject: string; data: unknown }[] };

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const name = opt("name") ?? args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--nats") ?? "slice";
const pages = Number(opt("pages") ?? 2);
const nats = args.flatMap((a, i) => (a === "--nats" && args[i + 1] ? [args[i + 1]!] : []));
const outFile = opt("out") ?? path.join(env.root, "tests/e2e/fixtures/pump", `${name}.json`);

const UA = "asimog/0.1 (+https://github.com/asimog/asimov)"; // the Feed Reader's own user agent
const HTTP = [
  { name: "recent", path: "/home-feed/new" },
  { name: "hot", path: "/home-feed" },
];

async function httpSlice(source: (typeof HTTP)[number]): Promise<HttpSlice[]> {
  const out: HttpSlice[] = [];
  let token: string | undefined;
  for (let i = 0; i < pages; i++) {
    const url = new URL(env.str("PUMP_API_URL") + source.path);
    url.searchParams.set("pageSize", String(env.int("FEED_PAGE_SIZE")));
    url.searchParams.set("chain", "all");
    url.searchParams.set("platform", "WEB");
    if (token) url.searchParams.set("pageToken", token);
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    const raw = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    out.push({ name: source.name, request: url.toString(), status: res.status, headers: Object.fromEntries(res.headers), body, raw: raw.slice(0, 4000) });
    if (res.status === 429) {
      const after = Number(res.headers.get("retry-after") ?? 0);
      log.warn("pump-sample refused", { source: source.name, status: res.status, retryAfterS: after });
      break;
    }
    if (res.status !== 200 || !body || typeof body !== "object") break;
    token = (body as { nextPageToken?: string }).nextPageToken;
    if (!token) break;
  }
  return out;
}

async function natsSlice(spec: string): Promise<NatsSlice> {
  const [subject, secs = "20", which] = spec.split(":");
  const server = (which ?? (subject!.startsWith("unifiedTradeEvent") ? "trades" : "feed")) as "trades" | "feed";
  const seconds = Number(secs);
  const messages: { subject: string; data: unknown }[] = [];
  const nc = await natsConnect(server, () => Date.now(), () => {});
  const sub = nc.subscribe(subject!);
  void (async () => {
    for await (const m of sub) {
      if (messages.length >= 1000) break;
      try {
        messages.push({ subject: m.subject, data: decodeJson(m.data) });
      } catch {
        messages.push({ subject: m.subject, data: null });
      }
    }
  })();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await sub.unsubscribe();
  await nc.close();
  log.info("pump-sample nats", { subject, seconds, messages: messages.length });
  return { subject: subject!, seconds, messages };
}

const slice = {
  at: new Date().toISOString(),
  http: flag("no-http") ? [] : (await Promise.all(HTTP.map(httpSlice))).flat(),
  nats: await Promise.all(nats.map(natsSlice)),
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(slice, null, 2)}\n`);
console.log(`${outFile}: ${slice.http.length} HTTP answers, ${slice.nats.reduce((n, s) => n + s.messages.length, 0)} NATS messages`);
