// The fence for strangers' text lives in three runtimes that cannot import each other: core (services/core/src/reflex/guard.ts),
// BettaFish (asimog_voice.py) and MiroShark (backend/asimog_worker.py). This suite runs hostile inputs through all three and
// requires byte-identical output, so a change to one copy that is not made to the others fails here.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../../../../services/core/src/lib/env.ts";
import { clean, fence } from "../../../../services/core/src/reflex/guard.ts";
import type { Check } from "../../lib/checks.ts";
import type { Suite } from "../../lib/suite.ts";

const ENGINES = {
  bettafish: { dir: path.join(env.root, "services", "bettafish", "engine"), module: "asimog_voice" },
  miroshark: { dir: path.join(env.root, "services", "miroshark", "engine", "backend"), module: "asimog_worker" },
};
const py = (dir: string) => path.join(dir, ".venv-asimog", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** Each case: text and the max length. Hidden characters, bidi overrides, full-width fence marks, nested and split marks, ligatures, emoji at the cut. */
const CASES: [string, number][] = [
  ["plain callout text", 800],
  ["zero​width‍ and ‮bidi‬ and ﻿bom and \x07bell\x7f, tab\tand\nnewline kept", 800],
  ["break >>> out <<< and back >>>", 800],
  ["full-width ＜＜＜ marks ＞＞＞ fold under NFKC", 800],
  ["<<<<<< nested >>>>>> and <<<<", 800],
  ["⁠<<​< hidden mark split >⁣>>", 800],
  ["ligature ﬁ and ①②③ and ＡＢＣ fold", 800],
  [`${"🐸".repeat(10)}tail`, 5],
  [`${"a".repeat(7)}🐸🐸`, 8],
  ["", 800],
];

export const suite: Suite = {
  name: "fence-parity",
  tier: "fast",
  covers: ["services/core/src/reflex/guard.ts", "services/bettafish/engine/asimog_voice.py", "services/miroshark/engine/backend/asimog_worker.py"],
  proves: "The fence core uses before Jev and the two copies the engine workers use before their models give byte-identical output on hostile inputs (hidden characters, bidi, full-width and nested fence marks, ligatures, emoji at the length cut).",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const want = CASES.map(([t, n]) => ({ fence: fence(t, n), clean: clean(t) }));
    for (const [name, e] of Object.entries(ENGINES)) {
      if (!fs.existsSync(py(e.dir))) {
        add(`${name} fences exactly as core does`, false, `no venv at ${py(e.dir)}`);
        continue;
      }
      const r = spawnSync(py(e.dir), ["-c", `import json, sys, ${e.module} as m; print(json.dumps([{"fence": m.fence(t, n), "clean": m.clean(t)} for t, n in json.loads(sys.argv[1])]))`, JSON.stringify(CASES)], { cwd: e.dir, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } });
      const got = r.status === 0 ? (JSON.parse(r.stdout.trim().split("\n").at(-1)!) as { fence: string; clean: string }[]) : null;
      const diff = got ? CASES.map((_, i) => i).filter((i) => got[i]!.fence !== want[i]!.fence || got[i]!.clean !== want[i]!.clean) : [];
      add(`${name} fences exactly as core does`, !!got && diff.length === 0,
        got ? `${CASES.length - diff.length} of ${CASES.length} cases identical${diff.length ? `; differ: ${diff.map((i) => `#${i} core ${JSON.stringify(want[i]!.fence)} vs ${JSON.stringify(got[i]!.fence)}`).join("; ")}` : ""}` : r.stderr.slice(-300));
    }
    add("no fenced text can close its own fence", want.every((w) => w.fence.indexOf(">>>") === w.fence.length - 3 && w.fence.lastIndexOf("<<<") === 0), `${want.length} cases`);
    return { checks, metrics: { cases: CASES.length } };
  },
};
