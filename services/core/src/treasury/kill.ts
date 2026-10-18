// Kill switch and automatic kill triggers (docs/15). One state, ops.kill, written only here from kill.changed events.
// When on: the live gate rejects every order, the Trader fails pending orders, the Signer refuses swaps (kill file).
// Senses and the Tape keep recording. Resume needs the admin token (ctl resume).
import fs from "node:fs";
import type { Envelope } from "@asimog/contracts";
import { env } from "../lib/env.ts";
import type { Sql } from "../lib/db.ts";
import { type Consumer, type Tx } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";

export async function killed(sql: Sql | Tx): Promise<boolean> {
  const [r] = await sql`select on_ from ops.kill where id = 1`;
  return r?.on_ === true;
}

export function kill(tape: Tape, killFile: string | null): Consumer {
  const need = env.int("KILL_SIGNER_REFUSALS", 3);
  const windowMs = env.num("KILL_REFUSAL_WINDOW_MIN", 10) * 60_000;
  const gapMs = env.num("KILL_FEED_GAP_MIN", 5) * 60_000;
  let on: boolean | null = null;
  let refusals: number[] = [];

  async function trip(tx: Tx, e: Envelope, by: "daily_loss" | "signer_refusals" | "feed_gap" | "books", reason: string) {
    if (on) return;
    on = true;
    await tx`update ops.kill set on_ = true, reason = ${reason}, by = ${by}, at = ${e.seen_time} where id = 1`;
    await tape.emitIn(tx, "kill.changed", { on: true, reason, by }, { source: "system", causes: [e.id], after: e.seen_time });
    if (killFile) fs.writeFileSync(killFile, reason);
  }

  return {
    name: "kill",
    topics: ["kill.changed", "order.failed", "signer.refused", "order.rejected", "books.reconciled", "system.gap"],
    batch: 200,
    async handle(events, tx) {
      if (on === null) on = await killed(tx);
      for (const e of events) {
        const b = e.body as Record<string, unknown>;
        const at = Date.parse(e.seen_time);
        if (e.topic === "kill.changed") {
          on = b.on as boolean;
          if (!on) refusals = [];
          await tx`update ops.kill set on_ = ${on}, reason = ${b.reason as string}, by = ${b.by as string}, at = ${e.seen_time} where id = 1`;
          if (killFile) {
            if (on) fs.writeFileSync(killFile, String(b.reason));
            else fs.rmSync(killFile, { force: true });
          }
        } else if (e.topic === "signer.refused" || (e.topic === "order.failed" && String(b.error).startsWith("signer_refused"))) {
          refusals = [...refusals.filter((t) => at - t < windowMs), at];
          if (refusals.length >= need) await trip(tx, e, "signer_refusals", `${refusals.length} signer refusals in ${windowMs / 60_000} min`);
        } else if (e.topic === "order.rejected" && e.source === "riskgate.live" && b.reason_code === "daily_loss_stop") await trip(tx, e, "daily_loss", String(b.detail));
        else if (e.topic === "books.reconciled" && b.ok === false) await trip(tx, e, "books", b.degraded ? "reconciliation degraded" : "ledger and chain differ");
        else if (e.topic === "system.gap" && b.to && Date.parse(b.to as string) - Date.parse(b.from as string) >= gapMs) {
          const [open] = await tx`select 1 from books.lots limit 1`;
          if (open) await trip(tx, e, "feed_gap", `${b.source} gap of ${Math.round((Date.parse(b.to as string) - Date.parse(b.from as string)) / 60_000)} min with positions open`);
        }
      }
    },
  };
}

/** ctl kill: the owner's switch. Sense-style emit; the consumer projects it. */
export function ownerKill(tape: Tape, reason: string) {
  return tape.emit("kill.changed", { on: true, reason, by: "owner" }, { source: "system" });
}

/** ctl resume: needs the admin token from the owner's config. */
export function resume(tape: Tape, token: string | undefined, want = env.opt("ADMIN_TOKEN")) {
  if (!want || token !== want) throw new Error("resume needs the admin token");
  return tape.emit("kill.changed", { on: false, reason: "resumed", by: "admin" }, { source: "system" });
}
