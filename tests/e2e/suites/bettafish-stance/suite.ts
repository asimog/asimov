// D7, fix plan 5.5 (docs/SLOW-MIND.md section 7): BettaFish's coin stance comes only from claims that cite our data, matched on
// whole words. The worker's own stance function, run in its own Python with fixed claims: no model, no key.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../../services/core/src/lib/env.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

const ENGINE = path.join(env.root, "services", "bettafish", "engine");
const PY = path.join(ENGINE, ".venv-asimog", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** The stance `asimog_worker.stance_of` gives each list of claim texts. */
function stances(cases: string[][]): string[] | string {
  const r = spawnSync(PY, ["-c", "import json, sys, asimog_worker as w; print(json.dumps([w.stance_of(c) for c in json.loads(sys.argv[1])]))", JSON.stringify(cases)], { cwd: ENGINE, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } });
  return r.status === 0 ? (JSON.parse(r.stdout.trim().split("\n").at(-1)!) as string[]) : r.stderr.slice(-300);
}

export const suite: Suite = {
  name: "bettafish-stance",
  tier: "fast",
  covers: ["services/bettafish/engine/asimog_worker.py"],
  proves: "Fix plan 5.5: BettaFish's coin stance is avoid only when a claim that cites our data names a rug, bundle or scam as a whole word; a word like rugged in passing, or an uncited rug claim, gives no avoid.",
  async run() {
    if (!fs.existsSync(PY)) return { checks: [{ name: "BettaFish venv exists (uv venv .venv-asimog; uv pip install -r requirements-asimog.txt)", pass: false, detail: PY }], metrics: {} };
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const out = stances([
      ["Holders said the dev rugged nothing; early buyers still hold [cid:co_a1]"],
      ["This looks like a rug pull", "Callers were early [cid:co_a1]"],
      ["This looks like a rug, the dev sold [cid:co_b1]"],
    ]);
    if (typeof out === "string") return { checks: [{ name: "the stance function runs", pass: false, detail: out }], metrics: {} };
    const [passing, uncited, citedRug] = out;
    add('"rugged" in passing is not avoid', passing !== "avoid", `stance ${passing}`);
    add("an uncited rug claim is not avoid; a cited one is", uncited !== "avoid" && citedRug === "avoid", `uncited: ${uncited}, cited: ${citedRug}`);
    return { checks, metrics: { stances: out } };
  },
};
