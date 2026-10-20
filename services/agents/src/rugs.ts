// Rug reports by similarity (E7b, docs/PIPELINE.md section 10): each new scraped reply is compared with the owner's rug
// example texts (`config/rug-exemplars.json`), so a report worded without the rug words still counts. The examples are
// embedded once per model per process; the score is the best cosine against any example.
import fs from "node:fs";
import path from "node:path";
import type { Embedder } from "@asimog/lane";
import { cosine } from "./clusters.ts";

export const RUG_METHOD = "exemplar-max-cosine@1";
const FILE = path.resolve(import.meta.dirname, "../../../config/rug-exemplars.json");

/** The owner's examples: a JSON list of short texts. */
export function rugExemplars(file = FILE): string[] {
  const x = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(x) || !x.length || !x.every((t) => typeof t === "string" && t.trim())) throw new Error(`${file}: a non-empty list of texts`);
  return x as string[];
}

const cache = new Map<string, number[][]>();
/** The examples' vectors for this embedder's model, embedded once. */
export async function exemplarVectors(emb: Embedder, texts = rugExemplars()): Promise<number[][]> {
  const key = `${emb.model}|${texts.join("\u0000")}`;
  if (!cache.has(key)) cache.set(key, (await emb.embed(texts)).vectors);
  return cache.get(key)!;
}

/** Best similarity of one vector to any example. Pure. */
export const rugSimilarity = (v: number[], examples: number[][]) => Math.max(...examples.map((e) => cosine(v, e)));
