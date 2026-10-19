// The E2E suites and their runner, loaded by run.ts after the fixture settings are in place (docs/OPS.md).
// Each suite writes artifacts/e2e/<suite>/<run-id>/{report.json,report.html,sha256.txt}.
import { connect } from "../../services/core/src/lib/db.ts";
import { env } from "../../services/core/src/lib/env.ts";
import { inputs, write } from "./lib/artifact.ts";
import { type ReplayResult, replay } from "./lib/replay.ts";
import type { ReplayOpts, Suite } from "./lib/suite.ts";
import { suite as agentLanes } from "./suites/agent-lanes/suite.ts";
import { suite as ammGolden } from "./suites/amm-golden/suite.ts";
import { suite as analyzers } from "./suites/analyzers-replay/suite.ts";
import { suite as bettafishFull } from "./suites/bettafish-full/suite.ts";
import { suite as bettafishInsight } from "./suites/bettafish-insight/suite.ts";
import { suite as booksReconcile } from "./suites/books-reconcile/suite.ts";
import { suite as calloutCase } from "./suites/callout-case-replay/suite.ts";
import { suite as coinGraduated } from "./suites/coin-graduated/suite.ts";
import { suite as commitReveal } from "./suites/commit-reveal/suite.ts";
import { suite as evolution } from "./suites/evolution-replay/suite.ts";
import { suite as feedCursor } from "./suites/feed-cursor/suite.ts";
import { suite as indexRows } from "./suites/index-rows/suite.ts";
import { suite as killSuite } from "./suites/kill/suite.ts";
import { suite as liveRoundtrip } from "./suites/live-roundtrip/suite.ts";
import { suite as mirosharkPumpfun } from "./suites/miroshark-pumpfun/suite.ts";
import { suite as ownerConfig } from "./suites/owner-config/suite.ts";
import { suite as precall } from "./suites/precall-replay/suite.ts";
import { suite as pumpHttp } from "./suites/pump-http/suite.ts";
import { suite as determinism } from "./suites/replay-determinism/suite.ts";
import { suite as riskgate } from "./suites/riskgate-refuses/suite.ts";
import { suite as rpcPool } from "./suites/rpc-pool/suite.ts";
import { suite as scoutBounded } from "./suites/scout-bounded/suite.ts";
import { suite as signerRefuses } from "./suites/signer-refuses/suite.ts";
import { suite as siteCards } from "./suites/site-cards/suite.ts";
import { suite as siteCortex } from "./suites/site-cortex/suite.ts";
import { suite as siteField } from "./suites/site-field/suite.ts";
import { suite as siteIntegrity } from "./suites/site-integrity/suite.ts";
import { suite as siteLab } from "./suites/site-lab/suite.ts";
import { suite as siteRewind } from "./suites/site-rewind/suite.ts";
import { suite as siteShell } from "./suites/site-shell/suite.ts";
import { suite as siteTreasury } from "./suites/site-treasury/suite.ts";
import { suite as slowBridge } from "./suites/slow-bridge/suite.ts";
import { suite as slowFanout } from "./suites/slow-fanout/suite.ts";
import { suite as slowRooms } from "./suites/slow-rooms/suite.ts";
import { suite as slowViews } from "./suites/slow-views/suite.ts";
import { suite as soulUpdate } from "./suites/soul-update/suite.ts";
import { suite as strategies } from "./suites/strategies-replay/suite.ts";
import { suite as swarmBrier } from "./suites/swarm-brier/suite.ts";
import { suite as sweepSuite } from "./suites/sweep/suite.ts";

const ALL: Suite[] = [riskgate, ownerConfig, slowViews, slowBridge, bettafishInsight, bettafishFull, mirosharkPumpfun, swarmBrier, slowFanout, slowRooms, signerRefuses, booksReconcile, sweepSuite, killSuite, liveRoundtrip, rpcPool, analyzers, strategies, commitReveal, evolution, determinism, calloutCase, precall, siteShell, siteField, siteCortex, siteLab, siteIntegrity, siteTreasury, siteRewind, siteCards, soulUpdate, ammGolden, agentLanes, feedCursor, pumpHttp, coinGraduated, scoutBounded, indexRows];
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const tape = process.env.E2E_TAPE!;
const chosen = args.length ? ALL.filter((s) => args.includes(s.name)) : ALL;
if (args.length && chosen.length !== args.length) {
  console.error(`unknown suite; have: ${ALL.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const cache = new Map<string, Promise<ReplayResult>>();
const opened: ReplayResult[] = [];
const ctx = {
  tape,
  replay: (tag = "main", o: ReplayOpts = {}) => {
    const key = JSON.stringify([tag, o.seed ?? 42, o.restartAt ?? null, o.extra ?? null, o.reverse ?? false, o.liveLeg ?? false]); // two variants never share a run
    if (!cache.has(key)) cache.set(key, replay(tape, { tag, seed: o.seed ?? 42, extra: o.extra, restartAt: o.restartAt, reverse: o.reverse, liveLeg: o.liveLeg }).then((r) => {
      opened.push(r);
      return r;
    }));
    return cache.get(key)!;
  },
};

let failed = 0;
for (const s of chosen) {
  const t0 = performance.now();
  try {
    const { checks, metrics, files } = await s.run(ctx);
    const r = write({ suite: s.name, proves: s.proves, run_id: runId, started_at: new Date().toISOString(), duration_ms: Math.round(performance.now() - t0), inputs: inputs(s.tape ? tape : undefined), checks, metrics }, files);
    if (!r.pass) failed++;
    console.log(`${r.pass ? "PASS" : "FAIL"} ${s.name}  ${r.artifact_dir}  sha256 ${r.sha256.slice(0, 16)}`);
    for (const c of checks) console.log(`  ${c.pass ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${s.name}  crashed: ${(err as Error).stack ?? err}`);
  }
}
// replay databases are disposable (docs/DECISIONS.md); E2E_KEEP=1 keeps them for a look afterwards
const keep = process.env.E2E_KEEP === "1";
const admin = keep ? null : connect(env.str("DATABASE_URL"), 1);
for (const r of opened) {
  console.log(`replay ${keep ? "database kept" : "dropped"}: ${r.db} (${r.inputs} inputs, ${r.steps} steps, ${r.ms} ms)`);
  await r.sql.end({ timeout: 2 });
  await admin?.unsafe(`drop database if exists ${r.db}`);
}
await admin?.end();
process.exit(failed ? 1 : 0);
