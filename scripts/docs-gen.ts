// Writes docs/generated/*.md from the code that owns each catalog, so these tables never drift.
// `npm run docs:gen` rewrites them; `npm run docs:check` fails when a committed file differs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOPICS } from "../packages/contracts/src/index.ts";

const root = join(import.meta.dirname, "..");
const out = join(root, "docs", "generated");
const check = process.argv.includes("--check");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const header = (title: string, src: string) =>
  `# ${title}\n\nGenerated from \`${src}\` by \`npm run docs:gen\`. Do not edit by hand.\n\n`;

function topics(): string {
  const rows = Object.entries(TOPICS).map(([name, schema]) => {
    const shape = (schema as { shape?: Record<string, unknown> }).shape;
    const fields = shape
      ? Object.keys(shape)
          .map((f) => `\`${f}\``)
          .join(", ")
      : "";
    return `| \`${name}\` | ${fields} |`;
  });
  return `${header("Topics", "packages/contracts/src/index.ts")}${rows.length} topics.\n\n| Topic | Body fields |\n|---|---|\n${rows.join("\n")}\n`;
}

function tables(): string {
  const sql = read("services/core/src/sql/schema.sql");
  const rows: string[] = [];
  const re =
    /create\s+(?:or\s+replace\s+)?(table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?([a-z_][\w]*\.[a-z_][\w]*)/gi;
  for (const m of sql.matchAll(re)) {
    const line = sql.slice(0, m.index).split("\n").length;
    rows.push(`| \`${m[2]}\` | ${m[1].toLowerCase().replace(/\s+/g, " ")} | ${line} |`);
  }
  return `${header("Tables and views", "services/core/src/sql/schema.sql")}${rows.length} objects.\n\n| Name | Kind | Line |\n|---|---|---|\n${rows.join("\n")}\n`;
}

function env(): string {
  const lines = read(".env.example").split("\n");
  const rows: string[] = [];
  let section = "";
  for (const raw of lines) {
    const line = raw.trim();
    const sec = line.match(/^#\s*-{3}\s*(.+?)\s*-{3}/);
    if (sec) section = sec[1];
    const kv = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (kv) rows.push(`| \`${kv[1]}\` | \`${kv[2].replace(/\|/g, "\\|") || " "}\` | ${section} |`);
  }
  return `${header("Settings (env)", ".env.example")}${rows.length} keys. Secrets live only in \`.env.local\` and are not listed here.\n\n| Key | Default | Section |\n|---|---|---|\n${rows.join("\n")}\n`;
}

function signals(): string {
  const src = read("services/core/src/mind/dsl.ts");
  const block = src.slice(
    src.indexOf("export const CATALOG"),
    src.indexOf("};", src.indexOf("export const CATALOG")),
  );
  const rows: string[] = [];
  for (const m of block.matchAll(/"([a-z_.]+)":\s*\{\s*subject:\s*"(\w+)",\s*system:\s*(\d)/g)) {
    rows.push(`| \`${m[1]}\` | ${m[2]} | ${m[3] === "1" ? "One" : "Two"} |`);
  }
  return `${header("Signal kinds a strategy may name", "services/core/src/mind/dsl.ts (CATALOG)")}${rows.length} kinds.\n\n| Kind | Subject | System |\n|---|---|---|\n${rows.join("\n")}\n`;
}

const files: Record<string, string> = {
  "topics.md": topics(),
  "tables.md": tables(),
  "env.md": env(),
  "signals.md": signals(),
};
mkdirSync(out, { recursive: true });
let stale = 0;
for (const [name, body] of Object.entries(files)) {
  const path = join(out, name);
  let old = "";
  try {
    old = readFileSync(path, "utf8");
  } catch {}
  if (old === body) continue;
  if (check) {
    console.error(`docs/generated/${name} is stale: run npm run docs:gen`);
    stale++;
  } else writeFileSync(path, body);
}
if (stale) process.exit(1);
