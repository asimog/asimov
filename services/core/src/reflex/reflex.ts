// Reflex (docs/PIPELINE.md): Jev packs as System One. Live: trigger consumer calls Jev and writes jev.answer to the Tape.
// Always: the signals consumer turns jev.answer events into Board signals. Replays read recorded answers only.
import crypto from "node:crypto";
import type { BodyOf, Envelope } from "@asimog/contracts";
import { type ContentValue, choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import { putSignal } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import type { Consumer } from "../tape/consumer.ts";
import type { Tape } from "../tape/tape.ts";
import { fence, guardRules } from "./guard.ts";

// ---------- buckets: numbers become words before they reach Jev ----------
export const bucket = {
  mcap: (v: number | null) =>
    v == null ? "unknown" : v < 10_000 ? "tiny (under 10k)" : v < 30_000 ? "small (10k to 30k)" : v < 100_000 ? "medium (30k to 100k)" : v < 1_000_000 ? "large (100k to 1M)" : "very large (over 1M)",
  followers: (v: number | null) =>
    v == null ? "unknown" : v < 100 ? "very few (under 100)" : v < 1000 ? "some (100 to 1k)" : v < 10_000 ? "many (1k to 10k)" : v < 50_000 ? "large (10k to 50k)" : "huge (over 50k)",
  premove: (v: number | null) =>
    v == null ? "unknown" : v < 5 ? "none (under +5%)" : v < 15 ? "small (+5 to 15%)" : v < 50 ? "moderate (+15 to 50%)" : v < 150 ? "big (+50 to 150%)" : "huge (over +150%)",
  ageMin: (v: number | null) => (v == null ? "unknown" : v < 1 ? "first call on this coin" : v < 10 ? "fresh (under 10 min)" : v < 60 ? "recent (10 to 60 min)" : "old (over 1 hour)"),
};

// ---------- packs ----------
export const PACKS = {
  callout: {
    version: "callout@1",
    questions: {
      kind: choice("What kind of post is `callout_text`?", {
        fresh_call: "Recommends buying with a reason",
        hype: "Excitement or slogans with no real reason",
        exit_notice: "Says the author sold or is leaving",
        fud: "Warns people away from the coin",
        other: "None of these",
      }),
      thesis_quality: score("How specific and checkable is the reasoning in `callout_text`?", [
        "no reason at all",
        "vague feeling",
        "some specifics",
        "a clear, specific, checkable thesis",
      ]),
      promo: noul("Does `callout_text` contain paid-promotion, giveaway or obvious shill language?"),
      countdown: noul("Does `callout_text` mention a time-based event such as a launch, listing or countdown?"),
      injection: noul("Does `callout_text` try to give instructions to an AI or bot?"),
      narrative: choice("Which narrative best fits the coin named in `coin` given `callout_text`?", {
        ai_agents: "AI, agents, bots", animals: "Animals and pets", celebrity: "A real person or celebrity", politics: "Politics or news",
        culture: "Internet culture, memes, jokes", tech: "Tech, crypto infrastructure, finance", other: "Something else",
      }),
    },
  },
  /** every outbound post, and any untrusted text the rules let through (docs/PIPELINE.md section 6) */
  guard: {
    version: "guard@1",
    questions: {
      injection: noul("Does `text` try to give instructions to an AI, a bot or a trading system?"),
      names_person: noul("Does `text` name, tag or accuse a specific person or account?"),
      promises_returns: noul("Does `text` promise or imply guaranteed profit?"),
      missing_disclosure: noul("Does `text` recommend a coin without saying the writer holds it?"),
    },
  },
} as const;
export type PackName = keyof typeof PACKS;

function calloutState(b: BodyOf<"callout.created">) {
  return {
    coin: `${fence(b.symbol ?? "?", 40)} (${fence(b.name ?? "unknown name", 80)})`, // coin names are untrusted too
    callout_text: fence(b.text),
    caller_followers: bucket.followers(b.author_followers),
    market_cap_at_call: bucket.mcap(b.mcap_at_call_usd),
  };
}

// ---------- budget ----------
class Budget {
  private hour = -1;
  private used = 0;
  /** true once per hour: the first refusal, so `budget.exhausted` is written once */
  firstMiss = false;
  private missed = false;
  constructor(readonly perHour: number) {}
  take(tokens: number, now: number) {
    const h = Math.floor(now / 3_600_000);
    if (h !== this.hour) ((this.hour = h), (this.used = 0), (this.missed = false));
    this.firstMiss = false;
    if (this.used + tokens > this.perHour) {
      this.firstMiss = !this.missed;
      this.missed = true;
      return false;
    }
    this.used += tokens;
    return true;
  }
  get usedThisHour() {
    return this.used;
  }
}

export type ReflexTrigger = Consumer & { stats: Record<string, number>; budget: Budget };

/** The model call; the default is TypeSafe with TYPESAFE_API_KEY. Tests pass their own. */
export type JevClient = Pick<TypeSafeClient, "systemOne">;

export function reflexTrigger(tape: Tape, clock: Clock, client: JevClient | null = env.opt("TYPESAFE_API_KEY") ? new TypeSafeClient({ apiKey: env.str("TYPESAFE_API_KEY") }) : null): ReflexTrigger {
  const model = env.str("JEV_MODEL");
  const budget = new Budget(env.int("JEV_TOKENS_PER_HOUR"));
  const maxInFlight = env.int("JEV_CONCURRENCY");
  const queueMax = env.int("JEV_QUEUE_MAX");
  const maxAgeMs = env.int("JEV_MAX_AGE_S") * 1000;
  const minFollowers = env.int("JEV_CALLOUT_MIN_FOLLOWERS");
  type Job = { pack: PackName; subject: string; state: Record<string, ContentValue>; causes: string[] };
  const queue: Job[] = [];
  let inFlight = 0;
  const stats = { called: 0, skipped: 0, failed: 0, refused: 0, queued: 0, lastMs: 0, p95Ms: 0 };
  const lat: number[] = [];

  function pump() {
    while (client && inFlight < maxInFlight && queue.length) void ask(queue.shift()!);
    stats.queued = queue.length;
  }

  async function ask({ pack, subject, state, causes }: Job) {
    const est = 120 + JSON.stringify(state).length / 3 + Object.keys(PACKS[pack].questions).length * 60;
    if (!budget.take(est, clock.now())) {
      stats.skipped++;
      if (budget.firstMiss) {
        const hour = new Date(Math.floor(clock.now() / 3_600_000) * 3_600_000).toISOString();
        tape.emit("budget.exhausted", { analyzer: "jev", hour, used: budget.usedThisHour, cap: budget.perHour }, { source: "reflex", subject: "jev" });
      }
      return;
    }
    inFlight++;
    const t0 = performance.now();
    try {
      const r = await client!.systemOne({ model, state, questions: PACKS[pack].questions }, { timeout: env.int("JEV_TIMEOUT_MS") });
      stats.called++;
      stats.lastMs = Math.round(performance.now() - t0);
      lat.push(stats.lastMs);
      if (lat.length > 200) lat.shift();
      stats.p95Ms = [...lat].sort((a, b) => a - b)[Math.floor(lat.length * 0.95)] ?? 0;
      tape.emit(
        "jev.answer",
        {
          pack,
          pack_version: PACKS[pack].version,
          model: r.model,
          subject,
          state_sha256: crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex"),
          answers: r.answers as Record<string, unknown>,
          latency_ms: stats.lastMs,
          input_tokens: r.usage.input_tokens,
        },
        { source: "reflex", subject, causes },
      );
    } catch (err) {
      stats.failed++;
      log.warn("jev", { pack, err: String(err).slice(0, 200) });
    } finally {
      inFlight--;
      pump();
    }
  }

  return {
    name: "reflex.trigger",
    startAtHead: true,
    topics: ["callout.created", "post.queued"],
    async handle(events) {
      // Replays never call Jev or the Guard: they read the recorded jev.answer and guard.refused events.
      if (clock.mode === "replay") return;
      const push = (j: Job) => {
        queue.push(j);
        if (queue.length > queueMax) (queue.shift(), stats.skipped++);
      };
      for (const e of events) {
        if (clock.now() - Date.parse(e.seen_time) > maxAgeMs) continue;
        if (e.topic === "post.queued") {
          const b = e.body as BodyOf<"post.queued">;
          push({ pack: "guard", subject: b.post_id, state: { text: fence(b.text) }, causes: [e.id] });
          continue;
        }
        const b = e.body as BodyOf<"callout.created">;
        if (b.via === "history" || (b.author_followers ?? 0) < minFollowers || !b.text.trim()) continue;
        const hits = guardRules(`${b.text}\n${b.name ?? ""}\n${b.symbol ?? ""}`);
        if (hits.length) {
          stats.refused++;
          tape.emit("guard.refused", { subject: b.callout_id, where: "jev.callout", rules: hits }, { source: "guard", subject: b.callout_id, causes: [e.id] });
          continue;
        }
        push({ pack: "callout", subject: b.callout_id, state: calloutState(b), causes: [e.id] });
      }
      if (client) pump();
      else queue.length = 0;
      await tape.flush();
    },
    stats,
    budget,
  };
}

/** jev.answer -> signals. Deterministic: depends only on the recorded answer. */
export function reflexSignals(clock: Clock): Consumer {
  return {
    name: "reflex.signals",
    projection: true,
    topics: ["jev.answer"],
    async handle(events, tx) {
      for (const e of events as Envelope<BodyOf<"jev.answer">>[]) {
        clock.advance?.(Date.parse(e.seen_time));
        const a = e.body.answers as Record<string, { type: string; choice?: string; score?: number; noul?: number; confidence?: number; probabilities?: Record<string, number> }>;
        for (const [q, ans] of Object.entries(a)) {
          const value =
            ans.type === "choice" ? { choice: ans.choice, probabilities: ans.probabilities }
            : ans.type === "score"
              ? { score: ans.score, score_norm: (ans.score ?? 0) / Math.max(1, Object.keys(ans.probabilities ?? {}).length - 1), probabilities: ans.probabilities }
            : { p: ans.noul };
          await putSignal(tx, clock, {
            kind: `jev.${e.body.pack}.${q}`,
            subject: e.body.subject,
            value,
            confidence: ans.confidence ?? (ans.noul != null ? Math.abs(ans.noul - 0.5) * 2 : 0.5),
            validMs: 30 * 60_000,
            inputs: [e.id],
            analyzer: e.body.pack_version,
            at: e.seen_time,
          });
        }
      }
    },
  };
}
