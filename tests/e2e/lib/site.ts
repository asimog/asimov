// Site driver (docs/14, docs/19): headless Chrome over the DevTools protocol, no dependency. agent-browser hung on the
// owner's machine, so the suites drive Chrome directly. Reads the working relay and web app; writes only artifacts.
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Check } from "./checks.ts";

export const WEB = process.env.E2E_WEB_URL ?? "http://localhost:7402";
export const RELAY = process.env.E2E_RELAY_URL ?? "http://localhost:7401";
export const VIEWPORTS = { desktop: { w: 1440, h: 900, mobile: false }, phone: { w: 390, h: 844, mobile: true } } as const;

const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && fs.existsSync(p));

export const getJson = async <T>(path_: string): Promise<T> => {
  const r = await fetch(`${RELAY}${path_}`);
  if (!r.ok) throw new Error(`relay ${path_} answered ${r.status}`);
  return (await r.json()) as T;
};

/** Both servers answer; otherwise every site suite fails with a clear line instead of a stack trace. */
export async function servers(): Promise<Check> {
  try {
    const h = await fetch(`${RELAY}/health`).then((r) => r.ok);
    const w = await fetch(WEB).then((r) => r.ok);
    return { name: "relay and web app are up", pass: h && w, detail: `${RELAY} ${h ? "ok" : "down"}, ${WEB} ${w ? "ok" : "down"}` };
  } catch (e) {
    return { name: "relay and web app are up", pass: false, detail: `${(e as Error).message}; start them with npm run relay and npm run web` };
  }
}

export class Browser {
  private proc!: ChildProcess;
  private ws!: WebSocket;
  private id = 0;
  private waiting = new Map<number, (v: any) => void>();
  private events: ((m: any) => void)[] = [];
  private dir = fs.mkdtempSync(path.join(os.tmpdir(), "asimog-e2e-"));
  console_errors: string[] = [];

  static async open(): Promise<Browser> {
    if (!CHROME) throw new Error("no Chrome or Edge found; set CHROME_PATH");
    const b = new Browser();
    const port = 9300 + Math.floor(Math.random() * 500);
    b.proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${b.dir}`, "--headless=new", "--no-first-run", "--disable-gpu-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
    let target: string | null = null;
    for (let i = 0; i < 60 && !target; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        target = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
      } catch {}
    }
    if (!target) throw new Error("Chrome did not start");
    b.ws = new WebSocket(target);
    await new Promise((res, rej) => {
      b.ws.onopen = res;
      b.ws.onerror = rej;
    });
    b.ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && b.waiting.has(m.id)) {
        b.waiting.get(m.id)!(m);
        b.waiting.delete(m.id);
      } else for (const f of b.events) f(m);
    };
    b.events.push((m) => {
      if (m.method === "Runtime.exceptionThrown") b.console_errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    });
    await b.send("Page.enable");
    await b.send("Runtime.enable");
    return b;
  }

  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${method} timed out`)), 30_000);
      this.waiting.set(id, (m) => {
        clearTimeout(t);
        m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async viewport(v: (typeof VIEWPORTS)[keyof typeof VIEWPORTS]) {
    await this.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.mobile });
  }

  async goto(url: string) {
    this.console_errors = [];
    await this.send("Page.navigate", { url });
    await this.until(`document.readyState === "complete"`, 20_000);
  }

  async eval<T = unknown>(js: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression: js, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }

  /** Poll until the expression is truthy. */
  async until(js: string, ms = 15_000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await this.eval(js)) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  text = (sel = "main") => this.eval<string>(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ""`);

  async shot(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
    this.proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

export const screens = (suite: string) => path.join("artifacts", "e2e", suite, "screens");

/** The checks every room page shares: loads on both viewports, no uncaught error, no horizontal scroll on the phone, dark. */
export async function pageChecks(b: Browser, suite: string, route: string, ready: string): Promise<Check[]> {
  const out: Check[] = [];
  const name = route === "/" ? "field" : route.replace(/\W+/g, "-").replace(/^-|-$/g, "");
  for (const [vn, v] of Object.entries(VIEWPORTS)) {
    await b.viewport(v);
    await b.goto(`${WEB}${route}`);
    const ok = await b.until(ready, 20_000);
    await new Promise((r) => setTimeout(r, 800));
    const file = await b.shot(path.join(screens(suite), `${name}-${vn}.png`));
    const m = await b.eval<{ sw: number; cw: number; bg: string }>(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bg: (() => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = getComputedStyle(document.body).backgroundColor; c.fillRect(0, 0, 1, 1); return c.getImageData(0, 0, 1, 1).data.slice(0, 3).join(","); })() })`);
    const lum = m.bg.split(",").map(Number).reduce((a, c) => a + c, 0) / 3;
    out.push({ name: `${route} ${vn}: ready`, pass: ok, detail: ok ? `${ready} (${file})` : `never became true: ${ready}` });
    out.push({ name: `${route} ${vn}: no uncaught error`, pass: b.console_errors.length === 0, detail: b.console_errors[0] ?? "none" });
    out.push({ name: `${route} ${vn}: dark, no sideways scroll`, pass: lum < 60 && m.sw <= m.cw + 1, detail: `background rgb(${m.bg}), width ${m.sw}/${m.cw}` });
  }
  return out;
}
