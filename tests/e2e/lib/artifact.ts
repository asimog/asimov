// Artifacts (docs/OPS.md): report.json, report.html, sha256.txt per suite run under artifacts/e2e/<suite>/<run-id>/.
// sha256.txt hashes report.json without volatile fields, so the same tape + commit + config gives the same hash.
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redact } from "../../../services/core/src/lib/env.ts";
import type { Check } from "./checks.ts";

const VOLATILE = new Set(["run_id", "started_at", "ms", "db", "artifact_dir", "duration_ms"]);

function stable(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(stable);
  if (x && typeof x === "object")
    return Object.fromEntries(Object.keys(x).filter((k) => !VOLATILE.has(k)).sort().map((k) => [k, stable((x as Record<string, unknown>)[k])]));
  return x;
}

export function inputs(tapeFile?: string) {
  const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() + (execSync("git status --porcelain services packages tests", { encoding: "utf8" }).trim() ? "+dirty" : "");
  } catch {}
  const cfg = redact();
  for (const k of Object.keys(cfg)) if (/KEY|PASS|TOKEN|SECRET|SEED|URL/.test(k)) delete cfg[k];
  return { tape: tapeFile ? { file: tapeFile, sha256: sha(fs.readFileSync(tapeFile)) } : null, commit, config_sha256: sha(JSON.stringify(stable(cfg))) };
}

export type Report = {
  suite: string;
  proves: string;
  run_id: string;
  started_at: string;
  duration_ms: number;
  inputs: ReturnType<typeof inputs>;
  checks: Check[];
  metrics: Record<string, unknown>;
  pass: boolean;
};

/** `files` are extra outputs (for example a case file); their hashes go into the report, so `sha256.txt` covers them. */
export function write(r: Omit<Report, "pass">, files: Record<string, string> = {}): Report & { artifact_dir: string; sha256: string } {
  const sha = (x: string) => crypto.createHash("sha256").update(x).digest("hex");
  const metrics = Object.keys(files).length ? { ...r.metrics, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])) } : r.metrics;
  const report: Report = { ...r, metrics, pass: r.checks.every((c) => c.pass) };
  const dir = path.join("artifacts", "e2e", r.suite, r.run_id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  fs.writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const digest = crypto.createHash("sha256").update(JSON.stringify(stable(report))).digest("hex");
  fs.writeFileSync(path.join(dir, "sha256.txt"), `${digest}\n`);
  fs.writeFileSync(path.join(dir, "report.html"), html(report, digest));
  return { ...report, artifact_dir: dir, sha256: digest };
}

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function table(o: unknown): string {
  if (o === null || typeof o !== "object") return `<code>${esc(typeof o === "number" ? +o.toFixed(6) : o)}</code>`;
  if (Array.isArray(o)) {
    if (o.length && o.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      const cols = [...new Set(o.flatMap((x) => Object.keys(x)))];
      return `<table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${o.map((x) => `<tr>${cols.map((c) => `<td>${table((x as Record<string, unknown>)[c] ?? "")}</td>`).join("")}</tr>`).join("")}</table>`;
    }
    return o.map(table).join(" ");
  }
  return `<table>${Object.entries(o).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${table(v)}</td></tr>`).join("")}</table>`;
}

function html(r: Report, digest: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.suite)}</title>
<style>
:root{--paper:#f3efe6;--ink:#1d1a16;--muted:#6f675c;--rule:#d8d0c2;--pass:#2f6b4f;--fail:#b4321f}
@media (prefers-color-scheme:dark){:root{--paper:#14120f;--ink:#ece6da;--muted:#9a917f;--rule:#2c2822}}
body{background:var(--paper);color:var(--ink);font:14px/1.5 "IBM Plex Sans",system-ui,sans-serif;margin:0;padding:32px 16px;max-width:1100px;margin-inline:auto}
h1{font:600 22px "IBM Plex Sans Condensed",sans-serif;letter-spacing:.02em;margin:0 0 4px}
p{color:var(--muted);margin:0 0 24px}code,td,th{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px}
table{border-collapse:collapse;width:100%;margin:4px 0}th,td{border-bottom:1px solid var(--rule);text-align:left;padding:4px 8px;vertical-align:top}
th{color:var(--muted);font-weight:500}.pass{color:var(--pass)}.fail{color:var(--fail)}h2{font:600 13px "IBM Plex Mono",monospace;text-transform:uppercase;letter-spacing:.08em;margin:32px 0 8px}
div{overflow-x:auto}
</style>
<h1>${esc(r.suite)} <span class="${r.pass ? "pass" : "fail"}">${r.pass ? "PASS" : "FAIL"}</span></h1>
<p>${esc(r.proves)}<br>sha256 ${digest.slice(0, 16)} · run ${esc(r.run_id)} · ${r.duration_ms} ms</p>
<h2>Checks</h2><div><table>${r.checks.map((c) => `<tr><td class="${c.pass ? "pass" : "fail"}">${c.pass ? "pass" : "FAIL"}</td><th>${esc(c.name)}</th><td>${esc(c.detail)}</td></tr>`).join("")}</table></div>
<h2>Inputs</h2><div>${table(r.inputs)}</div>
<h2>Metrics</h2><div>${table(r.metrics)}</div>
</html>`;
}
