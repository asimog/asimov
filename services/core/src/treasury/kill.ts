// Kill state and automatic kill triggers (docs/OPS.md, docs/SYSTEM.md 5.4). One state in ops.kill: running, exit_only or halted,
// written only here from kill.changed events. exit_only refuses buys and lets exits run; halted refuses everything.
// The Signer reads the kill file on its own, so a dead core cannot keep it signing. Resume needs the admin token.
import crypto from "node:crypto";
import fs from "node:fs";
import type { Envelope, KillState } from "@asimog/contracts";
import type { Sql } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";

type Cause = "daily_loss" | "signer_refusals" | "feed_gap" | "books" | "fill_drift" | "ops_stop";
const RANK: Record<KillState, number> = { running: 0, exit_only: 1, halted: 2 };

export async function killState(sql: Sql | Tx): Promise<KillState> {
  const [r] = await sql`select state from ops.kill where id = 1`;
  return (r?.state as KillState | undefined) ?? "halted"; // schema.sql seeds the row: a missing one is damage, and damage halts
}

/** The file the Signer reads. No file: running. Unreadable or unknown content: halted (fail closed). */
export function writeKillFile(killFile: string, state: KillState) {
  if (state === "running") fs.rmSync(killFile, { force: true });
  else fs.writeFileSync(killFile, state);
}

export function kill(tape: Tape, killFile: string | null): Consumer {
  const need = env.int("KILL_SIGNER_REFUSALS");
  const windowMs = env.num("KILL_REFUSAL_WINDOW_MIN") * 60_000;
  const gapMs = env.num("KILL_FEED_GAP_MIN") * 60_000;
  const driftX = env.num("KILL_FILL_DRIFT_X");
  const driftFills = env.int("KILL_FILL_DRIFT_FILLS");
  const driftWindowMs = env.num("KILL_FILL_DRIFT_WINDOW_MIN") * 60_000;
  let fileState: KillState | null = null;
  let trippedInBatch = false; // the kill.changed we emit is projected in a later batch

  async function trip(tx: Tx, e: Envelope, by: Cause, reason: string) {
    if (trippedInBatch || RANK[await killState(tx)] >= RANK.exit_only) return;
    trippedInBatch = true;
    await tape.emitIn(tx, "kill.changed", { state: "exit_only", reason, by }, { source: "system", causes: [e.id], after: e.seen_time });
  }

  /** Count one occurrence; true when the window holds enough of them. */
  async function counted(tx: Tx, e: Envelope, cause: Cause, window: number, enough: number) {
    await tx`insert into ops.kill_counts (cause, at, event_id) values (${cause}, ${e.seen_time}, ${e.id}) on conflict do nothing`;
    const [r] = await tx`select count(*)::int n from ops.kill_counts where cause = ${cause} and at > ${new Date(Date.parse(e.seen_time) - window).toISOString()}`;
    return (r!.n as number) >= enough;
  }

  return {
    name: "kill",
    topics: ["kill.changed", "order.failed", "order.filled", "signer.refused", "order.rejected", "books.reconciled", "system.gap", "ops.stop_requested"],
    batch: 200,
    ownLoop: true,
    afterCommit() {
      if (killFile && fileState) writeKillFile(killFile, fileState);
      fileState = null;
    },
    async handle(events, tx) {
      trippedInBatch = false;
      for (const e of events) {
        const b = e.body as Record<string, unknown>;
        if (e.topic === "kill.changed") {
          const state = b.state as KillState;
          await tx`update ops.kill set state = ${state}, reason = ${b.reason as string}, by = ${b.by as string}, at = ${e.seen_time} where id = 1`;
          if (state === "running") await tx`delete from ops.kill_counts`;
          fileState = state;
        } else if (e.topic === "signer.refused" || (e.topic === "order.failed" && String(b.error).startsWith("signer_refused"))) {
          if (await counted(tx, e, "signer_refusals", windowMs, need)) await trip(tx, e, "signer_refusals", `${need} or more signer refusals in ${windowMs / 60_000} min`);
        } else if (e.topic === "order.rejected" && e.source === "riskgate.live" && b.reason_code === "daily_loss_stop") await trip(tx, e, "daily_loss", String(b.detail));
        else if (e.topic === "books.reconciled" && b.ok === false) await trip(tx, e, "books", b.degraded ? "reconciliation degraded" : "ledger and chain differ");
        else if (e.topic === "system.gap" && b.to && Date.parse(b.to as string) - Date.parse(b.from as string) >= gapMs) {
          const [open] = await tx`select 1 from books.lots limit 1`;
          if (open) await trip(tx, e, "feed_gap", `${b.source} gap of ${Math.round((Date.parse(b.to as string) - Date.parse(b.from as string)) / 60_000)} min with positions open`);
        } else if (e.topic === "ops.stop_requested") await trip(tx, e, "ops_stop", `ops agent: ${String(b.reason ?? b.scope ?? "stop requested").slice(0, 120)}`);
        else if (e.topic === "order.filled") {
          // fill drift: the live fill against its ghost twin (same intent id)
          const [g] = await tx`select (body->>'price_sol')::float p from tape.events where topic = 'intent.ghost_filled' and subject = ${b.intent_id as string} limit 1`;
          const ghost = g?.p as number | undefined;
          const live = b.price_sol as number;
          if (!ghost || !(live > 0)) continue;
          const drift = Math.max(live / ghost, ghost / live);
          if (drift >= driftX && (await counted(tx, e, "fill_drift", driftWindowMs, driftFills)))
            await trip(tx, e, "fill_drift", `${driftFills} live fills drifted ${driftX}x or more from the fill model in ${driftWindowMs / 60_000} min`);
        }
      }
    },
  };
}

/** ctl kill: the owner's stop. Writes the Signer's file first, so it works when the core is dead. */
export function ownerKill(tape: Tape, reason: string, killFile: string | null) {
  if (killFile) writeKillFile(killFile, "halted");
  return tape.emit("kill.changed", { state: "halted", reason, by: "owner" }, { source: "system" });
}

const same = (a: string, b: string) => crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());

/** Owner-only commands (resume, limits, lists) need ADMIN_TOKEN; compared in constant time. */
export function requireAdmin(token: string | undefined, want = env.opt("ADMIN_TOKEN"), what = "this command") {
  if (!want || !token || !same(token, want)) throw new Error(`${what} needs the admin token`);
}

/** ctl resume: needs the admin token from the owner's config. */
export function resume(tape: Tape, token: string | undefined, want = env.opt("ADMIN_TOKEN"), killFile: string | null = null) {
  requireAdmin(token, want, "resume");
  if (killFile) writeKillFile(killFile, "running");
  return tape.emit("kill.changed", { state: "running", reason: "resumed", by: "admin" }, { source: "system" });
}
