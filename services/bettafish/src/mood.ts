// Mood from callout text, by code (docs/07 patch 7 stands in until the sentiment model is wired): lexicon score per
// callout, averaged. The LLM never produces a number here.
const POS = ["bullish", "send", "early", "gem", "lfg", "buy", "buying", "up", "accumulating", "strong", "runner", "breakout", "gm"];
const NEG = ["rug", "rugged", "scam", "dump", "dumping", "sell", "selling", "dead", "exit", "fud", "bearish", "down", "honeypot", "bundled", "avoid"];

export function moodOf(texts: string[]): { mood: number; label: "fearful" | "calm" | "greedy"; n: number } {
  let sum = 0;
  for (const t of texts) {
    const words = t.toLowerCase().match(/[a-z]+/g) ?? [];
    const p = words.filter((w) => POS.includes(w)).length;
    const n = words.filter((w) => NEG.includes(w)).length;
    sum += p + n ? (p - n) / (p + n) : 0;
  }
  const mood = texts.length ? Math.round((sum / texts.length) * 1000) / 1000 : 0;
  return { mood, label: mood > 0.2 ? "greedy" : mood < -0.2 ? "fearful" : "calm", n: texts.length };
}
