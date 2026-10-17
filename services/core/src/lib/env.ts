// Env: .env.example gives non-secret defaults, .env.local overrides, process env wins.
// ${VAR} references expand. Secrets are never logged: use redact() when printing config.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../..");

function parse(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function load(): Record<string, string> {
  const merged: Record<string, string> = { ...parse(path.join(ROOT, ".env.example")) };
  for (const [k, v] of Object.entries(parse(path.join(ROOT, ".env.local")))) if (v !== "") merged[k] = v;
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== "") merged[k] = v;
  for (const k of Object.keys(merged)) merged[k] = merged[k]!.replace(/\$\{(\w+)\}/g, (_, n) => merged[n] ?? "");
  return merged;
}

const ENV = load();

export const env = {
  str(name: string, fallback?: string): string {
    const v = ENV[name] ?? fallback;
    if (v === undefined || v === "") throw new Error(`missing env ${name}`);
    return v;
  },
  opt(name: string): string | undefined {
    const v = ENV[name];
    return v === undefined || v === "" ? undefined : v;
  },
  int(name: string, fallback: number): number {
    const v = ENV[name];
    return v === undefined || v === "" ? fallback : Number.parseInt(v, 10);
  },
  num(name: string, fallback: number): number {
    const v = ENV[name];
    return v === undefined || v === "" ? fallback : Number(v);
  },
  bool(name: string, fallback = false): boolean {
    const v = ENV[name];
    return v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(v.toLowerCase());
  },
  root: ROOT,
};

const SECRET = /(KEY|PASS|TOKEN|SECRET|SEED)/;
/** Providers put keys in the path (QuickNode, Chainstack) or the query (Helius, RPC Fast): show only scheme and host. */
const hideUrls = (v: string) => v.replace(/((?:https?|wss?):\/\/[^/?#\s|,]+)[^\s|,]*/g, (_m, origin: string) => `${origin}/***`);
export function redact(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ENV)
      .filter(([k]) => /^[A-Z][A-Z0-9_]+$/.test(k) && !k.startsWith("npm_"))
      .map(([k, v]) => [k, SECRET.test(k) ? (v ? `set (${v.length})` : "unset") : hideUrls(v)]),
  );
}
