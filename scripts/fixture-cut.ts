// Cut a replay fixture: a time window of a tape file, inputs only (our own decisions are re-derived by every replay).
// npx tsx scripts/fixture-cut.ts <in.ndjson.gz> <out.ndjson.gz> <from-iso> <to-iso>
import fs from "node:fs";
import zlib from "node:zlib";
import { isDerived, readTape } from "../tests/e2e/lib/replay.ts";

const [input, output, from, to] = process.argv.slice(2);
if (!input || !output || !from || !to) throw new Error("usage: fixture-cut <in> <out> <from-iso> <to-iso>");
const rows = (await readTape(input)).filter((r) => !isDerived(r.topic) && r.seen_time >= new Date(from).toISOString() && r.seen_time <= new Date(to).toISOString());
fs.writeFileSync(output, zlib.gzipSync(`${rows.map((r) => JSON.stringify(r)).join("\n")}\n`));
console.log(JSON.stringify({ output, events: rows.length, first: rows[0]?.seen_time, last: rows.at(-1)?.seen_time, bytes: fs.statSync(output).size }));
