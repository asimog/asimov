// Rug feed (docs/UI.md /integrity, docs/SYSTEM.md section 10): each coin block shows observed, computed and AI judgment apart,
// in that order, with the API's numbers; no reply author's handle or wallet reaches the page; nothing says "scam".
import { connect } from "../../../../services/core/src/lib/db.ts";
import { Browser, getJson, pageChecks, servers, VIEWPORTS, WEB } from "../../lib/site.ts";
import type { Suite } from "../../lib/suite.ts";

type Feed = { coins: { mint: string; observed: unknown[]; computed: { score: number } | null; ai_judgment: { stance: string } | null }[] };

export const suite: Suite = {
  name: "site-rugfeed",
  tier: "milestone",
  covers: ["apps/web/app/integrity/", "services/relay/src/rug-feed.ts"],
  proves: "Every rug feed coin on /integrity matches /v1/rugfeed (count, score, report count, stance), its three evidence classes sit in separate blocks in order, and no reply handle or wallet from the Tape appears in the feed, and no word 'scam' on the page.",
  async run() {
    const up = await servers();
    if (!up.pass) return { checks: [up], metrics: {} };
    const sql = connect(undefined, 2);
    const b = await Browser.open();
    try {
      const ready = `document.querySelector("[data-rugfeed]") !== null`;
      const checks = [up, ...(await pageChecks(b, "site-rugfeed", "/integrity", ready))];
      await b.viewport(VIEWPORTS.desktop);
      await b.goto(`${WEB}/integrity`);
      await b.until(ready);
      const api = await getJson<Feed>("/v1/rugfeed");
      const page = await b.eval<{ mint: string; classes: string[]; score: string | null; reports: number; ai: string }[]>(`[...document.querySelectorAll("[data-rugfeed] article[data-mint]")].map(a => ({
        mint: a.getAttribute("data-mint"),
        classes: [...a.querySelectorAll("[data-class]")].map(d => d.getAttribute("data-class")),
        score: a.querySelector("[data-class=computed] dd")?.textContent ?? null,
        reports: a.querySelectorAll("[data-class=observed] li").length,
        ai: a.querySelector("[data-class=ai_judgment]").textContent }))`);
      checks.push({ name: "same coins as the API, same order", pass: page.length === api.coins.length && page.every((p, i) => p.mint === api.coins[i]!.mint), detail: `${page.length} on screen, ${api.coins.length} from the API` });
      let bad = 0;
      page.forEach((p, i) => {
        const a = api.coins[i];
        if (!a) return;
        if (p.classes.join(",") !== "observed,computed,ai_judgment") bad++;
        if ((a.computed ? a.computed.score.toFixed(2) : null) !== p.score) bad++;
        if (p.reports !== a.observed.length) bad++;
        if (a.ai_judgment && !p.ai.includes(`The model judged the coin ${a.ai_judgment.stance}`)) bad++;
      });
      checks.push({ name: "each coin: three classes in order, numbers equal the API", pass: bad === 0, detail: `${bad} mismatches` });
      const main = await b.text("main");
      const feed = await b.text("[data-rugfeed]"); // the caller ledger below names callers by handle on purpose
      const authors = (await sql`select distinct body->>'handle' h, body->>'wallet' w from tape.events where topic = 'callout.reply' and seen_time > now() - interval '24 hours' limit 2000`)
        .flatMap((r) => [r.h as string | null, r.w as string | null]).filter((x): x is string => !!x && x.length >= 4);
      const leaked = authors.filter((x) => feed.includes(x));
      checks.push({ name: "no reply author handle or wallet in the rug feed", pass: leaked.length === 0, detail: `${authors.length} authors checked, ${leaked.length} leaked${leaked[0] ? ` (${leaked[0]})` : ""}` });
      checks.push({ name: "no accusation words", pass: !/\bscam/i.test(main), detail: "searched for scam" });
      checks.push({ name: "rug feed shows coins, or says why it is empty", pass: api.coins.length > 0 || main.includes("No coin at or past a risk floor"), detail: `${api.coins.length} coins` });
      return { checks, metrics: { coins: api.coins.length, with_reports: api.coins.filter((c) => c.observed.length).length } };
    } finally {
      await b.close();
      await sql.end({ timeout: 2 });
    }
  },
};
