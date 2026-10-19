// Guard (docs/PIPELINE.md section 6): untrusted text (callouts, coin names, replies, posts) is data, never instructions.
// Two layers before a model reads it: deterministic rules refuse plain injection attempts, and every untrusted field is
// fenced so it cannot close its own quote. Jev's `guard` pack then judges what the rules cannot. Pure.

const OPEN = "<<<";
const CLOSE = ">>>";

/** Wrap untrusted text in a fence it cannot break: fence marks and control characters inside it are removed. */
export function fence(text: string | null | undefined, max = 800): string {
  const clean = (text ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
    .replaceAll(OPEN, "")
    .replaceAll(CLOSE, "")
    .slice(0, max);
  return `${OPEN}${clean}${CLOSE}`;
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
  return RULES.filter((r) => r.re.test(text)).map((r) => r.name);
}
