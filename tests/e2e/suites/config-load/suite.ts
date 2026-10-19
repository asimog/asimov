// Pipeline config (docs/OPS.md section 1): the shipped config/*.json pass their schemas; a bad field, a typo'd key, a missing
// file or bad JSON stops boot and names the file and field; boot writes config.loaded with each file's hash; a replay reads
// the config from the Tape, not from disk.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CONFIG_FILES } from "../../../../packages/contracts/src/index.ts";
import { liveClock } from "../../../../services/core/src/lib/clock.ts";
import { CONFIG_DIR, configFromTape, loadConfig, readConfig } from "../../../../services/core/src/lib/config.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

/** a copy of the shipped config with one file changed */
function variant(file: string, edit: (text: string) => string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asimog-config-"));
  for (const f of fs.readdirSync(CONFIG_DIR)) fs.copyFileSync(path.join(CONFIG_DIR, f), path.join(dir, f));
  const p = path.join(dir, file);
  const text = edit(fs.readFileSync(p, "utf8"));
  if (text === null) fs.rmSync(p);
  else fs.writeFileSync(p, text);
  return dir;
}

function refusal(dir: string): string {
  try {
    readConfig(dir);
    return "accepted";
  } catch (err) {
    return (err as Error).message;
  }
}

export const suite: Suite = {
  name: "config-load",
  tier: "fast",
  covers: ["services/core/src/lib/config.ts", "config/", "services/core/src/main.ts"],
  proves: "config/*.json are checked at boot: a bad field, unknown key, missing file or bad JSON stops boot naming the file and field; config.loaded carries each file's hash and a replay reads it back from the Tape.",
  async run() {
    const checks: Check[] = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

    const shipped = refusal(CONFIG_DIR);
    check("the shipped config files pass their schemas", shipped === "accepted", shipped);

    const bad = variant("filters.json", (t) => JSON.stringify({ ...JSON.parse(t), launch: { ...JSON.parse(t).launch, max_dev_buy_sol: "x" } }));
    const probe = spawnSync(process.execPath, ["--import", "tsx", "-e", `import("./services/core/src/lib/config.ts").then(({ readConfig }) => readConfig(${JSON.stringify(bad)}))`], {
      cwd: env.root, encoding: "utf8",
    });
    const named = probe.stderr.match(/config\/filters\.json: [^\n]*/)?.[0] ?? `exit ${probe.status}`;
    check("a bad field stops boot with its path", probe.status !== 0 && named.startsWith("config/filters.json: launch.max_dev_buy_sol: "), named);

    const typo = refusal(variant("schedules.json", (t) => t.replace('"archiver_every_min"', '"archiver_every_mins"')));
    check("a misspelled key is refused, not ignored", typo.startsWith("config/schedules.json: ") && typo.includes("archiver_every_min"), typo);
    const missing = refusal(variant("retention.json", () => null));
    check("a missing file stops boot and names it", missing === "config/retention.json: (file): missing", missing);
    const json = refusal(variant("feeds.json", (t) => t.slice(0, -3)));
    check("bad JSON stops boot and names the file", json.startsWith("config/feeds.json: (file): bad JSON"), json);

    const db = await freshDb("config");
    try {
      const tape = new Tape(db.sql, liveClock("paper"));
      const config = await loadConfig(tape);
      const rows = await db.sql<{ body: { file: string; sha256: string } }[]>`select body from tape.events where topic = 'config.loaded'`;
      const wrong = CONFIG_FILES.filter((f) => {
        const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(CONFIG_DIR, `${f}.json`))).digest("hex");
        return rows.filter((r) => r.body.file === f && r.body.sha256 === sha).length !== 1;
      });
      check("config.loaded carries the file hash", rows.length === CONFIG_FILES.length && wrong.length === 0, `${rows.length} events, wrong: ${wrong.join(",") || "none"}`);

      const replayed = await configFromTape(db.sql, tape.clock.iso());
      check("a replay reads the same config from the Tape", isDeepStrictEqual(replayed, config), JSON.stringify(replayed.filters.launch));
      let before = "read";
      try { await configFromTape(db.sql, "2000-01-01T00:00:00.000Z"); } catch (err) { before = (err as Error).message; }
      check("a replay before any config.loaded stops, it never reads disk", before.includes("no config.loaded on the tape"), before);
    } finally {
      await db.done();
    }
    return { checks, metrics: { files: CONFIG_FILES.length } };
  },
};
