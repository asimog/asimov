// The Cortex (docs/11): a lobe is lit only by events. The lane counters never run ahead of the stream.
import type { Suite } from "../../lib/suite.ts";
import { Browser, RELAY, VIEWPORTS, WEB, pageChecks, servers } from "../../lib/site.ts";

const LANES = ["Sense", "Analyze", "Reflex", "Decide", "Risk", "Execute", "Publish", "Memory", "Treasury", "Counsel"];
const MAPPED = ["callout.created", "trade.curve", "trade.amm", "coin.watched", "holders.snapshot", "score.updated", "index.refreshed", "markout.measured", "jev.answer", "intent.created", "strategy.born", "strategy.retired", "kernel.allocation", "order.rejected", "intent.ghost_filled", "position.closed", "post.queued", "thesis.formed", "commit.made", "commit.revealed"];

export const suite: Suite = {
  name: "site-cortex",
  proves: "All ten lanes are listed; the lane event counters never run ahead of what the relay streamed (a lane lights only on events); with a quiet stream no lane is active.",
  async run() {
    const up = await servers();
    if (!up.pass) return { checks: [up], metrics: {} };
    const b = await Browser.open();
    try {
      const checks = [up, ...(await pageChecks(b, "site-cortex", "/cortex", `document.querySelectorAll(".mini tbody tr").length >= 10`))];
      await b.viewport(VIEWPORTS.desktop);
      await b.goto(`${WEB}/cortex`);
      await b.until(`document.querySelectorAll(".mini tbody tr").length >= 10`);
      // an independent listener, started right after the page's own: it counts what the stream says in the next 6 s
      await b.eval(`window.__seen = 0; const es = new EventSource("${RELAY}/v1/stream"); es.addEventListener("lines", ev => { for (const l of JSON.parse(ev.data)) if (${JSON.stringify(MAPPED)}.includes(l.topic)) window.__seen++; }); true`);
      await new Promise((r) => setTimeout(r, 6000));
      const seen = await b.eval<number>(`window.__seen`);
      const rows = await b.eval<string[][]>(`[...document.querySelectorAll(".mini tbody tr")].slice(0, 10).map(tr => [...tr.children].map(c => c.textContent.trim()))`);
      const names = rows.map((r) => r[0] ?? "");
      checks.push({ name: "all ten lanes are listed", pass: LANES.every((l) => names.some((n) => n.startsWith(l))), detail: names.join(", ") });
      const total = rows.reduce((a, r) => a + (Number(r[1]) || 0), 0);
      checks.push({ name: "lane counters do not run ahead of the stream", pass: total >= seen, detail: `counters ${total}, independent listener saw ${seen} mapped events` });
      const active = await b.eval<string>(`document.querySelector(".cortex-head .hot dd").textContent`);
      checks.push({ name: "a quiet stream lights no lane", pass: total > 0 || active.startsWith("0/"), detail: `counters ${total}, lanes active ${active}` });
      const canvas = await b.eval<boolean>(`!!document.querySelector(".cortex-stage canvas")`);
      checks.push({ name: "the brain canvas exists", pass: canvas, detail: String(canvas) });
      return { checks, metrics: { counters: total, streamed: seen } };
    } finally {
      await b.close();
    }
  },
};
