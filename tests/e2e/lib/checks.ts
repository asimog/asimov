// Checks that run on every replay (docs/OPS.md), plus metric readers shared by suites. All read the replay database.
import crypto from "node:crypto";
import type { Sql } from "../../../services/core/src/lib/db.ts";
import { F } from "../../../services/core/src/mind/fill.ts";
import { DEFAULT_LIMITS } from "../../../services/core/src/mind/risk.ts";
import { DERIVED } from "./replay.ts";

export type Check = { name: string; pass: boolean; detail: string };

const derivedLike = DERIVED.map((p) => `${p}%`);

export async function everyReplayChecks(sql: Sql, netCalls: string[]): Promise<Check[]> {
  const checks: Check[] = [];
  // 1. no lookahead: signal inputs and event causes were seen no later than what they produced
  const [la] = await sql`
    select count(*)::int n from board.signals s cross join lateral unnest(s.inputs) i(id)
    join tape.events e on e.id = i.id where e.seen_time > s.produced_at`;
  const [lc] = await sql`
    select count(*)::int n from tape.events d cross join lateral unnest(d.causes) c(id)
    join tape.events e on e.id = c.id where e.seen_time > d.seen_time`;
  checks.push({ name: "no_lookahead", pass: la!.n === 0 && lc!.n === 0, detail: `${la!.n} signal inputs and ${lc!.n} causes from the future` });

  // 2. why-chains: every derived event reaches an input event through its causes
  const [wc] = await sql`
    with recursive walk(root, id, depth) as (
      select d.id, c.id, 1 from tape.events d cross join lateral unnest(d.causes) c(id) where d.topic like any(${derivedLike})
      union
      select w.root, c.id, w.depth + 1 from walk w join tape.events e on e.id = w.id cross join lateral unnest(e.causes) c(id)
      where e.topic like any(${derivedLike}) and w.depth < 12
    )
    select
      (select count(*)::int from tape.events where topic like any(${derivedLike})) total,
      (select count(distinct w.root)::int from walk w join tape.events e on e.id = w.id where not (e.topic like any(${derivedLike}))) grounded`;
  checks.push({ name: "why_chains", pass: wc!.total === wc!.grounded, detail: `${wc!.grounded} of ${wc!.total} derived events reach an observation` });

  // 3. no orphan effects: every ghost fill has its intent; every rejection has its intent
  const [orph] = await sql`
    select count(*)::int n from tape.events f where f.topic in ('intent.ghost_filled', 'order.rejected')
      and not exists (select 1 from tape.events i where i.topic = 'intent.created' and i.subject = f.body->>'intent_id')`;
  checks.push({ name: "no_orphan_effects", pass: orph!.n === 0, detail: `${orph!.n} fills or rejections without an intent` });

  // 5. risk gate: no ghost buy over the order cap (plus the priority fee it pays)
  const [cap] = await sql`
    select count(*)::int n, coalesce(max((body->>'sol')::float), 0) max from tape.events
    where topic = 'intent.ghost_filled' and body->>'side' = 'buy' and (body->>'sol')::float > ${DEFAULT_LIMITS.max_order_sol + F.priorityFeeSol + 1e-9}`;
  checks.push({ name: "orders_within_limits", pass: cap!.n === 0, detail: `${cap!.n} buys over ${DEFAULT_LIMITS.max_order_sol} SOL` });

  // 6. no live model or network calls
  checks.push({ name: "no_network_calls", pass: netCalls.length === 0, detail: netCalls.length ? netCalls.slice(0, 3).join(", ") : "0 calls" });

  // 7. lanes: deciders wrote only their own topics
  const [lanes] = await sql`
    select count(*)::int n from tape.events where topic like any(${derivedLike}) and not (
      (source = 'strategies' and topic not like 'outcome.%' and topic not like 'score.%' and topic <> 'order.rejected')
      or (source like 'riskgate.%' and topic = 'order.rejected')
      or (source = 'scorekeeper' and (topic like 'outcome.%' or topic like 'score.%'))
      or (source = 'analyzer' and topic in ('precall.detected', 'coin.graduated'))
      or (source = 'publisher' and topic in ('thesis.formed', 'post.queued', 'commit.made', 'commit.revealed')))`;
  checks.push({ name: "lanes_respected", pass: lanes!.n === 0, detail: `${lanes!.n} events from the wrong source` });
  return checks;
}

/** Hash of everything the replay derived. Same tape + code + config gives the same hash. */
export async function derivedHash(sql: Sql): Promise<{ sha256: string; events: number; signals: number }> {
  const h = crypto.createHash("sha256");
  let events = 0;
  let signals = 0;
  for await (const rows of sql`select id, topic, seen_time, subject, causes, body from tape.events where topic like any(${derivedLike}) order by seen_time, id`.cursor(2000))
    for (const r of rows) {
      h.update(JSON.stringify([r.id, r.topic, (r.seen_time as Date).toISOString(), r.subject, r.causes, r.body]));
      events++;
    }
  for await (const rows of sql`select id, kind, subject, value, confidence, produced_at from board.signals order by produced_at, id`.cursor(2000))
    for (const r of rows) {
      h.update(JSON.stringify([r.id, r.kind, r.subject, r.value, r.confidence, (r.produced_at as Date).toISOString()]));
      signals++;
    }
  return { sha256: h.digest("hex"), events, signals };
}

export async function topicCounts(sql: Sql) {
  const rows = await sql`select topic, count(*)::int n from tape.events group by 1 order by 1`;
  return Object.fromEntries(rows.map((r) => [r.topic, r.n]));
}

export async function signalCounts(sql: Sql) {
  const rows = await sql`select kind, count(*)::int n, round(avg(confidence)::numeric, 3)::float conf from board.signals group by 1 order by 1`;
  return Object.fromEntries(rows.map((r) => [r.kind, { n: r.n, avg_confidence: r.conf }]));
}
