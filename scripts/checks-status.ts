// Which task files have their check passed on the code as it is now (docs/WORKFLOW.md section 2). Reads docs/tasks/*.md (the suites in each
// Acceptance section) and the newest artifacts/e2e/<suite>/*/report.json; stores nothing.
// npm run checks:status
import fs from "node:fs";
import path from "node:path";
import { codeTree } from "../tests/e2e/lib/artifact.ts";

const tree = codeTree(); // the code on disk now; a report counts only if it tested this exact code
const dir = "docs/tasks";
const latest = (suite: string) => {
  const root = path.join("artifacts/e2e", suite);
  if (!fs.existsSync(root)) return null;
  const run = fs.readdirSync(root).filter((r) => fs.existsSync(path.join(root, r, "report.json"))).sort().at(-1);
  return run ? (JSON.parse(fs.readFileSync(path.join(root, run, "report.json"), "utf8")) as { pass: boolean; skipped?: string | null; duration_ms: number; inputs: { commit: string; code_tree?: string } }) : null;
};

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md") && !x.startsWith("_")).sort()) {
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  const section = (name: string) => text.split(`## ${name}\n`)[1]?.split("\n## ")[0]?.trim() ?? "";
  const suites = [...section("Acceptance").matchAll(/npm run e2e -- ([a-z0-9 -]+)/g)].flatMap((m) => m[1]!.trim().split(/\s+/));
  const state = section("State").split("\n")[0];
  const results = suites.map((s) => {
    const r = latest(s);
    if (!r) return `${s}: never run`;
    const verdict = r.skipped ? "skip" : r.pass ? "pass" : "FAIL";
    return `${s}: ${verdict}${r.inputs.code_tree === tree ? "" : ` on older code (${r.inputs.commit})`}, ${(r.duration_ms / 1000).toFixed(0)} s`;
  });
  const done = suites.length > 0 && suites.every((s) => {
    const r = latest(s);
    return r?.pass && !r.skipped && r.inputs.code_tree === tree;
  });
  console.log(`${done ? "PASSED " : "pending"} ${f.replace(/\.md$/, "")} [${state}]${results.length ? `\n         ${results.join("\n         ")}` : "  (no e2e suite in Acceptance)"}`);
}
