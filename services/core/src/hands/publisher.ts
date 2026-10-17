// Publisher on paper (docs/09, S6.0). The first fill of a calling strategy on a coin becomes the house position:
// thesis formed and committed, then the callout queued. Its exits become updates, its close the final update and
// the reveal. Nothing is posted: every post is `paper: true` and starts with "PAPER." Reads only the desk's topics.
import crypto from "node:crypto";
import { type BodyOf, canonical, type Envelope } from "@asimog/contracts";
import { liveFor } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { BoardValues, Spec } from "../mind/dsl.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { checkText, type PostKind } from "./text-checks.ts";
import { calloutText, closeText, exitText, formThesis, type Thesis } from "./thesis.ts";

const PRECALL_H = env.num("PRECALL_HORIZON_MIN", 5);
const sha = (x: unknown) => crypto.createHash("sha256").update(canonical(x)).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();

type House = { house_id: string; mint: string; position_id: string; strategy_id: string; thesis_id: string; opened_ms: number; tokens: number; left: number; entry: number; size: number; kind: Thesis["kind"]; horizon: number; commit_id: string };

export function publisher(tape: Tape, clock: Clock): Consumer & { stats: Record<string, number> } {
  const stats = { callouts: 0, updates: 0, closes: 0, refused: 0 };
  const open = new Map<string, House>(); // mint -> the open house callout
  let loaded = false;

  async function load(tx: Tx) {
    open.clear();
    for (const r of await tx`select * from mind.house where closed_at is null order by opened_at, house_id`) {
      const [t] = await tx`select body from tape.events where topic = 'thesis.formed' and subject = ${r.thesis_id as string} limit 1`;
      const th = t!.body as BodyOf<"thesis.formed">;
      const [p] = await tx`select tokens, tokens_left from mind.positions where id = ${r.position_id as string}`;
      open.set(r.mint as string, {
        house_id: r.house_id as string, mint: r.mint as string, position_id: r.position_id as string, strategy_id: r.strategy_id as string,
        thesis_id: r.thesis_id as string, opened_ms: (r.opened_at as Date).getTime(), tokens: p!.tokens as number, left: p!.tokens_left as number,
        entry: th.plan.entry_price_sol, size: th.plan.size_sol, kind: th.kind, horizon: th.prediction.horizon_min, commit_id: th.commit_id,
      });
    }
    loaded = true;
  }

  /** Queue a post if its text passes every check (docs/09). Returns the event, or null when refused. */
  async function queue(tx: Tx, h: Pick<House, "house_id" | "mint">, kind: PostKind, text: string, thesis_id: string | null, because: string[], after: string) {
    const c = checkText(text, { kind, paper: true });
    if (!c.ok) {
      stats.refused++;
      log.warn("post refused", { house_id: h.house_id, failed: c.failed, text });
      return null;
    }
    return tape.emitIn(tx, "post.queued", { post_id: clock.id("post"), kind, mint: h.mint, house_id: h.house_id, thesis_id, text, checks: c.passed, because, paper: true },
      { source: "publisher", subject: h.house_id, causes: because, after });
  }

  async function board(tx: Tx, mint: string, at: string, snap: Record<string, unknown>): Promise<BoardValues> {
    const subjects = [mint, snap.callout_id, snap.caller].filter((x): x is string => typeof x === "string");
    const out: BoardValues = {};
    for (const s of subjects) for (const [k, v] of Object.entries(await liveFor(tx, s, at))) out[k] = v.value as Record<string, unknown>;
    return out;
  }

  async function onBuy(tx: Tx, e: Envelope<BodyOf<"intent.ghost_filled">>) {
    const b = e.body;
    if (open.has(b.mint)) return; // one coin, one callout: later fills stay on their own books
    const [st] = await tx`select spec from mind.strategies where id = ${b.strategy_id}`;
    const spec = st?.spec as Spec | undefined;
    if (!spec || spec.call.policy === "silent") return;
    const [pos] = await tx`select id, tokens from mind.positions where strategy_id = ${b.strategy_id} and mint = ${b.mint} and opened_at < ${e.seen_time}
      order by opened_at desc limit 1`;
    const [ie] = await tx`select body from tape.events where topic = 'intent.created' and subject = ${b.intent_id} limit 1`;
    if (!pos || !ie) return;
    const intent = ie.body as BodyOf<"intent.created">;
    const bv = await board(tx, b.mint, e.seen_time, intent.board);
    const thesis = formThesis({
      thesis_id: clock.id("thesis"), mint: b.mint, strategy_id: b.strategy_id, position_id: pos.id as string, spec, board: bv,
      entry_price_sol: b.price_sol, size_sol: intent.size_sol ?? b.sol, win_p: intent.score, precall_horizon_min: PRECALL_H,
    });
    // commit first: the hash is public before the callout is
    const commit_id = clock.id("commit");
    const now = Date.parse(e.seen_time);
    const digest = sha(thesis);
    await tx`insert into mind.commits (commit_id, kind, sha256, content, made_at) values (${commit_id}, 'hypothesis', ${digest}, ${tx.json(thesis as never)}, ${e.seen_time})`;
    const ce = await tape.emitIn(tx, "commit.made", { commit_id, kind: "hypothesis", sha256: digest, reveal_after: iso(now + thesis.plan.max_hold_min * 60_000) },
      { source: "publisher", subject: commit_id, causes: [e.id], after: e.seen_time });
    const te = await tape.emitIn(tx, "thesis.formed", { ...thesis, commit_id }, { source: "publisher", subject: thesis.thesis_id, causes: [e.id, ce.id], after: ce.seen_time });
    const h: House = {
      house_id: clock.id("house"), mint: b.mint, position_id: pos.id as string, strategy_id: b.strategy_id, thesis_id: thesis.thesis_id, opened_ms: now,
      tokens: pos.tokens as number, left: pos.tokens as number, entry: b.price_sol, size: thesis.plan.size_sol, kind: thesis.kind, horizon: thesis.prediction.horizon_min, commit_id,
    };
    const mcap = (bv["curve.progress"]?.mcap_usd as number | undefined) ?? null;
    const pe = await queue(tx, h, "callout", calloutText(thesis, { paper: true, mcap_usd: mcap }), thesis.thesis_id, [e.id, te.id], te.seen_time);
    if (!pe) return;
    await tx`insert into mind.house (house_id, mint, position_id, strategy_id, thesis_id, opened_at) values (${h.house_id}, ${h.mint}, ${h.position_id}, ${h.strategy_id}, ${h.thesis_id}, ${e.seen_time})`;
    open.set(b.mint, h);
    stats.callouts++;
  }

  async function onSell(tx: Tx, e: Envelope<BodyOf<"intent.ghost_filled">>) {
    const b = e.body;
    const h = open.get(b.mint);
    if (!h || h.strategy_id !== b.strategy_id) return;
    const [ie] = await tx`select body from tape.events where topic = 'intent.created' and subject = ${b.intent_id} limit 1`;
    const reason = ((ie?.body as BodyOf<"intent.created"> | undefined)?.reason[0]) ?? "exit:-1:unknown";
    h.left = Math.max(0, h.left - b.tokens);
    if (h.left <= h.tokens * 1e-9) return; // the full exit is told once, by the close
    await queue(tx, h, "update", exitText({ paper: true, reason, sold: b.tokens / h.tokens, left: h.left / h.tokens, mult: b.price_sol / h.entry }), null, [e.id], e.seen_time);
    stats.updates++;
  }

  async function onClose(tx: Tx, e: Envelope<BodyOf<"position.closed">>) {
    const b = e.body;
    const h = open.get(b.mint);
    if (!h || h.position_id !== b.position_id) return;
    const [c] = await tx`select min(seen_time) at from tape.events where topic = 'callout.created' and body->>'mint' = ${b.mint}
      and seen_time > ${iso(h.opened_ms)} and seen_time <= ${iso(Math.min(Date.parse(e.seen_time), h.opened_ms + h.horizon * 60_000))}`;
    const calledAfter = c?.at ? ((c.at as Date).getTime() - h.opened_ms) / 1000 : null;
    const net = (b.proceeds_sol + b.rent_refund_sol) / b.cost_sol;
    const ue = await queue(tx, h, "update", closeText({ paper: true, kind: h.kind, net_mult: net, size_sol: h.size, called_after_s: calledAfter, horizon_min: h.horizon }), null, [e.id], e.seen_time);
    const [cm] = await tx`update mind.commits set revealed_at = ${e.seen_time} where commit_id = ${h.commit_id} returning sha256, content`;
    if (cm) await tape.emitIn(tx, "commit.revealed", { commit_id: h.commit_id, content: cm.content, matches: sha(cm.content) === cm.sha256 },
      { source: "publisher", subject: h.commit_id, causes: [ue?.id ?? e.id], after: ue?.seen_time ?? e.seen_time });
    await tx`update mind.house set closed_at = ${e.seen_time} where house_id = ${h.house_id}`;
    open.delete(b.mint);
    stats.closes++;
  }

  return {
    name: "publisher",
    startAtHead: true,
    topics: ["intent.ghost_filled", "position.closed"],
    batch: 500,
    stats,
    async handle(events, tx) {
      try {
        if (!loaded) await load(tx);
        for (const e of events) {
          clock.advance?.(Date.parse(e.seen_time));
          if (e.topic === "position.closed") await onClose(tx, e as never);
          else if ((e.body as BodyOf<"intent.ghost_filled">).side === "buy") await onBuy(tx, e as never);
          else await onSell(tx, e as never);
        }
      } catch (err) {
        loaded = false;
        throw err;
      }
    },
  };
}
