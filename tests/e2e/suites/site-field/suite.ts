// The Field (docs/UI.md): the numbers on screen are the relay snapshot's numbers; the strip's tape lines are real tape lines.
import { connect } from "../../../../services/core/src/lib/db.ts";
import type { Suite } from "../../lib/suite.ts";
import { Browser, VIEWPORTS, WEB, getJson, pageChecks, servers } from "../../lib/site.ts";

type Snap = { mode: string; mandate_sol: number; milestone: string; pool: { alive: number; open: number; net: number; commits: number }; coins: { mint: string }[]; graduated: string[]; edges: unknown[]; tape: { text: string }[] };

export const suite: Suite = {
  name: "site-field",
  tier: "milestone",
  covers: ["apps/web/", "services/relay/"],
  proves: "The Field's HUD numbers, region captions and caller-link count equal the relay snapshot; every tape line in the strip is a line the relay served; every motion cue the scene drew names an event that exists on the Tape; a canvas is drawn or the no-WebGL line is shown.",
  async run() {
    const up = await servers();
    if (!up.pass) return { checks: [up], metrics: {} };
    const b = await Browser.open();
    try {
      const checks = [up, ...(await pageChecks(b, "site-field", "/", `document.querySelectorAll(".hud .kpi").length > 0 && document.querySelectorAll(".hud .kpi[data-loading]").length === 0`))];
      await b.viewport(VIEWPORTS.desktop);
      await b.goto(`${WEB}/`);
      await b.until(`document.querySelectorAll(".hud .kpi").length > 0 && document.querySelectorAll(".hud .kpi[data-loading]").length === 0`);
      const before = await getJson<Snap>("/v1/snapshot");
      const kpi = await b.eval<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll(".hud .kpi")].map(k => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]))`);
      const after = await getJson<Snap>("/v1/snapshot");
      // the page may have refreshed its snapshot between our two reads; the on-screen value must equal one of them
      const eq = (k: string, f: (s: Snap) => string) => ({ name: `HUD ${k} equals the API`, pass: [before, after].some((s) => f(s) === kpi[k]), detail: `screen "${kpi[k]}", api "${f(before)}"` });
      const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(3)} SOL`;
      checks.push(
        eq("Mode", (s) => s.mode.toUpperCase()),
        eq("Mandate", (s) => `${s.mandate_sol} SOL`),
        eq("Milestone", (s) => s.milestone),
        eq("Strategies", (s) => `${s.pool.alive}`),
        eq("Open", (s) => `${s.pool.open}`),
        eq("Pool net, paper", (s) => signed(s.pool.net)),
        eq("Commits", (s) => `${s.pool.commits}`),
      );
      const regions = await b.eval<string[]>(`[...document.querySelectorAll(".field-region")].map(e => e.textContent)`);
      const grads = new Set(before.graduated);
      const onCurve = before.coins.filter((c) => !grads.has(c.mint)).length;
      const grad = before.coins.filter((c) => grads.has(c.mint)).length;
      checks.push({ name: "region captions count the snapshot's coins", pass: regions.some((r) => r.includes(`${onCurve} coins`)) && regions.some((r) => r.includes(`${grad} coins`)), detail: `${regions.join(" | ")}; api ${onCurve} on curve, ${grad} graduated` });
      const links = await b.eval<string>(`[...document.querySelectorAll(".field-legend div")].find(d => d.textContent.startsWith("Caller links"))?.querySelector("dd").textContent`);
      checks.push({ name: "caller link count equals the API", pass: links === `${before.edges.length}`, detail: `screen ${links}, api ${before.edges.length}` });
      const lines = await b.eval<string[]>(`[...document.querySelectorAll(".strip .tape-text")].map(e => e.textContent)`);
      const known = new Set(before.tape.map((t) => t.text));
      const stray = lines.filter((l) => !known.has(l));
      checks.push({ name: "strip tape lines are lines the relay served", pass: stray.length === 0, detail: `${lines.length} lines checked, ${stray.length} stray${stray[0] ? `: ${stray[0]}` : ""}` });
      // S5.4: every motion maps to a tape event. Scenes move only on cues; each cue carries the id of the event that caused it.
      await new Promise((r) => setTimeout(r, Number(process.env.E2E_FIELD_WATCH_MS ?? 15_000)));
      const log = await b.eval<{ seq: number; event: string; kind: string }[]>(`window.__asimogCueLog ?? []`);
      const sql = connect(undefined, 1);
      const ids = [...new Set(log.map((c) => c.event))];
      const found = ids.length ? new Set((await sql`select id from tape.events where id = any(${ids})`).map((r) => r.id as string)) : new Set<string>();
      await sql.end({ timeout: 2 });
      const orphans = log.filter((c) => !c.event || !found.has(c.event));
      checks.push({ name: "every motion cue maps to an event on the Tape", pass: orphans.length === 0, detail: `${log.length} cues from ${ids.length} events watched, ${orphans.length} without a tape event${log.length ? "" : " (the stream was quiet: nothing moved)"}` });
      const canvas = await b.eval<boolean>(`!!document.querySelector(".field canvas")`);
      const fallback = await b.eval<boolean>(`!!document.querySelector(".field-fallback")`);
      checks.push({ name: "a canvas is drawn or the no-WebGL line is shown", pass: canvas || fallback, detail: canvas ? "canvas" : "fallback line" });
      return { checks, metrics: { coins: before.coins.length, edges: before.edges.length, tape_lines: before.tape.length } };
    } finally {
      await b.close();
    }
  },
};
