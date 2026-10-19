// One FeedReader run in its own process, as core runs it: start, let the history walk finish, stop. Env comes from the suite.
import { liveClock } from "../../../../services/core/src/lib/clock.ts";
import { connect } from "../../../../services/core/src/lib/db.ts";
import { env } from "../../../../services/core/src/lib/env.ts";
import { FeedReader } from "../../../../services/core/src/senses/feed-reader.ts";
import { Tape } from "../../../../services/core/src/tape/tape.ts";

const sql = connect(env.str("DATABASE_URL"), 2);
const tape = new Tape(sql, liveClock("paper", 7));
const feed = new FeedReader(tape);
await feed.start();
for (let i = 0; i < 150; i++) {
  const [c] = await sql`select token from tape.feed_cursors where name = 'history'`;
  if (c && c.token == null) break;
  await new Promise((r) => setTimeout(r, 100));
}
await feed.stop();
await tape.close();
await sql.end({ timeout: 2 });
process.exit(0); // the poll loop's sleep would hold the process open
