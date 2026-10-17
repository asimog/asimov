import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Markdown } from "@/components/shell/Markdown";

export const metadata = { title: "Charter" };
export const revalidate = 60;

// The protected texts live at the repo root; the site reads them as they are and prints their hashes.
const root = path.resolve(process.cwd(), "../..");
const read = async (f: string) => {
  const text = await fs.readFile(path.join(root, f), "utf8").catch(() => null);
  return text == null ? null : { text, sha: crypto.createHash("sha256").update(text).digest("hex") };
};

export default async function CharterPage() {
  const [constitution, soul] = await Promise.all([read("CONSTITUTION.md"), read("SOUL.md")]);
  const version = soul?.text.match(/^version:\s*(\S+)/m)?.[1] ?? "·";
  return (
    <main className="room">
      <header className="room-head">
        <div>
          <h1>What binds it, and who it says it is.</h1>
          <p>The constitution is hash-checked every time the firm boots and changes only with a signed counsel decision. The soul is the agent&apos;s own description of itself; it changes only through a validated, versioned update.</p>
        </div>
        <dl className="room-kpis">
          <div><dt className="micro">Soul version</dt><dd className="num">{version}</dd></div>
        </dl>
      </header>
      <div className="room-grid charter">
        <article className="prose" aria-label="Constitution">
          <p className="micro">Constitution · sha256 <span className="mono">{constitution?.sha.slice(0, 24) ?? "missing"}</span></p>
          {constitution ? <Markdown text={constitution.text} /> : <p className="empty">CONSTITUTION.md is not readable from this deployment.</p>}
        </article>
        <article className="prose" aria-label="Soul">
          <p className="micro">Soul · sha256 <span className="mono">{soul?.sha.slice(0, 24) ?? "missing"}</span></p>
          {soul ? <Markdown text={soul.text} /> : <p className="empty">SOUL.md is not readable from this deployment.</p>}
        </article>
      </div>
    </main>
  );
}
