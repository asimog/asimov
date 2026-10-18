// Slow-mind signals (docs/04): BettaFish and MiroShark write events through the MCP tools; this consumer projects them
// onto the Board with their validity windows, so strategies read them like any other signal. Pure projection:
// a replay of the same events gives the same signals.
// Ways it fails: (1) a late event is shown for its remaining window only; (2) a writer outside the slow lanes forges a
// synthesis or swarm event: only the core MCP tools write these topics, and each is projected only from its own source
// (bettafish, miroshark); (3) a run whose claims were mostly dropped looks confident: confidence falls with the dropped
// share; (4) a truncated swarm (budget hit) looks like a full one: confidence is capped at 0.3; (5) a stale run lingers:
// every kind has a validity window of 15 to 30 minutes; (6) a report from one producer hides another's: `report.latest`
// is kept per subject and producer (subject `<mint or global>|<producer>`), and carries the envelope only, never the body.
import type { Envelope } from "@asimog/contracts";
import { putSignal } from "../board/board.ts";
import type { Clock } from "../lib/clock.ts";
import type { Consumer, Tx } from "../tape/consumer.ts";

const MIN = 60_000;
/** Share of claims that survived the citation rule; 0.5 when a run made none. */
const keptShare = (b: Record<string, unknown>) => (Number(b.claims_total) > 0 ? 1 - Number(b.claims_dropped) / Number(b.claims_total) : 0.5);
const KINDS: Record<string, { kind?: string; subject: (b: Record<string, unknown>) => string; validMin: number; analyzer: string; conf: (b: Record<string, unknown>) => number }> = {
  "synthesis.feed": { subject: () => "global", validMin: 30, analyzer: "bettafish@1", conf: keptShare },
  "mood.feed": { subject: () => "global", validMin: 15, analyzer: "bettafish@1", conf: () => 0.6 },
  "synthesis.coin": { subject: (b) => String(b.mint), validMin: 30, analyzer: "bettafish@1", conf: keptShare },
  "swarm.wave_p": { subject: (b) => String(b.mint), validMin: 30, analyzer: "miroshark@1", conf: (b) => (b.truncated ? 0.3 : Math.min(0.8, 0.4 + 0.1 * Number(b.samples))) },
  "swarm.beliefs": { subject: (b) => String(b.mint), validMin: 30, analyzer: "miroshark@1", conf: () => 0.3 },
  "swarm.impact": { subject: (b) => String(b.mint), validMin: 30, analyzer: "miroshark@1", conf: (b) => (b.truncated ? 0.3 : 0.5) },
  "report.published": { kind: "report.latest", subject: (b) => `${b.subject}|${b.producer}`, validMin: 30, analyzer: "slow-bridge@1", conf: (b) => (b.simulated ? 0.3 : 0.6) },
};

export function slowSignals(clock: Clock): Consumer {
  return {
    name: "analyzers.slow",
    topics: Object.keys(KINDS),
    async handle(events: Envelope[], tx: Tx) {
      for (const e of events) {
        const k = KINDS[e.topic]!;
        if (e.source !== k.analyzer.split("@")[0]) continue; // only the lane that owns the topic writes it (bettafish, miroshark, slow-bridge)
        const b = e.body as Record<string, unknown>;
        await putSignal(tx, clock, { kind: k.kind ?? e.topic, subject: k.subject(b), value: b, confidence: k.conf(b), validMs: k.validMin * MIN, inputs: [e.id], analyzer: k.analyzer, at: e.seen_time });
      }
    },
  };
}
