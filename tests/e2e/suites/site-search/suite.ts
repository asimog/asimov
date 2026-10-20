// Site search (E7c, docs/UI.md /wiki, docs/SLOW-MIND.md section 5): the relay's /v1/search embeds the question on the EMBED
// lane and returns wiki pages and reports by meaning, as of a time, from the same query the agents use; the Slow Bridge
// gives both engines the top wiki and report hits for the coin, as of the run's slot, fenced. The embedding endpoint is a
// fake HTTP server in this process (OpenAI-compatible /embeddings), never a real provider or key.
import http from "node:http";
import { Embedder, stubVector } from "../../../../packages/lane/src/index.ts";
import { connect as agentsConnect, migrate as agentsMigrate, PgSpend } from "../../../../services/agents/src/db.ts";
import { remember } from "../../../../services/agents/src/memory.ts";
import { Bridge } from "../../../../services/slow-bridge/src/bridge.ts";
import { EngineClient } from "../../../../services/slow-bridge/src/engine.ts";
import type { RunRequest } from "../../../../services/slow-bridge/src/types.ts";
import type { Check } from "../../lib/checks.ts";
import { CAP, MINT_A, slowEnv, WORKER_TOKEN } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

/** A fake OpenAI-compatible embeddings endpoint: hashed word vectors, a token count, no key checked beyond presence. */
async function fakeEmbeddings() {
  let calls = 0;
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/embeddings" || !req.headers.authorization) return res.writeHead(404).end();
      calls++;
      const { input } = JSON.parse(b) as { input: string[] };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        data: input.map((t, index) => ({ index, embedding: stubVector(t) })),
        usage: { prompt_tokens: input.reduce((a, t) => a + Math.ceil(t.length / 4), 0) },
      }));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, calls: () => calls, close: () => srv.close() };
}

/** A fake slow engine that records each run request and finishes with no output. */
async function fakeEngine() {
  const seen: RunRequest[] = [];
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const send = (body: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (req.method === "POST" && req.url === "/asimog/runs") {
        const r = JSON.parse(b) as RunRequest;
        seen.push(r);
        return send({ run_id: r.job_id });
      }
      send({ state: "done", output: {} });
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, seen, close: () => srv.close() };
}

type Hit = { kind: string; ref: string; slug: string | null; report_id: string | null; snippet: string; similarity: number; seen_at: string };
type Answer = { status: number; body: { hits?: Hit[]; error?: string; reason?: string } };
type MemHit = { kind: string; ref: string; text: string; seen_at: string };

