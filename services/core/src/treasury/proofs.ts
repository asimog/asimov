// Hourly proofs (docs/EXECUTION.md): one JSON segment per hour (sweeps, fills, ledger entries, balances, the reconciliation result,
// the commit hashes), chained by the sha256 of the previous segment. The latest hash goes on chain as a memo from W_agent.
// Anyone can recompute a segment's hash from its body and walk the chain (verifyProofs).
import crypto from "node:crypto";
import { canonical } from "@asimog/contracts";
import { proofMemoTx } from "../hands/builder.ts";
import type { Chain } from "../hands/chain.ts";
import type { SignerClient } from "../hands/signer-client.ts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import type { Tape } from "../tape/tape.ts";
import { balancesAt } from "./books.ts";

const sha = (x: unknown) => crypto.createHash("sha256").update(canonical(x)).digest("hex");

export type ProofDeps = { sql: Sql; tape: Tape; chain: Chain; signer: SignerClient; agent: string };

export async function publishProof(d: ProofDeps, hour: string) {
  const { sql } = d;
  const from = hour;
  const to = new Date(Date.parse(hour) + 3_600_000).toISOString();
  const [have] = await sql`select n, sha256, memo_sig from books.proofs where hour = ${hour}`;
  let n: number;
  let hash: string;
  let memoSig = (have?.memo_sig as string | null) ?? null;
  if (have) {
    n = have.n as number;
    hash = have.sha256 as string;
  } else {
    const [prev] = await sql`select n, sha256 from books.proofs order by n desc limit 1`;
    const events = async (topic: string) => (await sql`select id, subject, body from tape.events where topic = ${topic} and seen_time >= ${from} and seen_time < ${to} order by seen_time, id`).map((r) => ({ id: r.id, subject: r.subject, body: r.body }));
    const entries = await sql`select entry_id, kind, tx_sig, legs from books.entries where seen_time >= ${from} and seen_time < ${to} order by seen_time, entry_id`;
    const recon = await events("books.reconciled");
    n = ((prev?.n as number | undefined) ?? 0) + 1;
    const body = {
      n, hour, prev_sha256: (prev?.sha256 as string | undefined) ?? "genesis",
      sweeps: await events("fees.swept"),
      fills: await events("order.filled"),
      entries: entries.map((r) => ({ entry_id: r.entry_id, kind: r.kind, tx_sig: r.tx_sig, legs: r.legs })),
      balances: await balancesAt(sql, to),
      reconciliation: recon[recon.length - 1]?.body ?? null,
      commits: (await events("commit.made")).map((c) => (c.body as { sha256: string }).sha256),
    };
    hash = sha(body);
    await sql`insert into books.proofs (n, hour, sha256, prev_sha256, body) values (${n}, ${hour}, ${hash}, ${body.prev_sha256}, ${sql.json(body as never)})`;
  }
  if (!memoSig && env.bool("PROOF_MEMO")) {
    try {
      const signed = await d.signer.sign("/sign/memo", await proofMemoTx(d.chain, d.agent, hash));
      if (signed.ok) {
        memoSig = await d.chain.send(signed.signed);
        await sql`update books.proofs set memo_sig = ${memoSig} where n = ${n}`;
      }
    } catch {
      memoSig = null; // the segment stands; the memo is retried the next time this hour is published
    }
  }
  const [row] = await sql`select prev_sha256 from books.proofs where n = ${n}`;
  d.tape.emit("proof.published", { n, hour, sha256: hash, prev_sha256: row!.prev_sha256 as string, memo_sig: memoSig }, { source: "treasurer", dedupe: `proof:${hour}:${memoSig ? "memo" : "plain"}` });
  await d.tape.flush();
  return { n, hour, sha256: hash, memo_sig: memoSig };
}

/** Walk the chain: every body hashes to its sha256 and names the one before it. */
export async function verifyProofs(sql: Sql): Promise<{ ok: boolean; segments: number; bad?: number }> {
  const rows = await sql`select n, sha256, prev_sha256, body from books.proofs order by n`;
  let prev = "genesis";
  for (const r of rows) {
    if (r.prev_sha256 !== prev || sha(r.body) !== r.sha256 || (r.body as { prev_sha256: string }).prev_sha256 !== prev) return { ok: false, segments: rows.length, bad: r.n as number };
    prev = r.sha256 as string;
  }
  return { ok: true, segments: rows.length };
}
