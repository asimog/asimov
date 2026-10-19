// The Slow Bridge (docs/SLOW-MIND.md section 5) against two fake engines speaking the /asimog/runs contract: a feed run and one
// escalation that feeds both engines at once, outputs mapped through core's validators, reports passed between the
// engines as parents, idempotent slots, and a dead engine that fails its job without touching anything else.
import http from "node:http";
import type { Envelope } from "../../../../packages/contracts/src/index.ts";
import { slowSignals } from "../../../../services/core/src/analyzers/slow-signals.ts";
import { liveFor } from "../../../../services/core/src/board/board.ts";
import type { Tx } from "../../../../services/core/src/tape/consumer.ts";
import { Bridge } from "../../../../services/slow-bridge/src/bridge.ts";
import { EngineClient } from "../../../../services/slow-bridge/src/engine.ts";
import type { RunRequest, RunStatus } from "../../../../services/slow-bridge/src/types.ts";
import type { Check } from "../../lib/checks.ts";
import { CAP, MINT_A, slowEnv } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

type Fake = { url: string; seen: RunRequest[]; close(): void };
async function fakeEngine(answer: (r: RunRequest) => RunStatus): Promise<Fake> {
  const seen: RunRequest[] = [];
  const runs = new Map<string, RunStatus>();
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const send = (code: number, body: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (req.method === "POST" && req.url === "/asimog/runs") {
        const r = JSON.parse(b) as RunRequest;
        seen.push(r);
        runs.set(r.job_id, answer(r));
        return send(200, { run_id: r.job_id });
      }
      const m = req.url?.match(/^\/asimog\/runs\/(.+)$/);
      if (m) return send(200, runs.get(decodeURIComponent(m[1]!)) ?? { state: "failed", error: "unknown run" });
      send(404, {});
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, seen, close: () => srv.close() };
}

