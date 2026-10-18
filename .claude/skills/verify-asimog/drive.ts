// verify-asimog driver: start, check and drive the site the way a visitor does. Reuses the e2e Chrome driver
// (tests/e2e/lib/site.ts). Reads only: the site takes no input and the relay's database connection is read-only.
// Usage: npx tsx .claude/skills/verify-asimog/drive.ts <up | doctor | page | down> [...]
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Browser, RELAY, VIEWPORTS, WEB } from "../../../tests/e2e/lib/site.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const OUT = path.join(ROOT, "artifacts", "verify", process.env.VERIFY_RUN ?? new Date().toISOString().slice(0, 10));
const STACK = path.join(ROOT, "artifacts", "verify", "stack.json");
const [cmd, ...args] = process.argv.slice(2);

const ok = async (url: string) => fetch(url).then((r) => r.ok, () => false);
const wait = async (url: string, ms: number) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 1000))) if (await ok(url)) return true;
  return false;
};

async function up() {
  const started: { name: string; pid: number }[] = [];
  for (const [name, url, ready] of [["relay", RELAY, `${RELAY}/health`], ["web", WEB, WEB]] as const) {
    if (await ok(ready)) {
      console.log(`${name}: already up at ${url}, attaching (not ours, never stop it)`);
      continue;
    }
    fs.mkdirSync(OUT, { recursive: true });
    const logFile = fs.openSync(path.join(OUT, `${name}.log`), "a");
    const p = spawn("npm", ["run", name], { cwd: ROOT, shell: true, detached: true, stdio: ["ignore", logFile, logFile] });
    p.unref();
    started.push({ name, pid: p.pid! });
    const ready_ = await wait(ready, name === "web" ? 120_000 : 30_000);
    console.log(`${name}: started pid ${p.pid}, ${ready_ ? "ready" : "NOT READY"} at ${url} (log ${path.join(OUT, `${name}.log`)})`);
    if (!ready_) process.exitCode = 1;
  }
  if (started.length) fs.writeFileSync(STACK, JSON.stringify(started));
}

function down() {
  if (!fs.existsSync(STACK)) return console.log("nothing started by verify-asimog; nothing to stop");
  for (const { name, pid } of JSON.parse(fs.readFileSync(STACK, "utf8")) as { name: string; pid: number }[]) {
    try {
      execSync(process.platform === "win32" ? `taskkill /PID ${pid} /T /F` : `kill -- -${pid}`, { stdio: "ignore" });
      console.log(`${name}: stopped pid ${pid}`);
    } catch {
      console.log(`${name}: pid ${pid} already gone`);
    }
  }
  fs.rmSync(STACK);
}

async function doctor() {
  const rows: [string, boolean, string][] = [];
  const health = await fetch(`${RELAY}/health`).then((r) => r.json() as Promise<{ ok: boolean; viewers: number }>, () => null);
  rows.push(["relay answers /health", !!health?.ok, `${RELAY} ${JSON.stringify(health)}`]);
  rows.push(["web answers /", await ok(WEB), WEB]);
  const snap = await fetch(`${RELAY}/v1/snapshot`).then((r) => r.json() as Promise<{ now: number; mode: string; coins: unknown[] }>, () => null);
  rows.push(["mode is paper", snap?.mode === "paper", `mode ${snap?.mode}`]);
  const age = snap ? Math.round((Date.now() - snap.now) / 60000) : Number.NaN;
  // a stale tape still renders, but live rooms (Field, Cortex) then show an old hour; say so rather than fail
  rows.push(["tape head is fresh (core is writing)", age <= 10, `head ${snap ? new Date(snap.now).toISOString() : "?"}, ${age} min old, ${snap?.coins.length ?? 0} coins in the last hour`]);
  rows.push(["Chrome or Edge found", ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", process.env.CHROME_PATH ?? ""].some((p) => p && fs.existsSync(p)), process.env.CHROME_PATH ?? "default paths"]);
  rows.push(["started by verify-asimog", fs.existsSync(STACK), fs.existsSync(STACK) ? fs.readFileSync(STACK, "utf8") : "no: attached to the owner's servers (read-only, fine to drive, never stop)"]);
  // freshness and ownership (rows 3 and 5) are notes; the rest are fatal
  rows.forEach(([n, p, d], i) => console.log(`${p ? "ok  " : i === 3 || i === 5 ? "note" : "FAIL"} ${n}: ${d}`));
  if (rows.some(([, p], i) => !p && i !== 3 && i !== 5)) process.exitCode = 1;
}

/** Steps run in order: --phone, --wait JS, --click SEL, --set SEL=VALUE, --eval JS, --shot NAME. */
async function page() {
  // routes go without a leading slash ("rewind", "case/<id>", "field" for /): Git Bash rewrites "/rewind" into a Windows path
  const route = !args[0] || args[0] === "field" ? "/" : `/${args[0].replace(/^\/+/, "")}`;
  const name = (route === "/" ? "field" : route.replace(/\W+/g, "-").replace(/^-|-$/g, "")) + (args.includes("--phone") ? "-phone" : "");
  fs.mkdirSync(OUT, { recursive: true });
  const b = await Browser.open();
  const steps: { step: string; arg: string; result: unknown }[] = [];
  let failed = false;
  try {
    await b.viewport(args.includes("--phone") ? VIEWPORTS.phone : VIEWPORTS.desktop);
    await b.goto(`${WEB}${route}`);
    const ready = await b.until(`!!document.querySelector("main")`, 20_000);
    steps.push({ step: "goto", arg: `${WEB}${route}`, result: ready });
    failed ||= !ready;
    for (let i = 1; i < args.length; i++) {
      const [flag, arg = ""] = [args[i]!, args[i + 1]];
      if (flag === "--phone") continue;
      i++;
      let result: unknown;
      if (flag === "--wait") failed ||= !(result = await b.until(arg, 20_000));
      else if (flag === "--click") result = await b.eval(`(() => { const e = document.querySelector(${JSON.stringify(arg)}); if (!e) return false; e.click(); return true; })()`);
      else if (flag === "--set") {
        const [sel, value] = [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)];
        // the React-safe way to change an input: native setter, then an input event
        result = await b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
      } else if (flag === "--eval") result = await b.eval(arg);
      else if (flag === "--shot") result = await b.shot(path.join(OUT, `${name}-${arg}.png`));
      else throw new Error(`unknown step ${flag}`);
      if ((flag === "--click" || flag === "--set") && result === false) failed = true;
      steps.push({ step: flag.slice(2), arg, result });
    }
    await new Promise((r) => setTimeout(r, 800));
    const shot = await b.shot(path.join(OUT, `${name}.png`));
    const text = await b.text("main");
    fs.writeFileSync(path.join(OUT, `${name}.txt`), text);
    const report = { url: `${WEB}${route}`, at: new Date().toISOString(), viewport: args.includes("--phone") ? "phone" : "desktop", steps, console_errors: b.console_errors, screenshot: shot, failed: failed || b.console_errors.length > 0 };
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, main_text: text.slice(0, 400) }, null, 2));
    if (report.failed) process.exitCode = 1;
  } finally {
    await b.close();
  }
}

if (cmd === "up") await up();
else if (cmd === "down") down();
else if (cmd === "doctor") await doctor();
else if (cmd === "page") await page();
else {
  console.error("usage: drive.ts up | doctor | page <route> [--phone] [--wait JS] [--click SEL] [--set SEL=VALUE] [--eval JS] [--shot NAME] | down");
  process.exitCode = 2;
}
