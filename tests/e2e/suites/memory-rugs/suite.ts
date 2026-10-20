// E7b (docs/PIPELINE.md section 10): rug reports by similarity. The Librarian scores each reply against the owner's rug
// examples and writes `reply.rug_score` (at core's now, like every write); the rug feed shows a reply that matches the rug
// words or is scored rug-like, and says which; the callout pack gets, as a bucket, the rug-like replies on the coin whose
// scores were seen by the callout's time, so a replay reads the same. A fake embedding endpoint on localhost stands in for the model (no keys, no network);
// a stand-in Jev client records what it was asked.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Embedder } from "../../../../packages/lane/src/index.ts";
import { connect as agentsConnect, migrate as agentsMigrate, PgSpend } from "../../../../services/agents/src/db.ts";
import { AgentsRuntime } from "../../../../services/agents/src/runtime.ts";
import { type JevClient, reflexTrigger } from "../../../../services/core/src/reflex/reflex.ts";
import { RUG_WORDS, rugFeed } from "../../../../services/relay/src/rug-feed.ts";
import type { Check } from "../../lib/checks.ts";
import { CAP, MINT_A, MINT_B, slowEnv, WALLETS } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

// The fake model: one axis per concept, so texts about leaving or dumping land together whatever their exact words.
const CONCEPTS: string[][] = [
  ["rug", "rugged", "dump", "dumped", "dumping", "sold", "sell", "cashed", "dead", "left", "abandoned", "drained", "exit", "exited", "gone", "team", "dev", "devs", "out", "walked", "away", "pulled", "liquidity"],
  ["moon", "buy", "buying", "holding", "hold", "strong", "nice", "bullish", "send", "early", "gem", "love", "community"],
];
const TAIL = 16;
function fakeVector(text: string): number[] {
  const v = new Array<number>(CONCEPTS.length + TAIL).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const c = CONCEPTS.findIndex((ws) => ws.includes(w));
    if (c >= 0) v[c]! += 1;
    else v[CONCEPTS.length + ([...w].reduce((a, ch) => a + ch.charCodeAt(0), 0) % TAIL)]! += 0.15;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
async function fakeEndpoint() {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const { input } = JSON.parse(body) as { input: string[] };
      seen.push(...input);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: fakeVector(t) })), usage: { prompt_tokens: input.join(" ").length / 4 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const NO_WORDS = "team cashed out, chart is dead";
const LATER = "devs walked away, liquidity gone";
const WORDS = "this is a rug, dev dumped on us";
const PLAIN = "nice chart, holding strong";

const reply = (reply_id: string, mint: string, text: string) => ({ callout_id: "co_x", mint, reply_id, parent_id: null, wallet: WALLETS[2], handle: "someone", text, likes: 0, media_url: null, created_at: new Date().toISOString() });
const callout = (callout_id: string, mint: string) => ({
  callout_id, mint, symbol: "PEPE", name: "Pepe", author_wallet: WALLETS[0]!, author_user_id: null, author_handle: null, author_x: null,
  author_followers: 50_000, author_total_callouts: 3, text: "buying more here, chart looks fine", media_url: null, mcap_at_call_usd: 20_000, price_at_call_usd: null,
  created_at: new Date().toISOString(), chain: "solana", quoted_callout_id: null, author_position: null, via: "push" as const,
});

type Observed = { text: string; match?: string; similarity?: number };
type Feed = { coins: { mint: string; observed: Observed[] }[] };

/** One world: a fresh database, the Librarian with or without an embedder, the rug feed and the callout pack. */
async function world(tag: string, embEnv: NodeJS.ProcessEnv | null) {
  const w = await slowEnv(tag);
  const asql = agentsConnect(w.url);
  await agentsMigrate(asql);
  const mcp = await w.mcpUp();
  const emb = embEnv ? new Embedder({ env: embEnv, spend: new PgSpend(asql) }) : undefined;
  const rt = new AgentsRuntime({ sql: asql, mcpUrl: mcp.url, token: (a) => (a === "librarian" ? w.tok(CAP.memory) : undefined), lane: () => { throw new Error("no lane"); }, embedder: emb, enabled: ["librarian"] });
  const emit = async (topic: "callout.created" | "callout.reply", body: unknown, subject: string) => {
    const seen = (await w.sql.begin((tx) => w.tape.emitIn(tx as never, topic, body as never, { source: "feedreader", subject, after: new Date(Date.now() - 1).toISOString() }))).seen_time;
    await new Promise((r) => setTimeout(r, 15));
    return { id: "", topic, seen_time: seen, subject, body } as const;
  };
  const asked: Record<string, Record<string, unknown>> = {};
  const jev = {
    async systemOne(req: { state: Record<string, unknown>; questions: Record<string, unknown> }) {
      asked[String((req.state as { callout_id?: string }).callout_id ?? Object.keys(asked).length)] = req.state;
      return { model: "stand-in", answers: Object.fromEntries(Object.keys(req.questions).map((q) => [q, { type: "noul", noul: 0.1, confidence: 0.8 }])), usage: { input_tokens: 10 } };
    },
  } as unknown as JevClient;
  const trig = reflexTrigger(w.tape, w.clock, jev);
  /** Ask the callout pack about one callout event; returns the state Jev saw. */
  const ask = async (ev: { seen_time: string; body: unknown }) => {
    const n = Object.keys(asked).length;
    const [row] = await w.sql`select id, topic, seen_time, subject, body, source from tape.events where topic = 'callout.created' and seen_time = ${ev.seen_time} limit 1`;
    await trig.handle([{ ...row, seen_time: (row!.seen_time as Date).toISOString() } as never], undefined as never);
    for (let i = 0; i < 50 && Object.keys(asked).length === n; i++) await new Promise((r) => setTimeout(r, 10));
    return Object.values(asked)[n] ?? {};
  };
  const feed = async () => (await rugFeed({ sql: w.sql, cached: (_k, _ms, fn) => fn(), sym: () => "PEPE" })()) as Feed;
  const rugLike = async () => (await w.sql`select seen_time, body from tape.events where topic = 'reply.rug_score' and (body->>'rug_like')::bool order by seen_time, id`).map((r) => ({ seen_time: (r.seen_time as Date).toISOString(), body: r.body as Record<string, unknown> }));
  return {
    w, rt, emit, ask, feed, rugLike,
    async close() {
      await rt.close();
      await asql.end();
      await w.close();
    },
  };
}

export const suite: Suite = {
  name: "memory-rugs",
  tier: "fast",
  covers: ["services/agents/src/rugs.ts", "services/agents/src/runtime.ts", "services/relay/src/rug-feed.ts", "services/core/src/reflex/reflex.ts", "config/rug-exemplars.json"],
  proves: "E7b: a rug report worded without the rug words reaches the rug feed as `similar`; the callout pack sees the count of rug-like replies seen at or before the callout only; without an embedder nothing is scored, the feed is words only and the bucket is unknown.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const fake = await fakeEndpoint();
    const embEnv = { EMBEDDING_MODEL: "fake-concepts-1", EMBEDDING_BASE_URL: fake.url, EMBEDDING_API_KEY: "fake-key", LLM_USD_HOUR_EMBED: "1" };
    let metrics: Record<string, number> = {};
    try {
      // ---- with an embedder ----
      const a = await world("rugs", embEnv);
      try {
        const r1 = await a.emit("callout.reply", reply("r_nowords", MINT_A, NO_WORDS), "r_nowords");
        await a.emit("callout.reply", reply("r_plain", MINT_A, PLAIN), "r_plain");
        await a.emit("callout.reply", reply("r_words", MINT_B, WORDS), "r_words");
        await a.rt.indexMemory(); // the Librarian runs between events, as it does live every tick
        const c1 = await a.emit("callout.created", callout("co_1", MINT_A), "co_1");
        await a.emit("callout.reply", reply("r_later", MINT_A, LATER), "r_later");
        await a.rt.indexMemory();
        const c2 = await a.emit("callout.created", callout("co_2", MINT_A), "co_2");
        await a.rt.indexMemory();
        const events = await a.rugLike();
        const feed = await a.feed();
        const coinA = feed.coins.find((c) => c.mint === MINT_A);
        const coinB = feed.coins.find((c) => c.mint === MINT_B);
        const shown = coinA?.observed.find((o) => o.text === NO_WORDS);
        const ev1 = events.find((e) => e.body.reply_id === "r_nowords");
        add(
          "a rug report without rug words reaches the rug feed",
          !RUG_WORDS.test(NO_WORDS) && shown?.match === "similar" && (shown.similarity ?? 0) >= 0.8 && !coinA!.observed.some((o) => o.text === PLAIN)
            && coinB?.observed[0]?.match === "words" && !!ev1 && ev1.seen_time >= r1.seen_time && ev1.body.mint === MINT_A && ev1?.body.model === "fake-concepts-1",
          `shown ${JSON.stringify(shown)}; words report ${JSON.stringify(coinB?.observed[0])}; score at ${ev1?.seen_time} for reply seen ${r1.seen_time}; ${events.length} rug-like scores (${events.map((e) => e.body.reply_id).join(", ")})`,
        );
        const s1 = await a.ask(c1);
        const s2 = await a.ask(c2);
        add(
          "the exit pack sees rug-like replies seen before the callout only",
          s1.rug_like_replies === "one" && s2.rug_like_replies === "several",
          `callout before the later report: ${String(s1.rug_like_replies)}; callout after it: ${String(s2.rug_like_replies)}`,
        );
        metrics = { rug_like: events.length, embedded_texts: fake.seen.length };
      } finally {
        await a.close();
      }
      // ---- without an embedder ----
      const b = await world("rugs_noemb", null);
      try {
        await b.emit("callout.reply", reply("r_nowords", MINT_A, NO_WORDS), "r_nowords");
        await b.emit("callout.reply", reply("r_words", MINT_A, WORDS), "r_words");
        const c = await b.emit("callout.created", callout("co_1", MINT_A), "co_1");
        await b.rt.indexMemory();
        const events = await b.rugLike();
        const coin = (await b.feed()).coins.find((x) => x.mint === MINT_A);
        const s = await b.ask(c);
        add(
          "no rug score without an embedder",
          events.length === 0 && coin?.observed.length === 1 && coin.observed[0]!.text === WORDS && coin.observed[0]!.match === "words" && s.rug_like_replies === "unknown",
          `${events.length} rug-like scores; feed ${JSON.stringify(coin?.observed)}; bucket ${String(s.rug_like_replies)}`,
        );
      } finally {
        await b.close();
      }
    } finally {
      await fake.close();
    }
    return { checks, metrics };
  },
};
