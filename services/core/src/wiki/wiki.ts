// The wiki (E3, docs/PIPELINE.md 9): one page per measured caller and per coin the house traded. Code writes every number,
// from the caller ledger and our paper books, as they stood at the Index refresh that triggered the build. A page's body
// is a pure render of its data, so the same data gives the same bytes; a new version is written only when the bytes
// change. The Wiki writer agent adds prose later (`wiki.prose`), labelled AI judgment. The export writes markdown files
// to the configured wiki targets.
import crypto from "node:crypto";
import { type BodyOf, canonical, type Envelope } from "@asimog/contracts";
import { liveFor } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { ledger } from "../scorekeeper/ledger.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import type { ArchiveTarget } from "../tape/targets.ts";

const MIN_CALLS = env.int("WIKI_MIN_CALLS");
const MAX_CALLERS = env.int("WIKI_MAX_CALLERS");

export type PageData = Record<string, unknown> & { kind: "caller" | "coin"; slug: string; title: string; as_of: string };
type Q = Sql | Tx;

const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const f2 = (x: unknown) => (typeof x === "number" ? x.toFixed(2) : "·");
const f4 = (x: unknown) => (typeof x === "number" ? x.toFixed(4) : "·");
const pct = (x: unknown) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "·");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** The page's markdown. Pure: same data, same bytes. */
export function renderPage(d: PageData): string {
  // the build time is not in the body (it lives on the version row), so unchanged numbers give unchanged bytes
  const L = [`# ${d.title}`, "", "Numbers written by code from the caller ledger and our paper books. PAPER.", ""];
  if (d.kind === "caller") {
    L.push("| Measure | Value |", "|---|---|");
    L.push(`| Callouts seen | ${d.calls} |`, `| Measured at ${d.horizon_min} min | ${d.ok} |`, `| Median net multiple | ${f2(d.net_med)}x |`, `| Share that made money | ${pct(d.net_win)} |`);
    L.push(`| 95% range of that share | ${Array.isArray(d.net_win_ci95) ? `${pct(d.net_win_ci95[0])} to ${pct(d.net_win_ci95[1])}` : "·"} |`);
    L.push(`| Median peak multiple | ${f2(d.peak_med)}x |`, `| Median trough multiple | ${f2(d.trough_med)}x |`, `| Calls on the curve | ${d.curve} |`, `| Calls after graduation | ${d.amm} |`);
    const ex = Object.entries((d.excluded as Record<string, number>) ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    L.push("", `Not measured: ${ex.length ? ex.map(([k, v]) => `${k} ${v}`).join(", ") : "none"}.`);
  } else {
    const r = d.risk as Record<string, unknown> | null;
    L.push(`Symbol: ${d.symbol ?? "·"}`, "", "| Measure | Value |", "|---|---|");
    L.push(`| Bought in the first 3 slots | ${pct(r?.bundle_share)} |`, `| Top 10 holders, curve excluded | ${pct(r?.top10_share)} |`, `| Creator sold | ${pct(r?.creator_sold)} |`);
    L.push("", "Our paper positions:", "", "| Opened | Strategy | Cost SOL | Net SOL | Exit |", "|---|---|---|---|---|");
    for (const p of d.positions as { opened_at: string; strategy_id: string; cost_sol: number; net_sol: number | null; exit_reason: string | null }[]) {
      L.push(`| ${p.opened_at} | ${p.strategy_id} | ${f4(p.cost_sol)} | ${p.net_sol == null ? "open" : f4(p.net_sol)} | ${p.exit_reason ?? "·"} |`);
    }
  }
  return `${L.join("\n")}\n`;
}

/** Every page's data as it stood at `at`. Reads only rows seen by then. */
export async function gatherPages(sql: Q, at: string): Promise<PageData[]> {
  const pages: PageData[] = [];
  const led = await ledger(sql as Sql, { at });
  for (const r of led.rows.filter((r) => r.wallet !== "house" && r.ok >= MIN_CALLS).sort((a, b) => b.ok - a.ok || (a.wallet < b.wallet ? -1 : 1)).slice(0, MAX_CALLERS)) {
    pages.push({
      kind: "caller", slug: `caller-${r.wallet}`, title: `Caller ${short(r.wallet)}`, as_of: at, horizon_min: led.horizon_min,
      calls: r.calls, ok: r.ok, net_med: r.net_med, net_win: r.net_win, net_win_ci95: r.net_win_ci95, peak_med: r.peak_med, trough_med: r.trough_med,
      curve: r.phase.curve, amm: r.phase.amm, excluded: r.excluded,
    });
  }
  const mints = await sql`select distinct mint from mind.positions where opened_at <= ${at} order by mint`;
  for (const mint of mints.map((r) => r.mint as string)) {
    const ps = await sql`select strategy_id, opened_at, cost_sol, case when closed_at <= ${at} then net_sol end net_sol, case when closed_at <= ${at} then exit_reason end exit_reason
      from mind.positions where mint = ${mint} and opened_at <= ${at} order by opened_at, id`;
    const [coin] = await sql`select symbol from mem.coins where mint = ${mint}`;
    const risk = (await liveFor(sql, mint, at))["risk.state"]?.value as Record<string, unknown> | undefined;
    pages.push({
      kind: "coin", slug: `coin-${mint}`, title: `Coin ${(coin?.symbol as string | undefined) ?? short(mint)}`, as_of: at, mint, symbol: (coin?.symbol as string | undefined) ?? null,
      risk: risk ? { bundle_share: risk.bundle_share ?? null, top10_share: risk.top10_share ?? null, creator_sold: risk.creator_sold ?? null } : null,
      positions: ps.map((p) => ({ opened_at: (p.opened_at as Date).toISOString(), strategy_id: p.strategy_id as string, cost_sol: p.cost_sol as number, net_sol: (p.net_sol as number | null) ?? null, exit_reason: (p.exit_reason as string | null) ?? null })),
    });
  }
  return pages;
}

/** Rendering a stored version's data again gives its stored bytes (the E3 check). */
export async function rebuildCheck(sql: Sql, slug: string, version: number): Promise<{ ok: boolean; sha256: string; again: string }> {
  const [e] = await sql`select e.body from wiki.pages p join tape.events e on e.id = p.event_id where p.slug = ${slug} and p.version = ${version}`;
  if (!e) throw new Error(`no wiki page ${slug} v${version}`);
  const b = e.body as BodyOf<"wiki.page">;
  const again = sha(renderPage(b.data as PageData));
  return { ok: again === b.sha256 && sha(b.body) === b.sha256, sha256: b.sha256, again };
}

/** Builds the wiki at each Index refresh, as of that refresh. Writes `wiki.page` and its projection in one transaction. */
export function wikiBuilder(tape: Tape, clock: Clock): Consumer & { stats: Record<string, number> } {
  const stats = { builds: 0, versions: 0, unchanged: 0 };
  return {
    name: "wiki",
    startAtHead: true,
    topics: ["index.refreshed"],
    batch: 10,
    stats,
    async handle(events: Envelope[], tx: Tx) {
      for (const e of events) {
        clock.advance?.(Date.parse(e.seen_time));
        let after = e.seen_time;
        for (const d of await gatherPages(tx, e.seen_time)) {
          const body = renderPage(d);
          const digest = sha(body);
          const [cur] = await tx`select version, sha256 from wiki.pages where slug = ${d.slug} order by version desc limit 1`;
          if (cur?.sha256 === digest) {
            stats.unchanged++;
            continue;
          }
          const version = ((cur?.version as number | undefined) ?? 0) + 1;
          const data = JSON.parse(canonical(d)) as Record<string, unknown>;
          const pe = await tape.emitIn(tx, "wiki.page", { slug: d.slug, kind: d.kind, version, mint: (d.mint as string | undefined) ?? null, sha256: digest, body, as_of: e.seen_time, data },
            { source: "wiki", subject: d.slug, causes: [e.id], after });
          await tx`insert into wiki.pages (slug, version, kind, mint, sha256, body, as_of, event_id)
            values (${d.slug}, ${version}, ${d.kind}, ${(d.mint as string | undefined) ?? null}, ${digest}, ${body}, ${e.seen_time}, ${pe.id})`;
          after = pe.seen_time;
          stats.versions++;
        }
        stats.builds++;
      }
    },
  };
}

/** The markdown file of a page's latest version, with the Wiki writer's prose under its label when there is any. */
export async function exportWiki(sql: Sql, targets: ArchiveTarget[]): Promise<{ files: number }> {
  const pages = await sql`select distinct on (p.slug) p.slug, p.version, p.body, w.text prose from wiki.pages p
    left join wiki.prose w on w.slug = p.slug and w.version = p.version order by p.slug, p.version desc`;
  const index = ["# Asimog wiki", "", ...pages.map((p) => `- [${p.slug}](${p.slug}.md) v${p.version}`), ""].join("\n");
  for (const t of targets) {
    for (const p of pages) {
      const prose = p.prose ? `\n## AI judgment\n\nWritten by the Wiki writer agent, not by code. It may be wrong.\n\n${p.prose as string}\n` : "";
      await t.put(`${p.slug as string}.md`, Buffer.from(`${p.body as string}${prose}`));
    }
    await t.put("index.md", Buffer.from(index));
  }
  return { files: pages.length + 1 };
}
