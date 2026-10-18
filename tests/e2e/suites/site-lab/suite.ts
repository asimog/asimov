// The Lab (docs/11): counters and the arc show what /v1/lab says; theses show their real commit hashes.
import type { Suite } from "../../lib/suite.ts";
import { Browser, VIEWPORTS, WEB, getJson, pageChecks, servers } from "../../lib/site.ts";

type Lab = { total: number; revealed: number; items: { sha: string; matches: boolean | null; revealed: number | null; thesis: unknown }[] };

export const suite: Suite = {
  name: "site-lab",
  proves: "The Lab's committed, revealed and mismatch counters equal the API; the arc draws one commit mark per item and one ray per reveal; every thesis card prints its commit hash prefix.",
  async run() {
    const up = await servers();
    if (!up.pass) return { checks: [up], metrics: {} };
    const b = await Browser.open();
    try {
      const ready = `document.querySelectorAll(".room-kpis .num").length >= 3 && document.querySelector(".room-kpis .num").textContent !== "·"`;
      const checks = [up, ...(await pageChecks(b, "site-lab", "/lab", ready))];
      await b.viewport(VIEWPORTS.desktop);
      await b.goto(`${WEB}/lab`);
      await b.until(ready);
      const lab = await getJson<Lab>("/v1/lab");
      const kpi = await b.eval<string[]>(`[...document.querySelectorAll(".room-kpis .num")].map(e => e.textContent)`);
      const bad = lab.items.filter((i) => i.matches === false).length;
      checks.push({ name: "counters equal the API", pass: kpi.join("/") === [lab.total, lab.revealed, bad].join("/"), detail: `screen ${kpi.join("/")}, api ${lab.total}/${lab.revealed}/${bad}` });
      const marks = await b.eval<{ commits: number; rays: number }>(`({ commits: document.querySelectorAll(".lab-arc .arc-commit").length, rays: document.querySelectorAll(".lab-arc .arc-ray").length })`);
      const rays = lab.items.filter((i) => i.revealed).length;
      checks.push({ name: "arc draws one mark per commit and one ray per reveal", pass: marks.commits === lab.items.length && marks.rays === rays, detail: `screen ${marks.commits} marks, ${marks.rays} rays; api ${lab.items.length} items, ${rays} revealed` });
      const theses = lab.items.filter((i) => i.thesis).slice(0, 12);
      const hashes = await b.eval<string[]>(`[...document.querySelectorAll(".thesis-plan .mono")].map(e => e.textContent)`);
      checks.push({ name: "thesis cards print real commit hashes", pass: hashes.length === theses.length && hashes.every((h, i) => h === theses[i]!.sha.slice(0, 16)), detail: `${hashes.length} cards, api ${theses.length} theses` });
      return { checks, metrics: { total: lab.total, revealed: lab.revealed, mismatches: bad } };
    } finally {
      await b.close();
    }
  },
};
