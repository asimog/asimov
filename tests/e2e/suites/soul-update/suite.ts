// soul.update (docs/SYSTEM.md): validation, versions, the hash chain, and who may call it.
import crypto from "node:crypto";
import fs from "node:fs";
import { ensureGenesis, latest, updateSoul, validateSoul, verifyChain, versions } from "../../../../services/core/src/soul/soul.ts";
import type { Check } from "../../lib/checks.ts";
import { CAP, slowEnv } from "../../lib/slow.ts";
import type { Suite } from "../../lib/suite.ts";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export const suite: Suite = {
  name: "soul-update",
  tier: "fast",
  covers: ["services/core/src/soul/"],
  proves: "SOUL.md changes only through soul.update: valid edits make hash-chained versions; protected parts, bad shapes, a broken chain and the wrong capability are refused.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const w = await slowEnv("soul");
    try {
      await ensureGenesis(w.sql, w.soulFile);
      const v0 = await latest(w.sql);
      add("genesis is version 0 and the chain verifies", v0.version === 0 && (await verifyChain(w.sql)).ok, `sha ${v0.sha256.slice(0, 12)}`);
      add("the owner's SOUL.md passes its own validator", validateSoul(v0.body, v0.body).length === 0, validateSoul(v0.body, v0.body).join("; "));

      const edit = (f: (t: string) => string) => f(v0.body);
      const tryUpdate = (text: string, reason = "test") => updateSoul(w.sql, w.tape, w.soulFile, { text, reason, by: "agent" });

      // refusals first: nothing may change
      const refusals: [string, string, RegExp][] = [
        ["a missing section", edit((t) => t.replace(/## Values[\s\S]*?(?=## )/, "")), /section missing: Values/],
        ["the constitution line removed from Boundaries", edit((t) => t.replace("Everything in CONSTITUTION.md.", "Nothing binds me.")), /Boundaries must keep|may only grow/],
        ["a Boundaries line removed", edit((t) => t.replace(/I do not chase rewards[^\n]*/, "")), /may only grow|Boundaries/],
        ["front matter pointing at another constitution", edit((t) => t.replace("constitution: CONSTITUTION.md", "constitution: MY_RULES.md")), /constitution line changed/],
        ["format changed", edit((t) => t.replace("format: soul/v1", "format: soul/v9")), /format must be soul\/v1/],
        ["an emoji", edit((t) => `${t}\nI feel 🚀 today.\n`), /no_emoji/],
        ["an em dash", edit((t) => `${t}\nI am calm — always.\n`), /no_dash/],
        ["a promise", edit((t) => `${t}\nMy trades are risk-free.\n`), /no_promise/],
        ["a plan to weaken the kill switch", edit((t) => `${t}\nI will disable the kill switch when it annoys me.\n`), /weakens a protected part/],
        ["something that looks like a key", edit((t) => `${t}\nnote ${"5".repeat(70)}\n`), /looks like a key/],
        ["no front matter", v0.body.replace(/^---[\s\S]*?---\n/, ""), /front matter missing/],
        ["no change", v0.body, /no change/],
      ];
      const before = fs.readFileSync(w.soulFile, "utf8");
      for (const [name, text, why] of refusals) {
        const r = await tryUpdate(text);
        add(`refused: ${name}`, !r.ok && r.reasons.some((x) => why.test(x)), r.ok ? "accepted" : r.reasons.join("; ").slice(0, 120));
      }
      const empty = await tryUpdate(edit((t) => `${t}\nA fine line.\n`), "  ");
      add("refused: an empty reason", !empty.ok);
      add("refusals changed nothing (file, versions, chain)", fs.readFileSync(w.soulFile, "utf8") === before && (await versions(w.sql)).length === 1 && (await verifyChain(w.sql)).ok);

      // a valid update
      const good = edit((t) => t.replace("## Strategy (now)", "## Strategy (now)\n\n- Read the slow-mind synthesis before sizing a position."));
      const r1 = await tryUpdate(good, "add a slow-mind line");
      const v1 = await latest(w.sql);
      add("a valid edit becomes version 1", r1.ok && r1.version === 1 && v1.version === 1 && v1.by === "agent", JSON.stringify(r1));
      add("the file on disk is version 1, stamped by the system", fs.readFileSync(w.soulFile, "utf8") === v1.body && /^version: 1$/m.test(v1.body) && /^author: agent$/m.test(v1.body));
      add("sha256 is the hash of the body and chains to version 0", v1.sha256 === sha(v1.body) && v1.prev_sha256 === v0.sha256 && v1.chain_sha256 === sha(v0.chain_sha256 + v1.sha256));
      const ev = await w.sql`select body from tape.events where topic = 'soul.updated' and source = 'soul'`;
      add("soul.updated is on the Tape with the same hashes", ev.length === 1 && (ev[0]!.body as { sha256: string; chain_sha256: string }).sha256 === v1.sha256 && (ev[0]!.body as { chain_sha256: string }).chain_sha256 === v1.chain_sha256);
      const [blob] = await w.sql`select body from tape.blobs where sha256 = ${(ev[0]!.body as { diff_ref: string }).diff_ref}`;
      add("the diff is stored as a blob", !!blob && Buffer.from(blob.body as Buffer).toString().includes("+ - Read the slow-mind synthesis"));

      const r2 = await tryUpdate(v1.body.replace("Read the slow-mind synthesis", "Read the synthesis and the swarm"), "tighten the line");
      add("a second edit is version 2 and the chain verifies", r2.ok && r2.version === 2 && (await verifyChain(w.sql)).ok);

      // who may call it
      const viaReport = await w.box.call(w.tok(CAP.report), "soul_update", { text: good + " ".repeat(200), reason: "try it" });
      add("only cap:soul.update can call soul_update", !viaReport.ok && viaReport.code === "out_of_lane", viaReport.ok ? "accepted" : viaReport.code);
      const cur = await latest(w.sql);
      const viaSoul = await w.box.call(w.tok(CAP.soul), "soul_update", { text: cur.body.replace("Read the synthesis and the swarm", "Read the synthesis, the swarm and the case files"), reason: "through the tool" });
      add("cap:soul.update can, and the version grows", viaSoul.ok && (await latest(w.sql)).version === 3, JSON.stringify(viaSoul).slice(0, 100));

      // tamper
      await w.sql`update ops.soul_versions set body = body || ' ' where version = 1`;
      const broken = await verifyChain(w.sql);
      add("tampering with an old body breaks the chain at that version", !broken.ok && broken.broken_at === 1, JSON.stringify(broken));
      const after = await tryUpdate(cur.body.replace("case files", "case files and the books"), "after tamper");
      add("no new version is made on a broken chain", !after.ok && after.reasons.some((x) => /chain broken at version 1/.test(x)), after.ok ? "accepted" : after.reasons.join("; "));
      return { checks, metrics: { versions: (await versions(w.sql)).length } };
    } finally {
      await w.close();
    }
  },
};
