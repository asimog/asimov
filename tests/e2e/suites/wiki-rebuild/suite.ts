// The wiki (E3): a page rebuilds byte-identical from the same data, a new version is written only when a number changes,
// an old version still rebuilds as of its time, prose passes the public-text check, and the export writes markdown.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalTarget } from "../../../../services/core/src/tape/targets.ts";
import { exportWiki, gatherPages, type PageData, rebuildCheck, renderPage, wikiBuilder } from "../../../../services/core/src/wiki/wiki.ts";
import { CAP, MINT_B, slowEnv, WALLETS } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export const suite: Suite = {
  name: "wiki-rebuild",
  tier: "fast",
  covers: ["services/core/src/wiki/", "services/core/src/mcp/toolbox.ts", "services/relay/src/wiki.ts"],
  proves: "A wiki page rebuilds byte-identical from the same data, versions only when its numbers change, and its prose passes the public-text check.",
  async run() {
    const w = await slowEnv("wiki");
    try {
      const spec = await w.seed();
      const b = wikiBuilder(w.tape, w.clock);
      let n = 0;
      const build = (at: string) => w.sql.begin((tx) => b.handle([{ id: `ev_idx_${++n}`, topic: "index.refreshed", seen_time: at } as never], tx as never));
      const t1 = new Date(w.clock.now() - 5 * 60_000).toISOString();
      await build(t1);
      const v1 = await w.sql`select slug, version, sha256 from wiki.pages order by slug`;
      await build(new Date(w.clock.now() - 4 * 60_000).toISOString());
      const same = await w.sql`select count(*)::int n from wiki.pages`;
      const slug = `coin-${MINT_B}`;
      const check1 = await rebuildCheck(w.sql, slug, 1);
      const fromSource = (await gatherPages(w.sql, t1)).find((p) => p.slug === slug)!;
      // a new position on the coin changes a number: one new version, and version 1 still rebuilds as of its time
      const t3 = new Date(w.clock.now() - 2 * 60_000).toISOString();
      await w.sql`insert into mind.positions (id, strategy_id, mint, opened_at, tokens, tokens_left, cost_sol, rent_sol, entry_price, exit_bands)
                  values ('ps_new', ${spec.id}, ${MINT_B}, ${new Date(w.clock.now() - 3 * 60_000).toISOString()}, 500, 500, 0.01, 0.002, 0.00002, '[]'::jsonb)`;
      await build(t3);
      const v2 = await w.sql`select version from wiki.pages where slug = ${slug} order by version`;
      const check1again = await rebuildCheck(w.sql, slug, 1);
      const check2 = await rebuildCheck(w.sql, slug, 2);
      const asOfT1 = sha(renderPage((await gatherPages(w.sql, t1)).find((p) => p.slug === slug)!));
      // prose: the Wiki writer's tool refuses a wallet address, keeps clean prose once
      const wk = w.inProc(CAP.wiki);
      const refused = await wk.call("write_wiki_prose", { slug, version: 2, text: `This coin was bought by ${WALLETS[0]} early and the numbers say little yet.` }).then(() => "stored", (e: Error) => e.message);
      const kept = await wk.call("write_wiki_prose", { slug, version: 2, text: "Two paper positions so far, one closed at a small loss. Too few trades to judge the coin." }).then(() => "stored", (e: Error) => e.message);
      const dup = await wk.call("write_wiki_prose", { slug, version: 2, text: "Another try at the same version, which must be refused by core." }).then(() => "stored", (e: Error) => e.message);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-"));
      const ex = await exportWiki(w.sql, [new LocalTarget(dir)]);
      const file = fs.readFileSync(path.join(dir, `${slug}.md`), "utf8");
      const caller: PageData = { kind: "caller", slug: `caller-${WALLETS[1]}`, title: "Caller 5Qe2…W0Nr", as_of: t1, horizon_min: 5, calls: 9, ok: 7, net_med: 1.08, net_win: 0.57, net_win_ci95: [0.25, 0.84], peak_med: 1.6, trough_med: 0.8, curve: 6, amm: 1, excluded: { repeat: 1, quote: 1 } };
      const cBody = renderPage(caller);
      return {
        checks: [
          { name: "the first build writes version 1", pass: v1.length === 1 && v1[0]!.version === 1, detail: v1.map((r) => `${r.slug.slice(0, 12)} v${r.version}`).join(", ") },
          { name: "the same data writes no new version", pass: same[0]!.n === 1, detail: `${same[0]!.n} rows` },
          { name: "a page rebuilds byte-identical from its stored data and from its sources as of its time", pass: check1.ok && check1.regathered === check1.sha256, detail: `${check1.sha256.slice(0, 12)} vs ${check1.again.slice(0, 12)}` },
          { name: "the source data as of the build gives the same bytes", pass: sha(renderPage(fromSource)) === check1.sha256, detail: sha(renderPage(fromSource)).slice(0, 12) },
          { name: "a changed number writes exactly one new version", pass: v2.map((r) => r.version).join() === "1,2", detail: v2.map((r) => r.version).join() },
          { name: "old and new versions both rebuild byte-identical", pass: check1again.ok && check2.ok, detail: `v1 ${check1again.ok}, v2 ${check2.ok}` },
          { name: "an as-of read of the old time still gives version 1", pass: asOfT1 === check1.sha256, detail: asOfT1.slice(0, 12) },
          { name: "prose naming a wallet is refused", pass: refused !== "stored", detail: refused },
          { name: "clean prose is stored once", pass: kept === "stored" && dup !== "stored", detail: `${kept}; again: ${dup}` },
          { name: "the export writes the page with its prose under the AI judgment label", pass: ex.files === 2 && file.includes("## AI judgment") && file.includes("Two paper positions"), detail: `${ex.files} files` },
          { name: "a caller page renders the same bytes twice and shows no full wallet", pass: cBody === renderPage(JSON.parse(JSON.stringify(caller))) && !cBody.includes(WALLETS[1]!), detail: cBody.split("\n")[0]! },
        ],
        metrics: { stats: b.stats, sample: check2.sha256 },
      };
    } finally {
      await w.close();
    }
  },
};
