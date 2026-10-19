// E2E runner (docs/OPS.md): `npm run e2e [suite ...]`. The tape is E2E_TAPE, by default the 2-minute discovery fixture;
// `E2E_TAPE=tests/e2e/fixtures/tapes/discovery-10m.ndjson.gz` is the long one for milestones. A fixture may carry settings
// beside it (<tape>.env, such as 1-minute horizons for a 2-minute tape). They apply before any module reads the env, and a
// value already in the process env wins.
import fs from "node:fs";

process.env.E2E_TAPE ??= "tests/e2e/fixtures/tapes/discovery-2m.ndjson.gz";
const tape = process.env.E2E_TAPE;
const settings = tape.replace(/\.ndjson\.gz$/, ".env");
if (fs.existsSync(settings))
  for (const line of fs.readFileSync(settings, "utf8").split("\n")) {
    const m = line.trim().match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
await import("./main.ts");
