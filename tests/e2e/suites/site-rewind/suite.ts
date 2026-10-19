// Rewind (S11.4): the Board at time T equals what was live at T. Checked against the database with a different query
// than the relay uses, at three times, and through the page slider.
import { connect } from "../../../../services/core/src/lib/db.ts";
import { liveFor } from "../../../../services/core/src/board/board.ts";
import type { Suite } from "../../lib/suite.ts";
import { Browser, VIEWPORTS, WEB, getJson, pageChecks, servers } from "../../lib/site.ts";

type B = { at: number; range: { from: number; to: number }; total: number; kinds: { kind: string; n: number }[]; signals: { kind: string; subject: string; produced_at: number; valid_until: number; value: unknown }[]; lines: { t: number; text: string }[] };

export const suite: Suite = {
  name: "site-rewind",
  tier: "milestone",
  covers: ["apps/web/", "services/relay/"],
  proves: "At three times T the relay's Board has exactly the signals that were live at T (per-kind counts equal an independent query; sampled subjects equal core's liveFor; none produced after T or expired); no tape line is newer than T; the page slider shows the same counts.",
  async run() {
    const up = await servers();
    if (!up.pass) return { checks: [up], metrics: {} };
    const sql = connect(undefined, 3);
    const b = await Browser.open();
    try {
      const checks = [up, ...(await pageChecks(b, "site-rewind", "/rewind", `document.querySelector("#rewind-at") && document.querySelectorAll(".rewind-kinds tbody tr").length > 0`))];
      const head = await getJson<B>("/v1/board");
      const { from, to } = head.range;
      const times = [0.25, 0.5, 0.9].map((f) => from + Math.floor(((to - from) * f) / 1000) * 1000);
      const rows: Record<string, unknown>[] = [];
      for (const at of times) {
        const t = await getJson<B>(`/v1/board?at=${at}`);
        const iso = new Date(at).toISOString();
        // independent: live rows are valid at T, and no newer valid row exists for the same kind and subject
        const truth = await sql`
          select kind, count(*)::int n from board.signals s
          where produced_at <= ${iso} and valid_until > ${iso}
            and not exists (select 1 from board.signals n where n.kind = s.kind and n.subject = s.subject and n.produced_at <= ${iso} and n.valid_until > ${iso}
              and (n.produced_at, n.id) > (s.produced_at, s.id))
          group by kind order by kind`;
        const want = truth.map((r) => `${r.kind}:${r.n}`).join(",");
        const got = [...t.kinds].sort((x, y) => (x.kind < y.kind ? -1 : 1)).map((k) => `${k.kind}:${k.n}`).join(",");
        const sample = [...new Set(t.signals.map((s) => s.subject))].slice(0, 25);
        let sampleBad = 0;
        for (const s of sample) {
          const live = await liveFor(sql, s, iso);
          const mine = t.signals.filter((x) => x.subject === s);
          if (mine.length !== Object.keys(live).length || mine.some((x) => !live[x.kind] || live[x.kind]!.produced_at.getTime() !== x.produced_at)) sampleBad++;
        }
        const future = t.signals.filter((s) => s.produced_at > at || s.valid_until <= at).length;
        const newer = t.lines.filter((l) => l.t > at).length;
        checks.push({ name: `T=${iso}: per-kind counts equal the database`, pass: want === got && t.total > 0, detail: `${t.total} live signals, ${t.kinds.length} kinds` });
        checks.push({ name: `T=${iso}: sampled subjects equal liveFor`, pass: sampleBad === 0 && sample.length > 0, detail: `${sample.length} subjects, ${sampleBad} differ` });
        checks.push({ name: `T=${iso}: nothing from after T, nothing expired`, pass: future === 0 && newer === 0, detail: `${future} signals and ${newer} lines out of range` });
        rows.push({ at: iso, total: t.total, kinds: t.kinds.length });
      }
      // the page: move the slider, read what it shows
      await b.viewport(VIEWPORTS.desktop);
      await b.goto(`${WEB}/rewind`);
      await b.until(`document.querySelector("#rewind-at") && document.querySelectorAll(".rewind-kinds tbody tr").length > 0`);
      const min = await b.eval<number>(`Number(document.querySelector("#rewind-at").min)`);
      const target = times[1]!;
      await b.eval(`(() => { const el = document.querySelector("#rewind-at"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${target}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      const shown = await b.until(`document.querySelector("[data-at]")?.getAttribute("data-at") === "${target}" && !!document.querySelector("[data-total]")`, 10_000);
      const page = await b.eval<{ total: number; kinds: string[] }>(`({ total: Number(document.querySelector("[data-total]")?.getAttribute("data-total")), kinds: [...document.querySelectorAll(".rewind-kinds tbody tr")].map(tr => tr.children[0].textContent + ":" + tr.children[1].textContent) })`);
      const api = await getJson<B>(`/v1/board?at=${target}`);
      await b.shot("artifacts/e2e/site-rewind/screens/rewind-moved.png");
      checks.push({ name: "slider at T shows the API's Board for T", pass: shown && page.total === api.total && page.kinds.slice().sort().join(",") === api.kinds.map((k) => `${k.kind}:${k.n}`).sort().join(","), detail: `page ${page.total}, api ${api.total} (slider min ${min})` });
      const seen = await b.text(".rewind-lines");
      checks.push({ name: "page shows no tape line newer than T", pass: api.lines.every((l) => l.t <= target) && api.lines.every((l) => seen.includes(l.text.slice(0, 20))), detail: `${api.lines.length} lines` });
      return { checks, metrics: { range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }, times: rows } };
    } finally {
      await b.close();
      await sql.end({ timeout: 2 });
    }
  },
};
