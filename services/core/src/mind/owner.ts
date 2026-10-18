// The owner's admin path (docs/08, docs/25 section 6): limits and lists, versioned, each change on the Tape.
// Only ctl calls this, with the admin token. Nothing a model writes reaches it.
import crypto from "node:crypto";
import { LIST_KINDS, type ListKind } from "@asimog/contracts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import type { Tape } from "../tape/tape.ts";
import { requireAdmin } from "../treasury/kill.ts";
import { DEFAULT_LIMITS, type Limits, loadLimits } from "./risk.ts";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS).filter((k) => typeof DEFAULT_LIMITS[k as keyof Limits] === "number");

export async function setLimit(sql: Sql, tape: Tape, token: string | undefined, key: string, raw: string, want = env.opt("ADMIN_TOKEN")) {
  requireAdmin(token, want, "limits set");
  if (!LIMIT_KEYS.includes(key)) throw new Error(`unknown limit ${key}; have ${LIMIT_KEYS.join(", ")}`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`limit ${key} must be a number 0 or more, got ${raw}`);
  const [cur] = await sql`select version, body from mind.limits order by version desc limit 1`;
  const version = Number(cur?.version ?? 0) + 1;
  const body = { ...((cur?.body as Partial<Limits> | undefined) ?? {}), [key]: value };
  await sql`insert into mind.limits (version, body, set_by, set_at) values (${version}, ${sql.json(body as never)}, 'admin', ${tape.clock.iso()})`;
  tape.emit("limits.changed", { version, key, value, by: "admin" }, { source: "system", subject: key });
  await tape.flush();
  return { version, key, value };
}

export async function loadList(sql: Sql, tape: Tape, token: string | undefined, kind: string, text: string, want = env.opt("ADMIN_TOKEN")) {
  requireAdmin(token, want, "lists load");
  if (!(LIST_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown list ${kind}; have ${LIST_KINDS.join(", ")}`);
  const items = [...new Set(text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean))];
  const bad = items.filter((i) => !BASE58.test(i));
  if (bad.length) throw new Error(`not base58 addresses: ${bad.slice(0, 5).join(", ")}`);
  const [cur] = await sql`select max(version)::int v from mind.lists where kind = ${kind}`;
  const version = Number(cur?.v ?? 0) + 1;
  await sql`insert into mind.lists (kind, version, items, set_by, set_at) values (${kind}, ${version}, ${items}, 'admin', ${tape.clock.iso()})`;
  const sha256 = crypto.createHash("sha256").update(items.join("\n")).digest("hex");
  tape.emit("lists.loaded", { kind: kind as ListKind, version, count: items.length, sha256, by: "admin" }, { source: "system", subject: kind });
  await tape.flush();
  return { kind, version, count: items.length, sha256 };
}

export async function showLimits(sql: Sql) {
  const [cur] = await sql`select version, set_at from mind.limits order by version desc limit 1`;
  const lists = await sql`select distinct on (kind) kind, version, cardinality(items)::int count, set_at from mind.lists order by kind, version desc`;
  const L = await loadLimits(sql);
  const numbers = Object.fromEntries(LIMIT_KEYS.map((k) => [k, L[k as keyof Limits]]));
  return { version: cur?.version ?? 0, set_at: cur?.set_at ?? null, limits: numbers, defaults_in_force: LIMIT_KEYS.filter((k) => L[k as keyof Limits] === DEFAULT_LIMITS[k as keyof Limits]), lists };
}
