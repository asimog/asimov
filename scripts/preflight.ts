// Preflight (docs/WORKFLOW.md section 1): which mode a change is, and the exact checks it needs.
// npm run preflight [path ...]   (no paths: the working tree's changes against HEAD, untracked files included)
import { execSync } from "node:child_process";
import { ALL } from "../tests/e2e/suites.ts";

// mode C: a small diff here can still lose money or events
const PROTECTED = [
  "services/core/src/tape/", "services/signer/", "services/core/src/mind/risk.ts", "services/core/src/hands/", "services/core/src/treasury/",
  "packages/contracts/", "services/core/src/sql/schema.sql", "services/core/src/runtime.ts", "services/core/src/lib/clock.ts", "CONSTITUTION.md",
];
const CODE = /\.(ts|tsx|py|sql|mjs)$/;

const git = (cmd: string) => execSync(cmd, { encoding: "utf8" }).split("\n").map((l) => l.trim()).filter(Boolean);
const files = process.argv.slice(2).length ? process.argv.slice(2) : [...new Set([...git("git diff --name-only HEAD"), ...git("git ls-files --others --exclude-standard")])];
if (!files.length) {
  console.log("no changes against HEAD");
  process.exit(0);
}

const code = files.filter((f) => CODE.test(f));
const areas = new Set(code.map((f) => f.split("/").slice(0, f.startsWith("services/core/src/") ? 4 : 2).join("/")));
const prot = files.filter((f) => PROTECTED.some((p) => f.startsWith(p)));
const mode = prot.length ? "C" : areas.size > 1 || code.length > 3 ? "B" : "A";
const suites = ALL.filter((s) => s.covers.some((c) => files.some((f) => f.startsWith(c))));
const byTier = (t: string) => suites.filter((s) => s.tier === t).map((s) => s.name);

console.log(`mode ${mode}: ${files.length} files, ${code.length} code${prot.length ? `; protected: ${prot.join(", ")}` : ""}`);
console.log("every change: pnpm typecheck && npm run lint:changed && npm run docs:check");
if (files.some((f) => f.startsWith("packages/contracts/") || f.endsWith("schema.sql") || f === ".env.example" || f === "services/core/src/mind/dsl.ts")) console.log("catalogs changed: npm run docs:gen");
const fast = byTier("fast");
const slow = byTier("slow");
if (fast.length) console.log(`fast: npm run e2e -- ${fast.join(" ")}`);
if (slow.length && mode !== "A") console.log(`slow (mode ${mode}): npm run e2e -- ${slow.join(" ")}`);
if (slow.length && mode === "A") console.log(`slow suites cover this but mode A skips them: ${slow.join(", ")}`);
const later = [...byTier("soak"), ...byTier("milestone")];
if (later.length) console.log(`soak/milestone, only when asked: ${later.join(", ")}`);
if (!suites.length && code.length) console.log("no suite covers these paths: add the path to a suite's covers, or say which check proves the change");
