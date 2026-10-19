// Share cards (S5.8): a 1200 x 630 PNG renders for 20 sample calls, each with its own content, and names no caller.
import crypto from "node:crypto";
import fs from "node:fs";
import { getJson, servers, WEB } from "../../lib/site.ts";
import type { Suite } from "../../lib/suite.ts";

type Card = { id: string; sym: string; mcap_usd: number | null; age_min: number | null; net_multiple: number | null; coverage: string; commit: string | null; position: string };

export const suite: Suite = {
  name: "site-cards",
  tier: "milestone",
  covers: ["apps/web/", "services/relay/"],
  proves: "20 sample calls each render a 1200 x 630 PNG card over HTTP; the images differ from each other; the card data names no caller wallet or handle and says PAPER for the house position.",
  async run() {
    const up = await servers();
    if (!up.pass) return { checks: [up], metrics: {} };
    const ids = (await getJson<{ ids: string[] }>("/v1/cards")).ids;
    const checks = [up, { name: "20 sample calls", pass: ids.length === 20, detail: `${ids.length} ids` }];
    const dir = "artifacts/e2e/site-cards/cards";
    fs.mkdirSync(dir, { recursive: true });
    const hashes = new Set<string>();
    const bad: string[] = [];
    let leak = 0;
    const data: Card[] = [];
    for (const id of ids) {
      const res = await fetch(`${WEB}/cards/${id}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const png = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
      const w = png ? buf.readUInt32BE(16) : 0;
      const h = png ? buf.readUInt32BE(20) : 0;
      if (res.status !== 200 || !(res.headers.get("content-type") ?? "").includes("image/png") || w !== 1200 || h !== 630 || buf.length < 5000) bad.push(`${id}: ${res.status} ${w}x${h} ${buf.length} bytes`);
      else fs.writeFileSync(`${dir}/${id}.png`, buf);
      hashes.add(crypto.createHash("sha256").update(buf).digest("hex"));
      const card = await getJson<Card & { author_wallet?: string; handle?: string }>(`/v1/card/${id}`);
      data.push(card);
      if ("author_wallet" in card || "handle" in card) leak++;
    }
    checks.push({ name: "every card is a 1200 x 630 PNG", pass: bad.length === 0, detail: bad[0] ?? `${ids.length} images in ${dir}` });
    checks.push({ name: "cards differ from each other", pass: hashes.size >= 18, detail: `${hashes.size} distinct images of ${ids.length}` });
    checks.push({ name: "card data names no caller", pass: leak === 0, detail: `${leak} cards carry a wallet or handle` });
    checks.push({ name: "house position says PAPER", pass: data.every((c) => /^PAPER|none/.test(c.position)), detail: [...new Set(data.map((c) => c.position))].slice(0, 3).join(" | ") });
    checks.push({ name: "every card has a measured result", pass: data.every((c) => c.coverage === "ok" && c.net_multiple != null), detail: `${data.filter((c) => c.coverage === "ok").length} of ${data.length} ok` });
    return { checks, metrics: { cards: ids.length, distinct: hashes.size } };
  },
};
