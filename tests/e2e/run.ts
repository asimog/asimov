// E2E runner (docs/14): `npm run e2e [suite ...]`. Replay suites share one replay of the tape per run.
// Each suite writes artifacts/e2e/<suite>/<run-id>/{report.json,report.html,sha256.txt}.
import { write, inputs } from "./lib/artifact.ts";
import { replay, type ReplayResult } from "./lib/replay.ts";
import type { ReplayOpts, Suite } from "./lib/suite.ts";
import { suite as calloutCase } from "./suites/callout-case-replay/suite.ts";
import { suite as analyzers } from "./suites/analyzers-replay/suite.ts";
import { suite as commitReveal } from "./suites/commit-reveal/suite.ts";
import { suite as evolution } from "./suites/evolution-replay/suite.ts";
import { suite as precall } from "./suites/precall-replay/suite.ts";
import { suite as determinism } from "./suites/replay-determinism/suite.ts";
import { suite as riskgate } from "./suites/riskgate-refuses/suite.ts";
import { suite as strategies } from "./suites/strategies-replay/suite.ts";

const ALL: Suite[] = [riskgate, analyzers, strategies, commitReveal, evolution, determinism, calloutCase, precall];
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const tape = process.env.E2E_TAPE ?? "tests/e2e/fixtures/tapes/discovery-10m.ndjson.gz";
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
    const key = `${tag}:${o.seed ?? 42}`;
    if (!cache.has(key)) cache.set(key, replay(tape, { tag, seed: o.seed ?? 42, extra: o.extra, restartAt: o.restartAt }).then((r) => (opened.push(r), r)));
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
for (const r of opened) {
  console.log(`replay database kept: ${r.db} (${r.inputs} inputs, ${r.ms} ms)`);
  await r.sql.end({ timeout: 2 });
}
process.exit(failed ? 1 : 0);
