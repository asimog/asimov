// A row stamped earlier can commit after a row stamped later. A live reader that stops below the low watermark still reads it;
// one that reads to the head skips it for good. Dedupe repeats return the id that is on the Tape. A full queue refuses and counts.
import { liveClock } from "../../../../services/core/src/lib/clock.ts";
import { connect, type Sql } from "../../../../services/core/src/lib/db.ts";
import { type Consumer, drain, runLive } from "../../../../services/core/src/tape/consumer.ts";
import { lowWater, release, Tape } from "../../../../services/core/src/tape/tape.ts";
import type { Check } from "../../lib/checks.ts";
import { freshDb } from "../../lib/freshdb.ts";
import type { Suite } from "../../lib/suite.ts";

const reader = (name: string, seen: string[]): Consumer => ({ name, topics: ["ops.alert"], async handle(events) { for (const e of events) seen.push((e.body as { finding: string }).finding); } });

export const suite: Suite = {
  name: "tape-order",
  tier: "fast",
  covers: ["services/core/src/tape/tape.ts", "services/core/src/tape/consumer.ts"],
  proves: "Two writers: an emitIn row stamped first commits after a buffered row stamped later. A reader bounded by the low watermark reads both; an unbounded reader skips the late commit. Dedupe repeats return the stored id; a full queue refuses and counts; TRUNCATE is refused and the read role cannot write.",
  async run() {
    const db = await freshDb("tapeorder");
    const tape = new Tape(db.sql, liveClock("live"));
    const checks: Check[] = [];
    const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });
    const alert = (finding: string) => ({ severity: "info" as const, text: `order check ${finding}`, finding });
    try {
      await tape.ensurePartitions();
      tape.emit("ops.alert", alert("start"), { source: "system" });
      await tape.flush();
      const [start] = await db.sql`select seen_time from tape.events order by seen_time desc limit 1`;
      const after = (start!.seen_time as Date).toISOString();

      const bounded: string[] = [];
      const head: string[] = [];
      const B = reader("order_bounded", bounded);
      const H = reader("order_head", head);
      await drain(db.sql, B);
      await drain(db.sql, H);

      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      let held: object | null = null;
      const early = db.sql.begin(async (tx) => {
        held = tx;
        await tape.emitIn(tx as never, "ops.alert", alert("early"), { source: "system", after });
        await gate;
      }).finally(() => held && release(held));
      while (!held) await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setTimeout(r, 20));
      tape.emit("ops.alert", alert("late"), { source: "system" });
      await tape.flush();

      await drain(db.sql, B, lowWater() ?? undefined);
      await drain(db.sql, H);
      add("while the early write is open the bounded reader waits below it", !bounded.includes("late"), bounded.join(","));
      open();
      await early;
      await drain(db.sql, B, lowWater() ?? undefined);
      await drain(db.sql, H);
      add("the bounded reader reads the early row after it commits, then the late one", bounded.join(",") === "start,early,late", bounded.join(","));
      add("a reader that reads to the head skips the late commit (the defect the watermark removes)", head.includes("late") && !head.includes("early"), head.join(","));
      add("nothing is open once both writes commit", lowWater() === null, String(lowWater()));

      const first = await db.sql.begin((tx) => tape.emitIn(tx as never, "ops.alert", alert("dup"), { source: "system", after, dedupe: "order:dup" }));
      const again = await db.sql.begin((tx) => tape.emitIn(tx as never, "ops.alert", alert("dup"), { source: "system", after, dedupe: "order:dup" }));
      const buffered = tape.emit("ops.alert", alert("dup"), { source: "system", dedupe: "order:dup" });
      await tape.flush();
      const rows = await db.sql`select id from tape.events where body->>'finding' = 'dup'`;
      add("a dedupe repeat returns the id that is on the Tape", rows.length === 1 && first.id === rows[0]!.id && again.id === rows[0]!.id && buffered.id === rows[0]!.id, `${rows.length} rows, ${first.id} ${again.id} ${buffered.id}`);

      const truncated = await db.sql`truncate tape.events`.then(() => "truncated", (err: Error) => err.message);
      add("TRUNCATE on the Tape is refused", truncated.includes("append-only"), truncated);
      const url = new URL(db.url);
      url.username = "asimog_reader";
      const ro = connect(url.toString(), 1);
      const wrote = await ro`insert into tape.dedupe (key, event_id) values ('reader', 'x')`.then(() => "written", (err: Error) => err.message);
      const read = await ro`select count(*)::int n from tape.events`.then((r) => r[0]!.n as number, () => -1);
      await ro.end();
      add("the read role reads the Tape and cannot write", read > 0 && wrote.includes("permission denied"), `read ${read} rows; write: ${wrote}`);
      const twice = await runLive(db.sql, [B, B], liveClock("live")).then(() => "started", (err: Error) => err.message);
      add("two consumers with one name are refused before either runs", twice.includes("share a name"), twice);
      const refuse = () => Promise.reject(new Error("connection refused"));
      const down = { begin: refuse, unsafe: refuse } as unknown as Sql; // no real connection, so its retries never hold the database
      const stuck = new Tape(down, liveClock("live"));
      const cap = Number(process.env.TAPE_MAX_QUEUED ?? 200_000);
      for (let i = 0; i < cap + 5; i++) stuck.emit("ops.alert", alert(`q${i % 10}`), { source: "system" });
      add("past TAPE_MAX_QUEUED a new event is refused and counted, never silently", stuck.dropped === 5 && stuck.queued === cap, `queued ${stuck.queued}, dropped ${stuck.dropped}`);
      return { checks, metrics: { bounded: bounded.length, head: head.length } };
    } finally {
      await tape.close();
      await db.done();
    }
  },
};
