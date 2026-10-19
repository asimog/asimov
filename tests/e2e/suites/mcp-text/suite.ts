// D3 (docs/SLOW-MIND.md section 7): every MCP write passes one public-text check, and a citation counts only inside the run's
// window. Through the real tool functions on a fresh database: a borrowed id (a real callout seen two days before the window)
// is dropped; a narrative naming a person is dropped; then every free-text field of every write tool gets a known bad string,
// and none of them reaches the Tape.
import { putSignal } from "../../../../services/core/src/board/board.ts";
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import { ALL_CAPS, TOOLS, Toolbox } from "../../../../services/core/src/mcp/toolbox.ts";
import { seedSpecs } from "../../../../services/core/src/mind/seeds.ts";
import type { Tx } from "../../../../services/core/src/tape/consumer.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BAD = "@alice 100x"; // names a person and promises: every rule of the check refuses it
/** Identifiers and references, not prose: the walk leaves them alone. */
const IDS = new Set(["synthesis_id", "swarm_id", "mint", "preset", "as_of", "job_id", "report_id", "subject", "producer", "finding_id", "day", "cites", "parent_reports", "window_from", "window_to", "trigger_event", "because"]);
/** soul_update has its own validator and writes SOUL.md; it is not walked here. */
const SKIP = new Set(["soul_update"]);

/** A zod schema, read only through its `def` (zod 4). */
type Schema = unknown;
type Path = (string | number)[];
type Def = { type: string; shape?: Record<string, Schema>; element?: Schema; innerType?: Schema };
const defOf = (s: Schema) => (s as unknown as { def: Def }).def;

/** Every string leaf of a schema, as a path into `sample` (arrays at index 0), with its minimum length. */
function textPaths(s: Schema, sample: unknown, path: Path = []): { path: Path; min: number }[] {
  const d = defOf(s);
  if (["default", "optional", "nullable"].includes(d.type)) return textPaths(d.innerType!, sample, path);
  if (d.type === "string") return IDS.has(String(path.at(-1))) || typeof path.at(-1) === "number" && IDS.has(String(path.at(-2))) ? [] : [{ path, min: (s as unknown as { minLength: number | null }).minLength ?? 0 }];
  if (d.type === "object") return Object.entries(d.shape!).flatMap(([k, v]) => (sample && typeof sample === "object" && k in sample ? textPaths(v, (sample as Record<string, unknown>)[k], [...path, k]) : []));
  if (d.type === "array") return Array.isArray(sample) && sample.length ? textPaths(d.element!, sample[0], [...path, 0]) : [];
  return [];
}
function setAt(o: Record<string, unknown>, path: Path, v: unknown) {
  let x = o as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) x = x[k] as Record<string | number, unknown>;
  x[path.at(-1)!] = v;
}

