// While the database cannot be written, the Tape keeps every accepted event queued, reports unhealthy, and writes each event exactly
// once when the database returns. A listener that throws never re-runs or drops a write.
import { replayClock } from "../../../../services/core/src/lib/clock.ts";
import type { Sql } from "../../../../services/core/src/lib/db.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const N = 60;
const REPEATS = 10; // emitted twice with the same dedupe key

export const suite: Suite = {
  name: "tape-durable",
  tier: "fast",
  covers: ["services/core/src/tape/tape.ts"],
  proves: "With the database unwritable mid-run, no accepted event is dropped: the Tape reports unhealthy, keeps the queue, and writes every event once (dedupe repeats skipped) after the database returns, whatever a listener does.",
  async run() {
    const db = await freshDb("tapedurable");
    let down = false;
    // a database that refuses transactions while `down`
    const sql = new Proxy(db.sql, {
      get: (t, k, r) => (k === "begin" ? (...a: unknown[]) => (down ? Promise.reject(new Error("connection refused")) : (t.begin as (...x: unknown[]) => unknown)(...a)) : Reflect.get(t, k, r)),
    }) as Sql;
    const tape = new Tape(sql, replayClock(Date.UTC(2026, 9, 19, 12, 0, 0)));
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    let heard = 0;
    tape.onFlush(() => {
      heard++;
      throw new Error("listener bug");
    });
    const emit = (i: number, dedupe?: string) => tape.emit("ops.alert", { severity: "info", text: `event number ${i}`, finding: `f${i}` }, { source: "system", subject: `s${i}`, dedupe });
    try {
      for (let i = 0; i < 10; i++) emit(i);
      await tape.flush();
      add("a healthy write lands", tape.written === 10 && !tape.unhealthy && tape.queued === 0, `written ${tape.written}, listener heard ${heard} batch`);

      down = true;
      const ids: string[] = [];
      for (let i = 10; i < N; i++) ids.push(emit(i, i < 10 + REPEATS ? `k${i}` : undefined).id);
      for (let i = 10; i < 10 + REPEATS; i++) emit(i, `k${i}`); // repeats: same key
      await tape.flush();
      await tape.flush();
      add("while down nothing is written and the queue holds every accepted event", tape.written === 10 && tape.queued >= N - 10 + REPEATS, `written ${tape.written}, queued ${tape.queued}`);
      add("the Tape reports unhealthy", tape.unhealthy);

      down = false;
      for (let i = 0; i < 200 && (tape.queued > 0 || tape.unhealthy); i++) await new Promise((r) => setTimeout(r, 100));
      await tape.flush();
      add("after recovery the queue drains and the Tape is healthy", tape.queued === 0 && !tape.unhealthy, `queued ${tape.queued}`);

      const [t] = await db.sql`select count(*)::int n, count(distinct id)::int d from tape.events where topic = 'ops.alert' and body->>'finding' like 'f%'`;
      add("every emitted event is on the Tape once", t!.n === N && t!.d === N, `${t!.n} rows, ${t!.d} distinct, expected ${N}`);
      const [alert] = await db.sql`select count(*)::int n from tape.events where topic = 'ops.alert' and body->>'finding' = 'tape.unhealthy'`;
      add("one tape.unhealthy alert was written after recovery", alert!.n === 1, `${alert!.n}`);
      add("dedupe repeats are counted, not lost", tape.deduped === REPEATS, `deduped ${tape.deduped}, expected ${REPEATS}`);
      add("a throwing listener did not re-run a write", heard >= 2 && t!.n === N, `listener heard ${heard} batches`);
      return { checks, metrics: { written: tape.written, deduped: tape.deduped } };
    } finally {
      down = false;
      await tape.close();
      await db.done();
    }
  },
};
