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
  for (let pass = 0; pass < 3; pass++) // references may chain (RPC_URLS -> RPCFAST_URL -> RPCFAST_API_KEY)
    for (const k of Object.keys(merged)) merged[k] = merged[k]!.replace(/\$\{(\w+)\}/g, (_, n) => merged[n] ?? "");
  return merged;
}

const ENV = load();

/** Every key has its one default in .env.example (fix plan 2.1); a key missing there is a bug and stops boot. */
function need(name: string): string {
  const v = ENV[name];
  if (v === undefined || v.trim() === "") throw new Error(`missing env ${name}: set it in .env.example (the default) or .env.local`);
  return v;
}

export const env = {
  str(name: string): string {
    return need(name);
  },
  opt(name: string): string | undefined {
    const v = ENV[name];
    return v === undefined || v === "" ? undefined : v;
  },
  int(name: string): number {
    const n = env.num(name);
    if (!Number.isInteger(n)) throw new Error(`env ${name} must be a whole number, got ${ENV[name]}`);
    return n;
  },
  /** A typo must stop boot: NaN would silently turn a cap or a kill trigger off. */
  num(name: string): number {
    return finite(name, need(name));
  },
  /** Keys built at runtime (one per RPC endpoint or lane) have no fixed default: unset is undefined, never 0. */
  numOpt(name: string): number | undefined {
    const v = ENV[name];
    return v === undefined || v.trim() === "" ? undefined : finite(name, v);
  },
  bool(name: string): boolean {
    const v = need(name).toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
    if (["0", "false", "no", "off"].includes(v)) return false;
    throw new Error(`env ${name} must be true or false, got ${v}`);
  },
  root: ROOT,
};

function finite(name: string, v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got ${v}`);
  return n;
}

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
