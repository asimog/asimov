// The why-chain: walk `causes` (and Board signal `inputs`) back to the observations that started it (docs/03).
import type { Sql } from "./db.ts";

export async function why(sql: Sql, id: string, depth = 0, seen = new Set<string>()): Promise<unknown> {
  if (seen.has(id) || depth > 12) return { id, cycle: true };
  seen.add(id);
  const [e] = await sql`select id, topic, source, subject, seen_time, causes, body from tape.events where id = ${id} limit 1`;
  if (!e) {
    const [s] = await sql`select id, kind, subject, value, inputs, analyzer from board.signals where id = ${id}`;
    if (!s) return { id, missing: true };
    return { ...s, inputs: await Promise.all((s.inputs as string[]).map((c) => why(sql, c, depth + 1, seen))) };
  }
  const causes = e.causes as string[];
  return { id: e.id, topic: e.topic, source: e.source, subject: e.subject, seen_time: e.seen_time, causes: await Promise.all(causes.map((c) => why(sql, c, depth + 1, seen))) };
}
