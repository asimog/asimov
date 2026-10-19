// The E2E suites and their runner, loaded by run.ts after the fixture settings are in place (docs/OPS.md).
// Each suite writes artifacts/e2e/<suite>/<run-id>/{report.json,report.html,sha256.txt}.
import fs from "node:fs";
import path from "node:path";
import { connect } from "../../services/core/src/lib/db.ts";
import { env } from "../../services/core/src/lib/env.ts";
import { inputs, write } from "./lib/artifact.ts";
import { type ReplayResult, replay } from "./lib/replay.ts";
import { FAST_BUDGET_MS, type ReplayOpts, type Suite, TIERS } from "./lib/suite.ts";
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
// bare run: the fast tier; anything else runs by name (docs/OPS.md section 9)
const chosen = args.length ? ALL.filter((s) => args.includes(s.name)) : ALL.filter((s) => s.tier === "fast");
if (args.length && chosen.length !== args.length) {
  console.error(`unknown suite; have: ${ALL.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

// one run at a time: a timing taken beside another run is not a timing
const LOCK = "artifacts/e2e/.lock";
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
if (fs.existsSync(LOCK)) {
  const held = JSON.parse(fs.readFileSync(LOCK, "utf8")) as { pid: number; suites: string[]; at: string };
  const alive = (() => {
    try {
      process.kill(held.pid, 0);
      return true;
    } catch {
      return false;
    }
  })();
  if (alive) {
    console.error(`another e2e run holds ${LOCK}: pid ${held.pid} since ${held.at} (${held.suites.join(", ")})`);
    process.exit(2);
  }
}
fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, suites: chosen.map((s) => s.name), at: new Date().toISOString() }));
process.on("exit", () => fs.rmSync(LOCK, { force: true }));

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const cache = new Map<string, Promise<ReplayResult>>();
const opened: ReplayResult[] = [];
const ctx = {
  tape,
  replay: (tag = "main", o: ReplayOpts & { tape?: string } = {}) => {
    const file = o.tape ?? tape;
    const key = JSON.stringify([file, tag, o.seed ?? 42, o.restartAt ?? null, o.extra ?? null, o.reverse ?? false, o.liveLeg ?? false]); // two variants never share a run
    if (!cache.has(key))
      cache.set(key, replay(file, { tag, seed: o.seed ?? 42, extra: o.extra, restartAt: o.restartAt, reverse: o.reverse, liveLeg: o.liveLeg }).then((r) => {
        opened.push(r);
        return r;
      }));
    return cache.get(key)!;
  },
};

let failed = 0;
const t00 = performance.now();
for (const s of chosen) {
  const t0 = performance.now();
  try {
    const { checks, metrics, files, skipped } = await s.run(ctx);
    const duration = Math.round(performance.now() - t0);
    const budget = s.budget_ms ?? (s.tier === "fast" ? FAST_BUDGET_MS : null);
    if (budget != null && !skipped) checks.push({ name: "within its time budget", pass: duration <= budget, detail: `${duration} ms of ${budget} ms (tier ${s.tier})` });
    const r = write({ suite: s.name, proves: s.proves, tier: s.tier, skipped: skipped ?? null, run_id: runId, started_at: new Date().toISOString(), duration_ms: duration, inputs: inputs(s.tape ? tape : undefined), checks, metrics }, files);
    if (!r.pass && !skipped) failed++;
    console.log(`${skipped ? "SKIP" : r.pass ? "PASS" : "FAIL"} ${s.name}  ${(duration / 1000).toFixed(1)} s  ${skipped ?? r.artifact_dir}`);
    for (const c of checks) console.log(`  ${c.pass ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${s.name}  crashed: ${(err as Error).stack ?? err}`);
  }
}
console.log(`total ${((performance.now() - t00) / 1000).toFixed(1)} s, ${chosen.length} suites, ${failed} failed`);
if (!args.length)
  for (const t of TIERS.filter((x) => x !== "fast")) {
    const names = ALL.filter((s) => s.tier === t).map((s) => s.name);
    if (names.length) console.log(`${t} (run by name: npm run e2e -- <suite>): ${names.join(", ")}`);
  }
// replay databases are disposable (docs/DECISIONS.md); E2E_KEEP=1 keeps them for a look afterwards
const keep = process.env.E2E_KEEP === "1";
const admin = keep ? null : connect(env.str("DATABASE_URL"), 1);
for (const r of opened) {
  console.log(`replay ${keep ? "database kept" : "dropped"}: ${r.db} (${r.inputs} inputs, ${r.steps} steps, ${r.ms} ms)`);
  await r.sql.end({ timeout: 2 });
  await admin?.unsafe(`drop database if exists ${r.db} with (force)`);
}
await admin?.end();
process.exit(failed ? 1 : 0);
