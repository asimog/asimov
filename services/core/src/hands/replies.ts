// Data replies on paper (docs/23 5, docs/09): when a callout lands on a coin whose rug or bundle features break the
// owner's floor, draft a reply that states the data and nothing else: no names, no wallets, no verdict words.
// Scored like a caller (`house:reply`): a reply was right if the coin fell. Reads only the Feed Reader's topic.
import type { BodyOf, Envelope } from "@asimog/contracts";
import { liveFor } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import { DEFAULT_LIMITS, type Limits } from "../mind/risk.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { checkText } from "./text-checks.ts";

const MIN_FACTS = env.int("REPLY_MIN_FACTS", 2);
const COOLDOWN_MIN = env.num("REPLY_COOLDOWN_MIN", 30); // one data reply per coin per window, however many callouts it gets
const pct = (x: number) => `${Math.round(x * 100)}%`;

type Risk = { bundle_share: number; top10_share: number | null; fresh_share: number; creator_sold: number; breaches: number };

/** The facts worth stating: only those over the floor, as plain numbers. Pure. */
export function replyText(r: Risk, floor: { bundle: number; top10: number; fresh: number; sold: number }): { text: string; facts: number } {
  const facts: string[] = [];
  if (r.bundle_share > floor.bundle) facts.push(`Wallets that bought in the first 3 slots hold ${pct(r.bundle_share)} of the supply.`);
  if (r.top10_share != null && r.top10_share > floor.top10) facts.push(`Top 10 wallets hold ${pct(r.top10_share)} of the supply, the curve excluded.`);
  if (r.creator_sold > floor.sold) facts.push(`Creator sold ${pct(r.creator_sold)} of what they bought.`);
  if (r.fresh_share > floor.fresh) facts.push(`${pct(r.fresh_share)} of buying came from wallets with no history.`);
  return { text: `PAPER. Data: ${facts.join(" ")}`, facts: facts.length };
}

export function replies(tape: Tape, clock: Clock): Consumer & { stats: Record<string, number> } {
  const stats = { drafted: 0, refused: 0 };
  return {
    name: "replies",
    startAtHead: true,
    topics: ["callout.created"],
    batch: 200,
    stats,
    async handle(events, tx: Tx) {
      for (const e of events as Envelope<BodyOf<"callout.created">>[]) {
        clock.advance?.(Date.parse(e.seen_time));
        if (e.body.via === "history") continue;
        const r = (await liveFor(tx, e.body.mint, e.seen_time))["risk.state"];
        const v = r?.value as Risk | undefined;
        if (!v || v.breaches < MIN_FACTS) continue;
        const [recent] = await tx`select 1 from tape.events where topic = 'post.queued' and body->>'kind' = 'reply' and body->>'mint' = ${e.body.mint}
          and seen_time > ${new Date(Date.parse(e.seen_time) - COOLDOWN_MIN * 60_000).toISOString()} and seen_time <= ${e.seen_time} limit 1`;
        if (recent) continue;
        const [lim] = await tx`select body from mind.limits order by version desc limit 1`;
        const L: Limits = { ...DEFAULT_LIMITS, ...((lim?.body as Partial<Limits>) ?? {}) };
        const { text, facts } = replyText(v, { bundle: L.max_bundle_share, top10: L.max_top10_share, fresh: L.max_fresh_share, sold: L.max_creator_sold });
        const c = checkText(text, { kind: "reply", paper: true });
        if (facts < MIN_FACTS || !c.ok) {
          stats.refused++;
          continue;
        }
        await tape.emitIn(tx, "post.queued", { post_id: clock.id("post"), kind: "reply", mint: e.body.mint, house_id: clock.id("house"), thesis_id: null, text, checks: c.passed, because: [e.id, r!.id], paper: true },
          { source: "publisher", subject: e.body.callout_id, causes: [e.id], after: e.seen_time });
        stats.drafted++;
      }
    },
  };
}
