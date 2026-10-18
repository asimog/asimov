// Treasury (docs/UI.md, S5.7): the numbers on screen are the API's numbers; the proof chain recomputes from the Tape.
import crypto from "node:crypto";
import { canonical } from "../../../../packages/contracts/src/index.ts";
import { connect } from "../../../../services/core/src/lib/db.ts";
import type { Suite } from "../../lib/suite.ts";
import { Browser, VIEWPORTS, WEB, getJson, pageChecks, servers } from "../../lib/site.ts";

type T = {
  mode: string; mandate_sol: number; as_of: number;
  paper: { equity_sol: number; net_sol: number; closed: number; open_cost_sol: number };
  reconciliation: { positions_net: number; tape_net: number; diff: number; ok: boolean };
  sweeps: unknown[]; costs: unknown[]; balances: unknown[];
  proofs: { n: number; sha256: string; prev_sha256: string; body: unknown }[];
  chain: { hour: string; prev: string; events: number; ids_hash: string; hash: string; open: boolean }[];
};
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(4)}`;

export const suite: Suite = {
  name: "site-treasury",
  proves: "The Treasury's balance, net, closed count and reconciliation equal /v1/treasury; the proof chain's hashes recompute from the Tape in this suite's own code; the page verifies each link and shows all of them verified.",
  async run() {
    const up = await servers();
    if (!up.pass) return { checks: [up], metrics: {} };
    const sql = connect(undefined, 2);
    const b = await Browser.open();
    try {
      const ready = `document.querySelectorAll("ol.chain:not([data-proofs]) li").length > 0 && document.querySelectorAll("ol.chain:not([data-proofs]) li[data-state='checking']").length === 0`;
      const checks = [up, ...(await pageChecks(b, "site-treasury", "/treasury", ready))];
      await b.viewport(VIEWPORTS.desktop);
      await b.goto(`${WEB}/treasury`);
      await b.until(ready);
      const t = await getJson<T>("/v1/treasury");
      const kpi = await b.eval<Record<string, string>>(`Object.fromEntries([...document.querySelectorAll(".room-kpis > div")].map(k => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]))`);
      checks.push({ name: "PAPER balance equals the API", pass: kpi["Balance, paper"] === `${t.paper.equity_sol.toFixed(4)} SOL`, detail: `screen "${kpi["Balance, paper"]}", api ${t.paper.equity_sol.toFixed(4)}` });
      checks.push({ name: "net equals the API", pass: kpi["Net, paper"] === `${signed(t.paper.net_sol)} SOL`, detail: `screen "${kpi["Net, paper"]}", api ${signed(t.paper.net_sol)}` });
      checks.push({ name: "closed count equals the API", pass: kpi["Closed"] === `${t.paper.closed}`, detail: `screen "${kpi["Closed"]}", api ${t.paper.closed}` });
      checks.push({ name: "balance is mandate plus net", pass: Math.abs(t.paper.equity_sol - (t.mandate_sol + t.paper.net_sol)) < 1e-9, detail: `${t.mandate_sol} + ${t.paper.net_sol}` });
      const recon = await b.eval<string>(`document.querySelector("[data-recon]")?.getAttribute("data-recon") ?? ""`);
      checks.push({ name: "reconciliation result is shown and equals the API", pass: recon === (t.reconciliation.ok ? "ok" : "mismatch"), detail: `screen ${recon}, api diff ${t.reconciliation.diff}` });
      const main = await b.text("main");
      checks.push({ name: "sweeps and costs are listed, or say why they are empty", pass: (t.sweeps.length > 0 || main.includes("No sweeps yet")) && (t.costs.length > 0 || main.includes("No costs booked yet")), detail: `${t.sweeps.length} sweeps, ${t.costs.length} costs, ${t.balances.length} balances` });

      // hourly proof segments (S6.6): each body hashes to its sha256 here too, and the page verified each one
      let badProofs = 0;
      t.proofs.forEach((p, i) => {
        if (sha(canonical(p.body)) !== p.sha256 || (i > 0 && t.proofs[i - 1]!.sha256 !== p.prev_sha256)) badProofs++;
      });
      const proofStates = await b.eval<string[]>(`[...document.querySelectorAll("ol.chain[data-proofs] li")].map(l => l.getAttribute("data-state"))`);
      checks.push({ name: "proof segments recompute here and on the page", pass: badProofs === 0 && proofStates.length === t.proofs.length && proofStates.every((x) => x === "verified") && (t.proofs.length > 0 || main.includes("No proof segments yet")), detail: `${t.proofs.length} segments, ${badProofs} differ here, page: ${proofStates.join(",") || "none"}` });

      // the chain, recomputed here from the Tape (closed hours must match exactly; the open hour is checked up to its own count)
      let bad = 0;
      let prev = t.chain[0]?.prev ?? "";
      for (const l of t.chain) {
        if (l.prev !== prev) bad++;
        const from = new Date(l.hour);
        const to = new Date(from.getTime() + 3_600_000);
        const ids = (await sql`select id from tape.events where seen_time >= ${from} and seen_time < ${to} order by seen_time, id`).map((r) => r.id as string);
        const idsHash = sha(ids.join(","));
        const hash = sha(`${prev}|${l.hour}|${ids.length}|${idsHash}`);
        if (!l.open && (ids.length !== l.events || idsHash !== l.ids_hash || hash !== l.hash)) bad++;
        prev = l.hash;
      }
      checks.push({ name: "proof chain recomputes from the Tape", pass: t.chain.length >= 2 && bad === 0, detail: `${t.chain.length} links, ${bad} differ` });
      const onPage = await b.eval<{ n: number; states: string[]; hashes: string[] }>(`({ n: document.querySelectorAll("ol.chain:not([data-proofs]) li").length, states: [...document.querySelectorAll("ol.chain:not([data-proofs]) li")].map(l => l.getAttribute("data-state")), hashes: [...document.querySelectorAll("ol.chain:not([data-proofs]) li")].map(l => l.getAttribute("data-hash")) })`);
      checks.push({ name: "page shows every link, hashes equal the API", pass: onPage.n === t.chain.length && onPage.hashes.every((h, i) => h === t.chain[i]!.hash), detail: `${onPage.n} on screen, ${t.chain.length} from the API` });
      checks.push({ name: "page verified every link", pass: onPage.states.every((s) => s === "verified" || s === "open"), detail: onPage.states.join(",") });
      return { checks, metrics: { links: t.chain.length, equity_sol: t.paper.equity_sol, net_sol: t.paper.net_sol, as_of: t.as_of } };
    } finally {
      await b.close();
      await sql.end({ timeout: 2 });
    }
  },
};
