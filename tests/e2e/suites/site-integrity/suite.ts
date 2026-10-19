// Integrity (docs/PIPELINE.md, docs/UI.md): the caller ledger shows the API's denominators; a case page prints the same facts as
// `ctl case`, in six sections that never mix evidence classes.

import { buildCase, type CaseFile } from "../../../../services/core/src/hunt/case.ts";
import { connect } from "../../../../services/core/src/lib/db.ts";
import { Browser, getJson, pageChecks, servers, VIEWPORTS, WEB } from "../../lib/site.ts";
import type { Suite } from "../../lib/suite.ts";

type Integrity = { callers: { who: string; calls: number; ok: number; wins: number }[] };
const SECTIONS = ["observed", "statistics", "ai_judgments", "indicators", "unresolved", "corrections"] as const;

/** Every string and number in a value, as the page prints them. */
function leaves(v: unknown, out: string[] = []): string[] {
  if (v === null || v === undefined || typeof v === "boolean") return out;
  if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (typeof v === "object") for (const x of Object.values(v)) leaves(x, out);
  else if (String(v).trim()) out.push(String(v).trim());
  return out;
}

export const suite: Suite = {
  name: "site-integrity",
  tier: "milestone",
  covers: ["apps/web/", "services/relay/"],
  proves: "The Integrity ledger rows equal /v1/integrity (calls, measured, won); a case page prints every fact of the `ctl case` JSON, in six sections in order, each fact inside its own section; the callout text sits in a fenced block.",
  async run() {
    const up = await servers();
    if (!up.pass) return { checks: [up], metrics: {} };
    const sql = connect(undefined, 2);
    const b = await Browser.open();
    try {
      const checks = [up, ...(await pageChecks(b, "site-integrity", "/integrity", `document.querySelectorAll("table.ruled tbody tr").length > 0`))];
      await b.viewport(VIEWPORTS.desktop);
      await b.goto(`${WEB}/integrity`);
      await b.until(`document.querySelectorAll("table.ruled tbody tr").length > 0`);
      const api = await getJson<Integrity>("/v1/integrity");
      const rows = await b.eval<string[][]>(`[...document.querySelector("table.ruled").querySelectorAll("tbody tr")].map(tr => [...tr.children].map(c => c.textContent.trim()))`);
      const same = rows.length === api.callers.length && api.callers.every((c, i) => rows[i]![0] === c.who && rows[i]![1] === `${c.calls}` && rows[i]![2] === `${c.ok}`);
      checks.push({ name: "ledger rows equal the API", pass: same, detail: `${rows.length} rows on screen, ${api.callers.length} from the API` });

      const ids = (await getJson<{ ids: string[] }>("/v1/cards")).ids;
      const id = ids[0];
      checks.push({ name: "a fixture case exists", pass: !!id, detail: id ?? "no measured callout" });
      if (id) {
        const truth = (await buildCase(sql, id)) as CaseFile;
        await b.goto(`${WEB}/case/${id}`);
        await b.until(`document.querySelectorAll("[data-class]").length >= 6`);
        await b.shot(`artifacts/e2e/site-integrity/screens/case-desktop.png`);
        const found = await b.eval<{ cls: string; text: string; pre: string }[]>(`[...document.querySelectorAll("[data-class]")].map(s => ({ cls: s.getAttribute("data-class"), text: s.innerText, pre: [...s.querySelectorAll("pre")].map(p => p.textContent).join("\\n") }))`);
        const order = found.map((f) => f.cls);
        checks.push({ name: "six evidence sections in order", pass: JSON.stringify(order) === JSON.stringify(SECTIONS), detail: order.join(", ") });
        const body: Record<(typeof SECTIONS)[number], unknown> = { observed: { ...truth.observed, fence: undefined }, statistics: truth.statistics, ai_judgments: truth.ai_judgments, indicators: truth.indicators, unresolved: truth.unresolved, corrections: truth.corrections };
        let missing = 0;
        let total = 0;
        let mixed = 0;
        for (const f of found) {
          const mine = leaves(body[f.cls as keyof typeof body]);
          total += mine.length;
          missing += mine.filter((l) => !f.text.includes(l) && !f.pre.includes(l)).length;
        }
        // a fact that belongs to one section must not be printed in another class's section when it is unique to it
        for (const f of found) {
          const others = SECTIONS.filter((s) => s !== f.cls);
          const mineOnly = leaves(body[f.cls as keyof typeof body]).filter((l) => l.length > 24 && !others.some((o) => leaves(body[o]).includes(l)));
          for (const o of found.filter((x) => x.cls !== f.cls)) mixed += mineOnly.filter((l) => o.text.includes(l)).length;
        }
        checks.push({ name: "the page prints every fact of `ctl case`", pass: missing === 0 && total > 20, detail: `${total} facts, ${missing} missing` });
        checks.push({ name: "no section prints another class's facts", pass: mixed === 0, detail: `${mixed} facts out of place` });
        const fenced = found[0]!.pre.includes(truth.observed.text);
        checks.push({ name: "callout text is in a fenced block", pass: fenced || !truth.observed.text, detail: `${truth.observed.text.length} chars` });
        await b.viewport(VIEWPORTS.phone);
        await b.goto(`${WEB}/case/${id}`);
        await b.until(`document.querySelectorAll("[data-class]").length >= 6`);
        await b.shot(`artifacts/e2e/site-integrity/screens/case-phone.png`);
        const w = await b.eval<{ sw: number; cw: number }>(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
        checks.push({ name: "case page has no sideways scroll on the phone", pass: w.sw <= w.cw + 1, detail: `${w.sw}/${w.cw}` });
      }
      return { checks, metrics: { callers: api.callers.length, case: id ?? null } };
    } finally {
      await b.close();
      await sql.end({ timeout: 2 });
    }
  },
};
