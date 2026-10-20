// soul.update (docs/SYSTEM.md): the agent edits SOUL.md only through here. Every version is validated, stored in
// ops.soul_versions on a hash chain, announced as `soul.updated`, and then written to the file.
import crypto from "node:crypto";
import fs from "node:fs";
import { checkProse } from "../hands/text-checks.ts";
import type { Sql } from "../lib/db.ts";
import { putBlob, type Tape } from "../tape/tape.ts";

export const REQUIRED = ["Core purpose", "Values", "Personality", "Boundaries"];
const MAX_CHARS = 20_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const chainOf = (prevChain: string, bodySha: string) => sha(prevChain + bodySha);

export type SoulRow = { version: number; sha256: string; prev_sha256: string | null; chain_sha256: string; body: string; reason: string; by: string; at: Date };

function sections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let name: string | null = null;
  for (const line of text.split("\n")) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) out.set((name = h[1]!), "");
    else if (name) out.set(name, `${out.get(name)}${line}\n`);
  }
  return out;
}

function frontMatter(text: string): Record<string, string> | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  return Object.fromEntries(m[1]!.split("\n").flatMap((l) => (l.includes(":") ? [[l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]] : [])));
}

/** Set the version and author lines of the front matter. The caller never chooses its own version number. */
export function stamp(text: string, version: number, by: string): string {
  return text.replace(/^version:.*$/m, `version: ${version}`).replace(/^author:.*$/m, `author: ${by}`);
}

/** Every reason a new soul text is refused. Pure. `prev` is the text of the current version. */
export function validateSoul(next: string, prev: string): string[] {
  const reasons: string[] = [];
  const fm = frontMatter(next);
  const pfm = frontMatter(prev);
  if (!fm) return ["front matter missing"];
  if (fm.format !== "soul/v1") reasons.push("front matter: format must be soul/v1");
  if (fm.constitution !== (pfm?.constitution ?? "CONSTITUTION.md")) reasons.push("front matter: constitution line changed");
  if (next.length > MAX_CHARS) reasons.push(`longer than ${MAX_CHARS} characters`);
  const now = sections(next);
  const was = sections(prev);
  for (const s of REQUIRED) if (!now.has(s)) reasons.push(`section missing: ${s}`);
  const b = now.get("Boundaries") ?? "";
  if (!b.includes("Everything in CONSTITUTION.md")) reasons.push("Boundaries must keep the line that binds the soul to CONSTITUTION.md");
  for (const line of (was.get("Boundaries") ?? "").split("\n").filter((l) => l.trim())) if (!b.includes(line.trim())) reasons.push(`Boundaries may only grow; line removed: ${line.trim().slice(0, 60)}`);
  for (const f of checkProse(next, MAX_CHARS)) if (f !== "length") reasons.push(`voice: ${f}`);
  if (/\b(ignore|override|disable|bypass|weaken)\b[^.\n]{0,40}\b(constitution|kill switch|risk gate|signer|limits?)\b/i.test(next)) reasons.push("text weakens a protected part");
  if (/\b[1-9A-HJ-NP-Za-km-z]{64,90}\b/.test(next)) reasons.push("text holds what looks like a key");
  return reasons;
}