export const suite: Suite = {
  name: "slow-bridge",
  tier: "fast",
  covers: ["services/slow-bridge/"],
  proves: "The Slow Bridge queues feed runs and escalations once, feeds both engines from one escalation, maps outputs through core's validators, passes reports between engines, and survives a dead engine.",
  async run() {
    const w = await slowEnv("slowbridge");
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    try {
      await w.seed();
      const bf = await fakeEngine((r) => ({ state: "done", output: {
        reports: [{ producer: "bettafish.report", kind: r.kind, subject: r.subject, summary: "PEPE callers early and bullish; DOGE flagged as a likely rug by two callers.", cites: ["co_a1", "co_b1", "co_FAKE"], ir: { sections: ["narratives"] }, markdown: "# Feed" }],
        ...(r.kind === "feed"
          ? { synthesis_feed: { window_min: r.window_min, narratives: [{ title: "PEPE early", summary: "Two callers early on PEPE.", cites: ["co_a1", "co_a2"] }, { title: "made up", summary: "Invented.", cites: ["co_FAKE"] }], coin_stances: [], suspicious: [] }, mood: { mood: 0.2, label: "calm", n_callouts: 6 } }
          : { synthesis_coin: { stance: "bullish", narrative: "Early callers buying.", claims: [{ text: "Callers early", cites: ["co_a1"] }] } }),
        cost_usd: 0.01,
      } }));
      const ms = await fakeEngine((r) => ({ state: "done", output: {
        reports: [{ producer: "miroshark.report", kind: "swarm", subject: r.subject, summary: "SIMULATED: the call spreads to six tracked callers in most samples.", cites: ["co_a1"], simulated: true }],
        swarm: { samples: 3, usd: 0.02, truncated: false, wave_p: 0.67, d_callers: 2, d_net_sol: 1.5, posts: [{ branch: "A", round: 1, agent: "caller0", archetype: "caller", text: "PEPE still early" }] },
        cost_usd: 0.02,
      } }));
      let t = w.clock.now();
      let n = 0;
      const cores = { synth: w.inProc(CAP.synth), swarm: w.inProc(CAP.swarm), exchange: w.inProc(CAP.exchange) };
      const cfg = { feedEveryMin: 30, feedWindowMin: 60, coinRunsPerHour: 6, swarmRunsPerHour: 6, presets: { bettafish: "lite", miroshark: "lite" }, chain: "parallel" as const, chainWaitS: 1, runTimeoutS: 5, pollMs: 20 };
      const bridge = new Bridge({ sql: w.sql, cores, engines: { bettafish: new EngineClient("bettafish", bf.url), miroshark: new EngineClient("miroshark", ms.url) }, now: () => t, newId: () => `sj_t${++n}`, cfg });

      // 1. feed slot: queued once however often we schedule
      await bridge.schedule();
      await bridge.schedule();
      const [feedJobs] = await w.sql`select count(*)::int n from slow.jobs where kind = 'feed'`;
      add("a feed slot is queued once", feedJobs!.n === 1, `${feedJobs!.n} feed jobs`);
      await bridge.drain();
      const feed = await w.sql`select body from tape.events where topic = 'synthesis.feed'`;
      const kept = (feed[0]?.body as { narratives?: unknown[]; claims_dropped?: number } | undefined);
      add("feed output reaches the Tape through core, the invented claim dropped", feed.length === 1 && kept?.narratives?.length === 1 && (kept.claims_dropped ?? 0) >= 1, JSON.stringify({ n: feed.length, kept: kept?.narratives?.length, dropped: kept?.claims_dropped }));
      const [rep] = await w.sql`select report_id, cites from slow.reports where producer = 'bettafish.report'`;
      add("the BettaFish report is published with only real cites", !!rep && (rep.cites as string[]).length === 2 && !(rep.cites as string[]).includes("co_FAKE"), JSON.stringify(rep?.cites));

      // 2. one escalation feeds both engines at once; the swarm gets the BettaFish report as a parent
      t += 60_000;
      w.tape.emit("jev.escalated", { subject: MINT_A, gate_reasons: ["voi"], job: "synthesis_coin", voi: 0.4, stage: 1, arm: "run", deferred: false }, { source: "reflex", subject: MINT_A });
      await w.tape.flush();
      t += 1000;
      await bridge.schedule();
      await bridge.schedule();
      const esc = await w.sql`select engine, kind from slow.jobs where subject = ${MINT_A} order by engine`;
      add("one escalation queues a BettaFish coin run and a MiroShark swarm, once", esc.length === 2 && esc[0]!.engine === "bettafish" && esc[1]!.engine === "miroshark", esc.map((r) => `${r.engine}:${r.kind}`).join(","));
      await bridge.drain();
      const swarmReq = ms.seen.find((r) => r.subject === MINT_A);
      const bfReports = (await w.sql`select report_id from slow.reports where producer like 'bettafish.%' and subject = ${MINT_A}`).map((r) => r.report_id as string);
      add("MiroShark's run lists BettaFish reports on the coin as parents (or runs in parallel with none yet)", !!swarmReq && swarmReq.parent_reports.every((p) => bfReports.includes(p)), JSON.stringify(swarmReq?.parent_reports));
      const [wave] = await w.sql`select body from tape.events where topic = 'swarm.wave_p' and subject = ${MINT_A}`;
      add("the swarm result reaches the Tape", (wave?.body as { wave_p?: number } | undefined)?.wave_p === 0.67);
      const [msRep] = await w.sql`select e.body from tape.events e where e.topic = 'report.published' and e.body->>'producer' = 'miroshark.report'`;
      add("the MiroShark report is published and marked simulated", (msRep?.body as { simulated?: boolean } | undefined)?.simulated === true);

      // 3. a later BettaFish coin run gets the MiroShark report as a parent: reports flow both ways
      t += 120_000;
      w.tape.emit("attention.grant", { job: "synthesis_deep", subject: MINT_A, voi: 0.5, cost_est: 0.01, budget_left: 1 }, { source: "attention", subject: MINT_A });
      await w.tape.flush();
      t += 1000;
      await bridge.schedule();
      await bridge.drain();
      const second = bf.seen.filter((r) => r.subject === MINT_A).at(-1);
      const msIds = (await w.sql`select report_id from slow.reports where producer like 'miroshark.%'`).map((r) => r.report_id as string);
      add("a later BettaFish run reads the MiroShark report as a parent", !!second && second.parent_reports.some((p) => msIds.includes(p)), JSON.stringify(second?.parent_reports));

      // 4. a dead engine fails its job and nothing else
      const before = await w.sql`select count(*)::int n from tape.events`;
      const dead = new Bridge({ sql: w.sql, cores, engines: { bettafish: new EngineClient("bettafish", "http://127.0.0.1:9", 500), miroshark: null }, now: () => t + 3_600_000, newId: () => `sj_d${++n}`, cfg });
      await dead.schedule();
      await dead.drain();
      const [failed] = await w.sql`select state, error from slow.jobs where id = ${`sj_d${n}`}`;
      const after = await w.sql`select count(*)::int n from tape.events`;
      add("a dead engine fails its job with a reason", failed?.state === "failed" && String(failed.error).length > 0, String(failed?.error));
      add("a dead engine writes nothing to the Tape", after[0]!.n === before[0]!.n, `${before[0]!.n} -> ${after[0]!.n}`);
      // 5. the Board keeps the newest report per subject and producer (report.latest), the envelope only
      const pubs = await w.sql`select * from tape.events where topic = 'report.published' order by seen_time, id`;
      const proj = slowSignals(w.clock);
      await w.sql.begin((tx) => proj.handle(pubs.map((r) => ({ ...r, seen_time: (r.seen_time as Date).toISOString() })) as unknown as Envelope[], tx as unknown as Tx));
      const latest = await liveFor(w.sql, `${MINT_A}|miroshark.report`, w.clock.iso());
      const lv = latest["report.latest"]?.value as { simulated?: boolean; ir?: unknown } | undefined;
      add("the Board keeps report.latest per subject and producer, without the body", lv?.simulated === true && lv.ir === undefined, JSON.stringify(lv)?.slice(0, 120));
      bf.close();
      ms.close();
      return { checks, metrics: { ...bridge.stats } };
    } finally {
      await w.close();
    }
  },
};
