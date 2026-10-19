// Record a real RPC slice for funder links (docs/PIPELINE.md section 3, docs/tasks/C9.md): for each wallet, its
// signature count (one page of 1000) and its oldest transaction, as the RPC pool returns them. Read-only calls; nothing is guessed.
// Usage: npx tsx scripts/funder-sample.ts <wallet> [<wallet> ...] [--name funder-slice]
import fs from "node:fs";
import path from "node:path";
import { env } from "../services/core/src/lib/env.ts";
import { RpcPool } from "../services/core/src/lib/rpc.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--name");
const name = i >= 0 ? args[i + 1]! : "funder-slice";
const wallets = args.filter((a, k) => !a.startsWith("--") && args[k - 1] !== "--name");
const pool = new RpcPool({ usageFile: null });
const out: { wallet: string; signature_count: number; oldest: unknown }[] = [];
for (const wallet of wallets) {
  const signatures = await pool.call<{ signature: string }[]>("getSignaturesForAddress", [wallet, { limit: 1000, commitment: "confirmed" }]);
  const last = signatures.at(-1);
  const oldest = last ? await pool.call("getTransaction", [last.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]) : null;
  out.push({ wallet, signature_count: signatures.length, oldest }); // the count says whether one page reached the first transaction
  console.log(`${wallet}: ${signatures.length} signatures`);
}
const dir = path.join(env.root, "tests/e2e/fixtures/rpc");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify({ at: new Date().toISOString(), wallets: out }, null, 1)}\n`);
console.log(`wrote tests/e2e/fixtures/rpc/${name}.json`);