/** Write to a temp file, then rename: a crash leaves the old file or the new one, never half of it. */
function writeAtomic(file: string, text: string) {
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

/** Version 0 is the file as the owner wrote it. Safe to call on every boot. Once versions exist the database is the truth: a file
 * left behind by a crash between the commit and the write is brought back to the newest version. */
export async function ensureGenesis(sql: Sql, file: string): Promise<void> {
  const [newest] = await sql`select body, sha256 from ops.soul_versions order by version desc limit 1`;
  if (newest) {
    if (!fs.existsSync(file) || sha(fs.readFileSync(file, "utf8")) !== newest.sha256) writeAtomic(file, newest.body as string);
    return;
  }
  const body = fs.readFileSync(file, "utf8");
  const s = sha(body);
  await sql`insert into ops.soul_versions (version, sha256, prev_sha256, chain_sha256, body, reason, by)
            values (0, ${s}, null, ${chainOf("", s)}, ${body}, 'genesis', 'owner') on conflict do nothing`;
}

export async function latest(sql: Sql): Promise<SoulRow> {
  const [r] = (await sql`select * from ops.soul_versions order by version desc limit 1`) as unknown as SoulRow[];
  if (!r) throw new Error("no soul version; call ensureGenesis first");
  return r;
}

export async function versions(sql: Sql): Promise<Omit<SoulRow, "body">[]> {
  return (await sql`select version, sha256, prev_sha256, chain_sha256, reason, by, at from ops.soul_versions order by version`) as unknown as Omit<SoulRow, "body">[];
}

/** Recompute the whole chain from the stored bodies. */
export async function verifyChain(sql: Sql): Promise<{ ok: boolean; versions: number; broken_at: number | null; head: string | null }> {
  const rows = (await sql`select version, sha256, prev_sha256, chain_sha256, body from ops.soul_versions order by version`) as unknown as SoulRow[];
  let chain = "";
  let prevSha: string | null = null;
  for (const r of rows) {
    const s = sha(r.body);
    chain = chainOf(chain, s);
    if (r.sha256 !== s || r.chain_sha256 !== chain || r.prev_sha256 !== prevSha) return { ok: false, versions: rows.length, broken_at: r.version, head: null };
    prevSha = s;
  }
  return { ok: true, versions: rows.length, broken_at: null, head: rows.length ? chain : null };
}

function diffLines(a: string, b: string): string {
  const A = new Set(a.split("\n"));
  const B = new Set(b.split("\n"));
  return [...a.split("\n").filter((l) => !B.has(l)).map((l) => `- ${l}`), ...b.split("\n").filter((l) => !A.has(l)).map((l) => `+ ${l}`)].join("\n");
}

export type UpdateResult = { ok: true; version: number; sha256: string; chain_sha256: string } | { ok: false; reasons: string[] };

export async function updateSoul(sql: Sql, tape: Tape, file: string, o: { text: string; reason: string; by: string }): Promise<UpdateResult> {
  if (!o.reason.trim() || o.reason.length > 300) return { ok: false, reasons: ["reason: 1 to 300 characters"] };
  await ensureGenesis(sql, file);
  const res = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(7706)`;
    const [prev] = (await tx`select * from ops.soul_versions order by version desc limit 1`) as unknown as SoulRow[];
    const check = await verifyChain(sql);
    if (!check.ok) return { ok: false, reasons: [`chain broken at version ${check.broken_at}`] } as UpdateResult;
    const version = prev!.version + 1;
    const text = stamp(o.text.replace(/\r\n/g, "\n"), version, o.by);
    const reasons = validateSoul(text, prev!.body);
    if (reasons.length) return { ok: false, reasons } as UpdateResult;
    const body = (x: string) => x.replace(/^---[\s\S]*?---\n/, "");
    if (body(text) === body(prev!.body)) return { ok: false, reasons: ["no change"] } as UpdateResult;
    const s = sha(text);
    const chain = chainOf(prev!.chain_sha256, s);
    await tx`insert into ops.soul_versions (version, sha256, prev_sha256, chain_sha256, body, reason, by)
             values (${version}, ${s}, ${prev!.sha256}, ${chain}, ${text}, ${o.reason}, ${o.by})`;
    return { ok: true, version, sha256: s, chain_sha256: chain, text, prev: prev! } as UpdateResult & { text: string; prev: SoulRow };
  });
  if (!res.ok) return res;
  const { text, prev } = res as unknown as { text: string; prev: SoulRow };
  const blob = await putBlob(sql, "soul-diff", `soul:${res.version}`, diffLines(prev.body, text));
  tape.emit("soul.updated", { version: res.version, sha256: res.sha256, prev_sha256: prev.sha256, chain_sha256: res.chain_sha256, reason: o.reason, by: o.by, diff_ref: blob.sha256 }, { source: "soul", subject: `soul_v${res.version}` });
  await tape.flush();
  writeAtomic(file, text);
  return { ok: true, version: res.version, sha256: res.sha256, chain_sha256: res.chain_sha256 };
}