export const suite: Suite = {
  name: "mcp-text",
  tier: "fast",
  covers: ["services/core/src/mcp/toolbox.ts", "services/core/src/hands/text-checks.ts"],
  proves: "D3: one public-text check on every text field of every MCP write tool (0 bad strings reach the Tape), a borrowed citation id outside the run's window is dropped, and a narrative naming a person is dropped.",
  async run() {
    const db = await freshDb("mcptext");
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 0);
    const clock = replayClock(t0);
    const tape = new Tape(db.sql, clock);
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const iso = (ms: number) => new Date(ms).toISOString();
    try {
      for (const [id, seen] of [["co_in", t0 - 10 * 60_000], ["co_old", t0 - 2 * 86_400_000]] as const)
        await db.sql`insert into mem.callouts (callout_id, mint, wallet, text, created_at, seen_at, first_on_coin) values (${id}, ${MINT}, 'Caller1', 'call', ${iso(seen)}, ${iso(seen)}, true)`;
      const finding = await putSignal(db.sql as unknown as Tx, clock, { kind: "integrity.finding", subject: MINT, value: {}, confidence: 0.9, validMs: 3_600_000, inputs: [], analyzer: "test" });
      const box = new Toolbox({ sql: db.sql, tape, clock, soulFile: "" }, new Map(ALL_CAPS.map((c) => [c, c])));
      const call = (name: string, args: unknown) => box.call(TOOLS.find((t) => t.name === name)!.caps[0], name, args);
      const as_of = iso(t0);
      const feed = (summary: string, cite: string) => ({ synthesis_id: `f_${cite}_${summary.length}`, as_of, window_min: 60, preset: "nano", narratives: [{ title: "Fresh launch", summary, cites: [cite] }], coin_stances: [], suspicious: [] });

      const borrowed = await call("emit_synthesis_feed", feed("Callers buy early.", "co_old"));
      const bv = borrowed.ok ? (borrowed.value as { claims_kept: number; claims_dropped: number }) : null;
      add("a borrowed id (a real callout outside the window) does not survive", bv?.claims_kept === 0 && bv.claims_dropped === 1, bv ? `kept ${bv.claims_kept}, dropped ${bv.claims_dropped}` : JSON.stringify(borrowed));
      const person = await call("emit_synthesis_feed", feed("Early buyers came from @alice.", "co_in"));
      const pv = person.ok ? (person.value as { claims_dropped: number }) : null;
      add("a narrative naming a person is dropped", pv?.claims_dropped === 1, pv ? `claims_dropped ${pv.claims_dropped}` : JSON.stringify(person));

      // one valid call per write tool; the walk replaces one text field at a time with BAD
      const base: Record<string, Record<string, unknown>> = {
        emit_synthesis_feed: { ...feed("Callers buy early.", "co_in"), coin_stances: [{ mint: MINT, symbol: "FROG", stance: "bullish", why: "Early buys.", cites: ["co_in"] }], suspicious: [{ pattern: "bundle", text: "Many early wallets.", cites: ["co_in"] }] },
        emit_synthesis_coin: { synthesis_id: "c", mint: MINT, as_of, window_min: 60, stance: "bullish", narrative: "Callers buy early.", preset: "nano", claims: [{ text: "One caller bought.", cites: ["co_in"] }] },
        emit_forum_line: { synthesis_id: "fl", round: 1, agent: "insight", text: "Callers buy early.", cites: ["co_in"] },
        emit_swarm_result: { swarm_id: "w", mint: MINT, preset: "nano", usd: 0, samples: [{ branch: "A", callers: 1, actions: 4, net_lamports: 0, truncated: false }], posts: [{ branch: "A", platform: "pumpfun", round: 1, agent: "Ava", archetype: "degen", text: "Buying a little." }] },
        emit_swarm_beliefs: { swarm_id: "wb", mint: MINT, topic: "wave", branches: { A: [[{ round: 1, stance: { degen: 0.1 } }]] } },
        propose_strategy: { spec: seedSpecs()[0], why: ["Tests a rule."] },
        propose_question: { pack: "coin", text: "Is this coin early in its wave?", type: "yes_no" },
        ops_alert: { severity: "info", text: "Tape is slow.", finding: "tape_slow" },
        ops_stop: { action: "pause", scope: "desk", reason: "Testing stop." },
        ops_restart_request: { scope: "desk", reason: "Testing restart." },
        draft_report: { day: "2026-10-19", text: "A quiet day with few callouts on the feed." },
        write_integrity_text: { finding_id: finding, text: "The data shows twenty early wallets." },
        report_publish: { report_id: "rp", producer: "bettafish.insight", kind: "coin", subject: MINT, preset: "nano", summary: "Callers buy early on this coin.", markdown: "# Report\nCallers buy early." },
        job_event: { kind: "done", job_id: "j", agent: "bettafish", error: "no error" },
      };
      const writes = TOOLS.filter((t) => !SKIP.has(t.name) && (t.name.startsWith("emit_") || t.name.startsWith("propose_") || t.name.startsWith("ops_") || ["draft_report", "write_integrity_text", "report_publish", "job_event"].includes(t.name)));
      let n = 0;
      const unique = (a: Record<string, unknown>) => {
        n++;
        for (const k of ["synthesis_id", "swarm_id", "report_id", "job_id"]) if (k in a) a[k] = `${a[k]}_${n}`;
        if (a.day) a.day = iso(t0 + n * 86_400_000).slice(0, 10); // draft_report dedupes by day
        return a;
      };
      const baseFails: string[] = [];
      let fields = 0;
      for (const t of writes) {
        const b = base[t.name];
        if (!b) {
          baseFails.push(`${t.name}: no fixture`);
          continue;
        }
        const ok = await call(t.name, unique(structuredClone(b)));
        if (!ok.ok) baseFails.push(`${t.name}: ${ok.message}`);
        for (const f of textPaths(t.input, b)) {
          const a = unique(structuredClone(b));
          setAt(a, f.path, BAD.padEnd(Math.max(f.min, BAD.length), "."));
          await call(t.name, a);
          fields++;
        }
      }
      await tape.flush();
      const [v] = await db.sql`select count(*)::int n from tape.events where body::text like ${`%${BAD}%`}`;
      add("every write tool's text fields pass one check", baseFails.length === 0 && v!.n === 0 && fields > 0, `${v!.n} text violations in ${fields} fields of ${writes.length} tools${baseFails.length ? `; valid calls refused: ${baseFails.join("; ")}` : ""}`);
      return { checks, metrics: { fields, tools: writes.length, violations: v!.n } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
