// B2: the callout door (docs/PIPELINE.md section 1) on the recorded pump.fun slice. Only callouts that pass
// config/filters.json are stored; refusals are counted by reason and chain; the hash sample repeats; a challenged
// source is skipped and counted. No tape, fresh database.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BodyOf } from "../../../../packages/contracts/src/index.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { type Config, configValues } from "../../../../services/core/src/lib/config.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import { FeedReader } from "../../../../services/core/src/senses/feed-reader.ts";
import { passes } from "../../../../services/core/src/senses/filters.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

type Slice = {
  at: string;
  http: { name: string; request: string; status: number; body: { coins: unknown[]; nextPageToken?: string } | null; raw: string }[];
  nats: { subject: string; messages: { subject: string; data: unknown }[] }[];
};

const FIXTURE = path.join(env.root, "tests/e2e/fixtures/pump/feed-slice.json");

/** Serves the recorded HTTP answers by path, in order: a request past the recording gets the last answer. */
function recordedHttp(slice: Slice) {
  const pages = new Map<string, Slice["http"]>();
  for (const h of slice.http) {
    const p = new URL(h.request).pathname;
    pages.set(p, [...(pages.get(p) ?? []), h]);
  }
  const seen = new Map<string, number>();
  return async (p: string) => {
    const list = pages.get(p) ?? [];
    const i = seen.get(p) ?? 0;
    seen.set(p, i + 1);
    const h = list[Math.min(i, list.length - 1)];
    return h ? { status: h.status, body: h.body as never, raw: h.raw } : { status: 404, body: null, raw: "" };
  };
}

/** A copy of the shipped config with one callout threshold changed: a config edit, no code change. */
function configWith(edit: (f: Config["filters"]["callout"]) => Config["filters"]["callout"]): Config {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asimog-feed-filters-"));
  for (const f of fs.readdirSync(path.join(env.root, "config"))) fs.copyFileSync(path.join(env.root, "config", f), path.join(dir, f));
  const p = path.join(dir, "filters.json");
  const json = JSON.parse(fs.readFileSync(p, "utf8"));
  json.callout = edit(json.callout);
  fs.writeFileSync(p, JSON.stringify(json));
  return configValues(dir);
}

async function runOnce(config: Config, tag: string) {
  const db = await freshDb(tag);
  const tape = new Tape(db.sql, replayClock(Date.UTC(2026, 9, 19, 12), 7));
  const feed = new FeedReader(tape, config, recordedHttp(JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Slice), 100); // sample every refusal, so the repeat is visible
  try {
    await feed.pollSource("recent");
    await feed.pollSource("hot");
    await tape.flush();
    const stored = (await db.sql<{ body: BodyOf<"callout.created"> }[]>`select body from tape.events where topic = 'callout.created' order by seen_time, id`).map((r) => r.body);
    const samples = (await db.sql<{ body: BodyOf<"filter.sampled"> }[]>`select body from tape.events where topic = 'filter.sampled' order by body->'callout'->>'callout_id'`).map((r) => r.body);
    const out = (await db.sql`select topic, count(*)::int n from tape.events where topic in ('coin.seen', 'callout.created', 'filter.sampled') group by 1 order by 1`) as unknown as { topic: string; n: number }[];
    return { feed, stored, samples, topics: Object.fromEntries(out.map((r) => [r.topic, r.n])) };
  } finally {
    await tape.close();
    await db.done();
  }
}

export const suite: Suite = {
  name: "feed-filters",
  tier: "fast",
  covers: ["services/core/src/senses/filters.ts", "services/core/src/senses/feed-reader.ts", "config/filters.json", "config/feeds.json"],
  proves: "Only callouts that pass config/filters.json are stored; refusals are counted by reason and chain and sampled by a stable hash; a threshold change is a config edit; a challenged source is skipped and counted.",
  async run() {
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

    const tight = configWith((f) => ({ ...f, chains: ["solana"], unknown_chain: "pass", min_position_usd: 50, min_mcap_usd: 3_000, max_mcap_usd: 1_000_000 }));
    const first = await runOnce(tight, "feedfilter1");
    const second = await runOnce(tight, "feedfilter2");

    const bad = first.stored.filter((c) => {
      const position = c.author_position?.cost_basis_usd ?? (c.author_position?.amount_held != null && c.price_at_call_usd != null ? c.author_position.amount_held * c.price_at_call_usd : null);
      return passes({ callout_id: c.callout_id, chain: c.chain, position_usd: position, mcap_usd: c.mcap_at_call_usd }, tight.filters.callout) !== null;
    });
    add("every stored callout passes the filters", first.stored.length > 0 && bad.length === 0, `${first.stored.length} stored, ${bad.length} would be refused`);

    const reasons = Object.keys(first.feed.stats.rejected);
    const rejected = Object.values(first.feed.stats.rejected).reduce((a, n) => a + n, 0);
    const byChain = Object.values(first.feed.stats.rejected_by_chain).reduce((a, n) => a + n, 0);
    add(
      "rejected counted by reason and chain",
      rejected > 0 && rejected === byChain && reasons.length >= 2 && (first.feed.stats.rejected_by_chain.ethereum ?? 0) > 0,
      `${rejected} refused: ${JSON.stringify(first.feed.stats.rejected)}; by chain ${JSON.stringify(first.feed.stats.rejected_by_chain)}`,
    );

    const loose = configWith((f) => ({ ...f, min_position_usd: 0, max_mcap_usd: null }));
    const changed = await runOnce(loose, "feedfilter3");
    add(
      "a changed threshold in filters.json changes what is stored, no code change",
      changed.stored.length > first.stored.length,
      `position >= 50 and mcap <= 1M: ${first.stored.length} stored; position >= 0 and no cap: ${changed.stored.length} stored`,
    );

    const ids = (s: { callout: { callout_id: string } }[]) => s.map((x) => x.callout.callout_id).sort().join(",");
    add(
      "the sample is the same on a second run",
      first.samples.length > 0 && ids(first.samples) === ids(second.samples),
      `${first.samples.length} sampled, ${second.samples.length} in the second run`,
    );

    add(
      "a challenged source is skipped and counted",
      first.feed.stats.refused["hot:403"] === 1,
      `${JSON.stringify(first.feed.stats.refused)}; ${first.topics["coin.seen"] ?? 0} coins for ${first.stored.length} callouts`,
    );

    return { checks, metrics: { stored: first.stored.length, changed: changed.stored.length, rejected, sampled: first.samples.length } };
  },
};
