// Archive targets (docs/tasks/B6b.md): a local folder, an S3-compatible bucket by a signed HTTP PUT (SigV4), and a
// git repository. Endpoint and keys are env only; config names the bucket, region, prefix and repository. Every
// target must return the same bytes before the archiver records and drops the partition.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../lib/config.ts";
import { env } from "../lib/env.ts";

export interface ArchiveTarget {
  name: string;
  put(file: string, body: Buffer): Promise<void>;
  get(file: string): Promise<Buffer>;
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();

export class LocalTarget implements ArchiveTarget {
  readonly name: string;
  constructor(private dir: string, private root = env.root) {
    this.name = `local:${path.isAbsolute(dir) ? dir : path.join(root, dir)}`;
  }
  async put(file: string, body: Buffer) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, file), body);
  }
  async get(file: string) {
    return fs.readFileSync(path.join(this.dir, file));
  }
}

type S3Opts = { endpoint: string; accessKey: string; secretKey: string; region: string; bucket: string; prefix: string };
export class S3Target implements ArchiveTarget {
  readonly name: string;
  constructor(private o: S3Opts) {
    this.name = `s3:${o.bucket}/${o.prefix}`;
  }
  private url(file: string) {
    return `${this.o.endpoint.replace(/\/$/, "")}/${this.o.bucket}/${this.o.prefix ? `${this.o.prefix.replace(/^\/|\/$/g, "")}/` : ""}${file}`;
  }
  async put(file: string, body: Buffer) {
    const headers = signV4("PUT", this.url(file), this.o, sha(body));
    const r = await fetch(this.url(file), { method: "PUT", headers, body: new Uint8Array(body) });
    if (!r.ok) throw new Error(`s3 ${this.name}: put ${file} http ${r.status}`);
  }
  async get(file: string) {
    const empty = sha(Buffer.alloc(0));
    const headers = signV4("GET", this.url(file), this.o, empty);
    const r = await fetch(this.url(file), { method: "GET", headers });
    if (!r.ok) throw new Error(`s3 ${this.name}: get ${file} http ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
}

/** AWS Signature Version 4 for one S3 request. Pure, so a test can check it against the published vectors. */
export function signV4(method: string, url: string, o: { accessKey: string; secretKey: string; region: string }, payloadHash: string, at = new Date()) {
  const u = new URL(url);
  const amzDate = at.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${o.region}/s3/aws4_request`;
  const canonical = `${method}\n${u.pathname}\n${u.searchParams.toString()}\nhost:${u.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n\nhost;x-amz-content-sha256;x-amz-date\n${payloadHash}`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha(Buffer.from(canonical))}`;
  const k = hmac(hmac(hmac(hmac(`AWS4${o.secretKey}`, day), o.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", k).update(toSign).digest("hex");
  return {
    host: u.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
  };
}

export class GitTarget implements ArchiveTarget {
  readonly name: string;
  constructor(private dir: string, private remote?: string, private branch = "main", root = env.root) {
    this.dir = path.isAbsolute(dir) ? dir : path.join(root, dir);
    this.name = `git:${this.dir}`;
  }
  private git(...args: string[]) {
    return execFileSync("git", args, { cwd: this.dir, encoding: "utf8" }).trim();
  }
  async put(file: string, body: Buffer) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(path.join(this.dir, ".git"))) {
      this.git("init", "-b", this.branch);
      this.git("config", "user.email", "archiver@asimog.local");
      this.git("config", "user.name", "Asimog Archiver");
    }
    fs.writeFileSync(path.join(this.dir, file), body);
    this.git("add", file);
    this.git("commit", "-m", `archive ${file}`);
    if (this.remote) this.git("push", this.remote, this.branch);
  }
  async get(file: string) {
    if (this.remote) {
      this.git("fetch", this.remote, this.branch);
      return Buffer.from(this.git("show", `FETCH_HEAD:${file}`), "binary");
    }
    return fs.readFileSync(path.join(this.dir, file));
  }
}

/** Build every configured target; a missing S3 endpoint or key is an error, not a silent skip. */
export function targetsFromConfig(config: Config, root = env.root): ArchiveTarget[] {
  return config.retention.archive_targets.map((t) => {
    if (t.kind === "local") return new LocalTarget(t.dir, root);
    if (t.kind === "git") return new GitTarget(t.dir, t.remote, t.branch, root);
    const endpoint = env.opt("S3_ENDPOINT");
    const accessKey = env.opt("S3_ACCESS_KEY_ID");
    const secretKey = env.opt("S3_SECRET_ACCESS_KEY");
    if (!endpoint || !accessKey || !secretKey) throw new Error("s3 archive target needs S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in .env.local");
    return new S3Target({ endpoint, accessKey, secretKey, region: t.region, bucket: t.bucket, prefix: t.prefix ?? "" });
  });
}