export const suite: Suite = {
  name: "site-search",
  tier: "fast",
  covers: ["services/relay/src/search.ts", "packages/lane/src/recall.ts", "services/slow-bridge/src/bridge.ts", "apps/web/app/wiki/"],
  proves: "The relay's search returns wiki pages and reports by meaning, never a row seen after its as-of time, metered on the EMBED lane and paused when the lane is over its limit; the Slow Bridge feeds both engines the coin's wiki and report hits as of the run's slot, fenced.",
  async run() {
    const w = await slowEnv("search");
    const asql = agentsConnect(w.url);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const fake = await fakeEmbeddings();
    const bf = await fakeEngine();
    const ms = await fakeEngine();
    try {
      await agentsMigrate(asql);
      await w.seed();
      const env = { EMBEDDING_MODEL: "fake-embed", EMBEDDING_BASE_URL: fake.url, EMBEDDING_API_KEY: "fake-key", LLM_USD_HOUR_EMBED: "0.05", EMBEDDING_PRICE_PER_M: "0.02" };
      const writer = new Embedder({ env, spend: new PgSpend(asql) });
      const now = Date.now();
      const iso = (min: number) => new Date(now + min * 60_000).toISOString();
      const cut = iso(-30);
      await remember(asql, writer, [
        { id: "ev_w1", kind: "wiki", ref: "coin-pepe", mint: MINT_A, text: "# PEPE Pepe\nThe house traded PEPE twice. Pepe callers were early; hold time 12 minutes.", seen_at: iso(-60) },
        { id: "ev_w2", kind: "wiki", ref: "caller-k9", mint: null, text: "# caller k9\nMeasured caller: 40 calls, median net 0.92, holds under five minutes.", seen_at: iso(-60) },
        { id: "ev_r1", kind: "report", ref: "rep_day1", mint: null, text: "PAPER. Two coins held, DOGE closed at a small loss, @someone said hi.", seen_at: iso(-50) },
        { id: "ev_w3", kind: "wiki", ref: "coin-pepe-late", mint: MINT_A, text: "# PEPE Pepe late\nPEPE Pepe page written after the cut.", seen_at: iso(-10) },
        { id: "ev_w4", kind: "wiki", ref: "coin-pepe-future", mint: MINT_A, text: "# PEPE Pepe future\nPEPE Pepe page seen after the run's slot.", seen_at: iso(60) },
        { id: "ev_c1", kind: "callout", ref: "co_x", mint: MINT_A, text: "PEPE Pepe to the moon", seen_at: iso(-60) },
      ]);

      // the relay's search, through its module (main.ts only routes /v1/search to it)
      const mod = (await import("../../../../services/relay/src/search.ts").catch((err) => ({ err: String(err) }))) as { searchRoom?: (d: unknown) => (q: Record<string, string | undefined>) => Promise<Answer>; ReadSpend?: new (sql: unknown) => PgSpend; err?: string };
      const cache = new Map<string, { at: number; body: unknown }>();
      const cached = async (key: string, ttl: number, fn: () => Promise<unknown>) => {
        const c = cache.get(key);
        if (c && Date.now() - c.at < ttl) return c.body;
        const body = await fn();
        cache.set(key, { at: Date.now(), body });
        return body;
      };
      const search = mod.searchRoom ? mod.searchRoom({ sql: asql, embedder: new Embedder({ env, spend: new mod.ReadSpend!(asql) }), cached }) : null;
      const ask = async (q: Record<string, string | undefined>): Promise<Answer> => (search ? search(q) : { status: 0, body: { error: mod.err ?? "no search module" } });

      const first = await ask({ q: "PEPE Pepe coin page", kinds: "wiki,report", as_of: cut });
      const top = first.body.hits?.[0];
      add("a search returns the matching wiki page first", first.status === 200 && top?.kind === "wiki" && top.slug === "coin-pepe" && top.snippet.length <= 280, `${first.status} ${first.body.error ?? ""} ${(first.body.hits ?? []).map((h) => `${h.kind}:${h.ref}`).join(", ")}`);

      const past = first.body.hits ?? [];
      const later = await ask({ q: "PEPE Pepe coin page", kinds: "wiki,report", as_of: iso(0) });
      const noLeak = first.status === 200 && past.every((h) => h.seen_at <= cut) && !past.some((h) => h.ref === "coin-pepe-late") && (later.body.hits ?? []).some((h) => h.ref === "coin-pepe-late") && !(later.body.hits ?? []).some((h) => h.ref === "coin-pepe-future");
      add("a search as of a past time returns nothing seen after it", noLeak, `as of cut: ${past.map((h) => h.ref).join(", ") || "none"}; as of now: ${(later.body.hits ?? []).map((h) => h.ref).join(", ") || "none"}`);
      const kindsOk = [...past, ...(later.body.hits ?? [])].every((h) => h.kind === "wiki" || h.kind === "report");
      const masked = (await ask({ q: "two coins held DOGE loss", kinds: "report", as_of: iso(0) })).body.hits?.[0]?.snippet ?? "";

      // spend: each new question is one EMBED call (a repeat within the cache is free); an over-limit lane pauses search
      const callsBefore = fake.calls();
      await ask({ q: "PEPE Pepe coin page", kinds: "wiki,report", as_of: cut });
      const repeatFree = fake.calls() === callsBefore;
      const [spent] = await asql`select coalesce(sum(usd), 0)::float usd from agents.spend where lane = 'EMBED'`;
      const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
      await asql`insert into agents.spend (lane, hour, usd) values ('EMBED', ${hour}, 1) on conflict (lane, hour) do update set usd = excluded.usd`;
      const paused = await ask({ q: "a question never asked before", kinds: "wiki", as_of: iso(0) });
      const callsAfterPause = fake.calls();
      add("search spend is metered on the EMBED lane", search !== null && repeatFree && paused.status === 503 && paused.body.error === "search paused" && /EMBED/.test(paused.body.reason ?? "") && callsAfterPause === callsBefore,
        `repeat free: ${repeatFree}; over the limit: ${paused.status} ${paused.body.error ?? ""} (${paused.body.reason ?? ""}); EMBED spend in agents.spend before the limit ${Number(spent?.usd)}`);
      add("a hit is only a wiki page or a report, @mentions masked", search !== null && kindsOk && masked.includes("@…") && !masked.includes("@someone"), masked);
      const badTime = await ask({ q: "PEPE", kinds: "wiki", as_of: "yesterday" });
      const badKind = await ask({ q: "PEPE", kinds: "callout", as_of: iso(0) });
      add("a bad as_of or a callout kind is refused", badTime.status === 400 && badKind.status === 400, `${badTime.status} ${badTime.body.error ?? ""}; ${badKind.status} ${badKind.body.error ?? ""}`);
      await asql`delete from agents.spend where lane = 'EMBED' and hour = ${hour}`; // test database only: lift the limit for the bridge leg

      // the Slow Bridge: one stage 2 escalation feeds both engines; each gets the coin's top hits as of the slot, fenced
      const cores = { synth: w.inProc(CAP.synth), swarm: w.inProc(CAP.swarm), exchange: w.inProc(CAP.exchange) };
      const cfg = { feedEveryMin: 30, feedWindowMin: 60, coinRunsPerHour: 6, swarmRunsPerHour: 6, presets: { bettafish: "lite", miroshark: "lite" }, chain: "parallel" as const, chainWaitS: 1, runTimeoutS: 5, pollMs: 20, deferMaxMin: 90, stageUsd: { 1: 1, 2: 1, 3: 1 }, dayUsd: 100, coinWindowMin: 60 };
      let n = 0;
      const bridge = new Bridge({ sql: w.sql, cores, engines: { bettafish: new EngineClient("bettafish", bf.url, WORKER_TOKEN), miroshark: new EngineClient("miroshark", ms.url, WORKER_TOKEN) }, now: () => Date.now(), newId: () => `sj_s${++n}`, cfg, memory: { sql: asql, embedder: new Embedder({ env, spend: new PgSpend(asql) }) } } as never);
      w.tape.emit("jev.escalated", { subject: MINT_A, gate_reasons: ["voi"], job: "swarm_run", voi: 0.4, stage: 2, arm: "run" }, { source: "attention", subject: MINT_A });
      await w.tape.flush();
      await bridge.schedule();
      await bridge.drain();
      const reqs = [bf.seen.find((r) => r.subject === MINT_A), ms.seen.find((r) => r.subject === MINT_A)] as (RunRequest & { memory_hits?: MemHit[] } | undefined)[];
      const ok = reqs.every((r) => {
        const h = r?.memory_hits;
        return !!h && h.length >= 1 && h.length <= 3 && h.some((x) => x.ref === "coin-pepe") && !h.some((x) => x.ref === "coin-pepe-future") && h.every((x) => x.seen_at <= r!.as_of && (x.kind === "wiki" || x.kind === "report") && x.text.startsWith("<untrusted>") && x.text.endsWith("</untrusted>"));
      });
      add("the slow bridge input carries wiki hits as of its slot", ok, reqs.map((r, i) => `${i ? "miroshark" : "bettafish"}: ${r ? (r.memory_hits ?? []).map((h) => `${h.kind}:${h.ref}@${h.seen_at}`).join(", ") || "no hits" : "no run"}${r ? ` (slot ${r.as_of})` : ""}`).join("; "));
      return { checks, metrics: { embed_calls: fake.calls(), hits_past: past.length, hits_now: later.body.hits?.length ?? 0 } };
    } finally {
      fake.close();
      bf.close();
      ms.close();
      await asql.end({ timeout: 2 });
      await w.close();
    }
  },
};
