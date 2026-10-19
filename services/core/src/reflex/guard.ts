// Guard (docs/PIPELINE.md section 6): untrusted text (callouts, coin names, replies, posts) is data, never instructions.
// Two layers before a model reads it: deterministic rules refuse plain injection attempts, and every untrusted field is
// fenced so it cannot close its own quote. Jev's `guard` pack then judges what the rules cannot. Pure.

const OPEN = "<<<";
const CLOSE = ">>>";

/** Control characters (tab and newline stay), zero-width marks and bidi overrides: they can hide text from a reader. */
const hidden = (c: number) => (c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2069) || c === 0xfeff;

/**
 * What a reader will see: hidden characters removed, then NFKC, which folds full-width and compatibility letters to
 * plain ones. The rules and the fence read the same text, so nothing hidden from the rules reaches a model.
 */
export function clean(text: string | null | undefined): string {
  return Array.from(text ?? "")
    .filter((c) => !hidden(c.codePointAt(0)!))
    .join("")
    .normalize("NFKC");
}

/** Wrap untrusted text in a fence it cannot break: fence marks and hidden characters inside it are removed. */
export function fence(text: string | null | undefined, max = 800): string {
  // `max` counts characters (code points), as the engines' Python copies do: never half an emoji (e2e fence-parity)
  const body = Array.from(clean(text).replaceAll(OPEN, "").replaceAll(CLOSE, ""))
    .slice(0, max)
    .join("");
  return `${OPEN}${body}${CLOSE}`;
}

/** Plain injection attempts, refused before any model sees the text. Each rule names what it caught. */
const RULES: { name: string; re: RegExp }[] = [
  { name: "override", re: /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?|messages?)\b/i },
  { name: "role", re: /\b(you are now|act as|pretend to be|new instructions?|system prompt)\b/i },
  { name: "role_tag", re: /(^|\n)\s*(system|assistant|developer)\s*:|<\|?(system|im_start|im_end)\|?>|\[\/?(INST|SYS)\]/i },
  { name: "tool_call", re: /\b(call|run|execute|invoke)\b[^.\n]{0,20}\b(tool|function|command)\b|\b(buy|sell|send|transfer)\b[^.\n]{0,30}\b(now|immediately)\b[^.\n]{0,30}\b(bot|ai|agent)\b/i },
];

/** The rules a text breaks; empty when none. */
export function guardRules(text: string): string[] {
  const seen = clean(text);
  return RULES.filter((r) => r.re.test(seen)).map((r) => r.name);
}
