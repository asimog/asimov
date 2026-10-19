// B6b: the same closed partition lands in a local folder, an S3-compatible bucket by signed PUT, and a git
// repository, with matching checksums; a target that fails leaves the partition in place and says why.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { configValues } from "../../../../services/core/src/lib/config.ts";
import { Archiver } from "../../../../services/core/src/tape/archiver.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import { GitTarget, LocalTarget, S3Target } from "../../../../services/core/src/tape/targets.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const SEVEN = Date.UTC(2026, 9, 19, 7, 5);

async function s3Server(refuse = false) {
  const store = new Map<string, Buffer>();
  let signed = 0;
  const server = http.createServer((req, res) => {
    if (refuse) {
      res.statusCode = 500;
      res.end("down");
      return;
    }
    if (!String(req.headers.authorization ?? "").startsWith("AWS4-HMAC-SHA256")) {
      res.statusCode = 403;
      res.end("unsigned");
      return;
    }
    signed++;
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        store.set(req.url!, Buffer.concat(chunks));
        res.end("ok");
      });
      return;
    }
    const body = store.get(req.url!);
    if (!body) res.statusCode = 404;
    res.end(body ?? "");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, store, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, signed: () => signed };
}

function emitHot(tape: Tape, clock: ReturnType<typeof replayClock>, id: string) {
  tape.emit("trade.curve", {
    mint: id, tx: id, slot_index_id: null, ts: clock.iso(), side: "buy", wallet: "W1", sol: 1, usd: null, tokens: 1, price_sol: 1, price_usd: null, mcap_usd: 1, on_curve: true, program: "pump", pool_sol: null,
  }, { source: "nats", subject: id });
}

export const suite: Suite = {
  name: "archive-targets",
  tier: "fast",
  covers: ["services/core/src/tape/targets.ts", "services/core/src/tape/archiver.ts", "config/retention.json"],
  proves: "One partition lands in a local folder, an S3-compatible bucket by signed PUT, and a git repository with the same checksum; a failing target leaves the partition in place and reports why.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

    // all three targets
    {
      const db = await freshDb("archivetargets");
      const clock = replayClock(SEVEN);
      const tape = new Tape(db.sql, clock);
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "archive-targets-"));
      const localDir = path.join(root, "local");
      const gitDir = path.join(root, "git");
      const s3 = await s3Server();
      try {
        emitHot(tape, clock, "M1");
        await tape.flush();
        clock.advance!(Date.UTC(2026, 9, 19, 12, 10));
        const config = configValues();
        const archiver = new Archiver(tape, db.sql, config, [
          new LocalTarget(localDir),
          new S3Target({ endpoint: s3.url, accessKey: "AKIAEXAMPLE", secretKey: "secret", region: "us-east-1", bucket: "asimog", prefix: "tape" }),
          new GitTarget(gitDir),
        ]);
        const out = await archiver.runOnce();
        const [row] = await db.sql`select file, sha256, target from tape.archived where partition = 'tape.events_p_2026101907_inputs_hot'`;
        const lines = String(row?.target ?? "").split("\n");
        const sums = lines.map((l) => l.split("=").at(-1));
        const file = String(row?.file ?? "");
        const local = fs.readFileSync(path.join(localDir, file));
        const gitFile = fs.readFileSync(path.join(gitDir, file));
        const bucket = s3.store.get(`/asimog/tape/${file}`);
        const gitLog = execFileSync("git", ["log", "--oneline"], { cwd: gitDir, encoding: "utf8" }).trim();
        add(
          "the same partition lands in two targets with matching checksums",
          out.dropped.length === 1 && lines.length === 3 && new Set(sums).size === 1 && local.equals(gitFile) && !!bucket && bucket.equals(local),
          `${lines.length} targets, sums ${new Set(sums).size}, bytes local ${local.length}, s3 ${bucket?.length ?? 0}, git ${gitFile.length}`,
        );
        add("the S3 target signs its PUT and the git target commits the file", s3.signed() >= 2 && gitLog.length > 0, `signed requests ${s3.signed()}, git "${gitLog}"`);
        await tape.close();
      } finally {
        s3.server.close();
        await db.done();
      }
    }

    // a failing target keeps the partition
    {
      const db = await freshDb("archivefail");
      const clock = replayClock(SEVEN);
      const tape = new Tape(db.sql, clock);
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "archive-fail-"));
      try {
        emitHot(tape, clock, "M2");
        await tape.flush();
        clock.advance!(Date.UTC(2026, 9, 19, 12, 10));
        const bad = { name: "broken", put: async () => { throw new Error("bucket down"); }, get: async () => Buffer.alloc(0) };
        const archiver = new Archiver(tape, db.sql, configValues(), [new LocalTarget(path.join(root, "local")), bad]);
        const out = await archiver.runOnce();
        const [still] = await db.sql`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'tape' and c.relname = 'events_p_2026101907_inputs_hot'`;
        const [arch] = await db.sql`select count(*)::int n from tape.archived where partition = 'tape.events_p_2026101907_inputs_hot'`;
        add(
          "a target that fails leaves the partition in place and says why",
          out.skipped.includes("tape.events_p_2026101907_inputs_hot") && still!.n === 1 && arch!.n === 0 && archiver.stats.last_error.includes("bucket down"),
          `skipped ${out.skipped.length}, partition ${still!.n}, archived ${arch!.n}, error "${archiver.stats.last_error}"`,
        );
        await tape.close();
      } finally {
        await db.done();
      }
    }

    return { checks, metrics: { checks: checks.length } };
  },
};
