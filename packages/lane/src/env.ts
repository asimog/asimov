// Env for processes outside core: process env wins, then .env.local, then .env.example (same order as core's lib/env.ts).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
let loaded = false;

export function loadEnv(): NodeJS.ProcessEnv {
  if (!loaded) {
    loaded = true;
    for (const f of [".env.local", ".env.example"]) if (fs.existsSync(path.join(ROOT, f))) process.loadEnvFile(path.join(ROOT, f));
  }
  return process.env;
}
export const num = (e: NodeJS.ProcessEnv, k: string, d: number) => (e[k] === undefined || e[k] === "" ? d : Number(e[k]));
/** A required value: providers, URLs and models come from env, never from code (AGENTS.md). */
export const need = (e: NodeJS.ProcessEnv, k: string) => {
  if (e[k] === undefined || e[k] === "") throw new Error(`missing env ${k}`);
  return e[k]!;
};
export const str = (e: NodeJS.ProcessEnv, k: string, d: string) => (e[k] === undefined || e[k] === "" ? d : e[k]!);
