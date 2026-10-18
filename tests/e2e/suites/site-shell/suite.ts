// The shell (docs/19): every room loads on desktop and phone, dark, no sideways scroll, nav lists every room, footer says PAPER.
import type { Suite } from "../../lib/suite.ts";
import { Browser, VIEWPORTS, WEB, pageChecks, servers } from "../../lib/site.ts";

const ROOMS = ["/", "/cortex", "/lab", "/ledger", "/integrity", "/treasury", "/rewind", "/connectome", "/charter"];
const LABELS = ["Field", "Cortex", "Lab", "Ledger", "Integrity", "Treasury", "Rewind", "Connectome", "Charter"];

export const suite: Suite = {
  name: "site-shell",
  proves: "Every room loads on desktop and phone without an uncaught error, in the dark world, with no sideways scroll; the nav links to every room and the footer says paper trading.",
  async run() {
    const up = await servers();
    if (!up.pass) return { checks: [up], metrics: {} };
    const b = await Browser.open();
    try {
      const checks = [up];
      for (const r of ROOMS) checks.push(...(await pageChecks(b, "site-shell", r, `!!document.querySelector("main") && !!document.querySelector("footer")`)));
      await b.viewport(VIEWPORTS.desktop);
      await b.goto(`${WEB}/`);
      await b.until(`document.querySelectorAll("header.nav nav a").length > 0`);
      const nav = await b.eval<string[]>(`[...document.querySelectorAll("header.nav nav a")].map(a => a.textContent.trim())`);
      checks.push({ name: "nav lists every room", pass: LABELS.every((l) => nav.includes(l)), detail: nav.join(", ") });
      const foot = await b.text("footer");
      checks.push({ name: "footer says paper trading", pass: /paper trading/i.test(foot), detail: foot.split("\n").pop() ?? "" });
      const live = await b.until(`/last event|waiting for the first event|relay unreachable/.test(document.querySelector("header.nav .live")?.textContent ?? "")`);
      checks.push({ name: "nav shows the stream state in words", pass: live, detail: await b.text("header.nav .live") });
      return { checks, metrics: { rooms: ROOMS.length, viewports: Object.keys(VIEWPORTS) } };
    } finally {
      await b.close();
    }
  },
};
