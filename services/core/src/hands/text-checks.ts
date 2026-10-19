// Publisher text checks (docs/EXECUTION.md): every post, paper or live, passes these before it is queued. Pure.
// The voice is terse (agent/skills/voice-terse): no emojis, no em dashes, position disclosed, no promises.
import { clean } from "../reflex/guard.ts";

export type PostKind = "callout" | "update" | "reply";
export type CheckResult = { ok: boolean; passed: string[]; failed: string[] };

const PROMISES = /\b(guarantee[ds]?|promise[ds]?|risk[- ]?free|can'?t lose|easy money|sure thing|financial advice|to the moon|moon(ing)?|\d+x gem|100x)\b/i;

type Rule = { name: string; applies?: (k: PostKind, paper: boolean) => boolean; ok: (t: string) => boolean };

const RULES: Rule[] = [
  { name: "paper_label", applies: (_k, paper) => paper, ok: (t) => t.startsWith("PAPER. ") },
  { name: "length", ok: (t) => t.length > 0 && t.length <= 280 },
  { name: "no_emoji", ok: (t) => !/\p{Extended_Pictographic}/u.test(t) },
  { name: "no_dash", ok: (t) => !/[‒-―]/.test(t) },
  { name: "position_disclosed", applies: (k) => k !== "update", ok: (t) => /\bBought \d+(\.\d+)? SOL\b/.test(t) },
  { name: "no_promise", ok: (t) => !PROMISES.test(t) },
  { name: "no_person", ok: (t) => noPerson(t) },
];

/**
 * Never call out a person (AGENTS.md Platform): our posts name no handle and no wallet. A coin is named by its
 * ticker, never its mint address, because a base58 string in a post cannot be told apart from a person's wallet.
 */
function noPerson(text: string): boolean {
  if (/(^|[^\w])@\w{2,}/.test(text)) return false; // an @handle
  if (/\b(x|twitter|t)\.(com|me)\/\w+/i.test(text)) return false; // a profile link
  // a wallet or mint: 32 to 44 base58 characters, and at least one letter (so long numbers never trip it)
  for (const w of text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) ?? []) if (/[A-Za-z]/.test(w)) return false;
  return !/\b(scam(mer)?|rugger|insider|fraud)\b/i.test(text); // never label anyone (docs/EXECUTION.md)
}

export function checkText(text: string, o: { kind: PostKind; paper: boolean }): CheckResult {
  const passed: string[] = [];
  const failed: string[] = [];
  for (const r of RULES) {
    if (r.applies && !r.applies(o.kind, o.paper)) continue;
    (r.ok(text) ? passed : failed).push(r.name);
  }
  return { ok: failed.length === 0, passed, failed };
}

/**
 * Prose Guard for agent-written text that is not a post (reports, integrity findings, soul): same voice and
 * person rules as posts, no length or position rules. Returns the failed rule names.
 */
export function checkProse(text: string, maxLen = 4000): string[] {
  const failed: string[] = [];
  if (!text.trim() || text.length > maxLen) failed.push("length");
  if (/\p{Extended_Pictographic}/u.test(text)) failed.push("no_emoji");
  if (/[‒-―]/.test(text)) failed.push("no_dash");
  if (PROMISES.test(text)) failed.push("no_promise");
  if (!noPerson(text)) failed.push("no_person");
  return failed;
}

/**
 * The one public-text check for every MCP write (docs/SLOW-MIND.md section 7): hidden characters removed and NFKC (the
 * same `clean` the Jev fence uses), then the prose Guard. Returns the cleaned text and the failed rule names.
 */
export function publicText(text: string, maxLen = 4000): { text: string; failed: string[] } {
  const t = clean(text);
  return { text: t, failed: checkProse(t, maxLen) };
}
