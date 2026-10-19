// The E2E suites and their runner, loaded by run.ts after the fixture settings are in place (docs/OPS.md).
// Each suite writes artifacts/e2e/<suite>/<run-id>/{report.json,report.html,sha256.txt}.
import fs from "node:fs";
import path from "node:path";
import { connect } from "../../services/core/src/lib/db.ts";
import { env } from "../../services/core/src/lib/env.ts";
import { inputs, write } from "./lib/artifact.ts";
import { type ReplayResult, replay } from "./lib/replay.ts";
import { FAST_BUDGET_MS, type ReplayOpts, TIERS } from "./lib/suite.ts";
import { ALL } from "./suites.ts";

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
    if (!fs.existsSync(file)) throw new Error(`no tape at ${file}: record a fresh one (docs/OPS.md section 9, docs/tasks/G0.md)`);
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
