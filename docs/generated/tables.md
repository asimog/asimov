# Tables and views

Generated from `services/core/src/sql/schema.sql` by `npm run docs:gen`. Do not edit by hand.

62 objects.

| Name | Kind | Line |
|---|---|---|
| `tape.events` | table | 13 |
| `tape.events_default` | table | 28 |
| `tape.events_default_inputs_hot` | table | 29 |
| `tape.events_default_inputs_kept` | table | 30 |
| `tape.events_default_derived` | table | 31 |
| `tape.dedupe` | table | 47 |
| `tape.consumer_offsets` | table | 53 |
| `tape.archived` | table | 61 |
| `tape.feed_cursors` | table | 93 |
| `tape.blobs` | table | 101 |
| `mem.coins` | table | 111 |
| `mem.callers` | table | 127 |
| `mem.callouts` | table | 137 |
| `mem.callout_updates` | table | 159 |
| `mem.bars_1m` | table | 166 |
| `mem.bar_buyers` | table | 177 |
| `board.signals` | table | 183 |
| `mind.strategies` | table | 198 |
| `mind.stats` | table | 209 |
| `mind.positions` | table | 225 |
| `mind.intents` | table | 247 |
| `mind.fills` | table | 261 |
| `mind.coin_callout` | table | 273 |
| `mind.commits` | table | 280 |
| `mind.desk_clock` | table | 288 |
| `mind.outcome_watch` | table | 294 |
| `mind.score_days` | table | 309 |
| `mind.prob_watch` | table | 321 |
| `mind.coin_precall` | table | 332 |
| `mind.house` | table | 339 |
| `mind.limits` | table | 349 |
| `mind.lists` | table | 356 |
| `ops.soul_versions` | table | 367 |
| `idx.wallet_coin` | table | 379 |
| `idx.wallet_coin_all` | table | 402 |
| `idx.wallet_day` | table | 421 |
| `idx.leaderboard` | table | 435 |
| `idx.coin` | table | 447 |
| `idx.wallet` | table | 461 |
| `idx.scout_wallet` | table | 474 |
| `idx.seed` | table | 479 |
| `hands.orders` | table | 487 |
| `hands.dead_letters` | table | 503 |
| `books.entries` | table | 509 |
| `books.balances` | table | 516 |
| `books.lots` | table | 517 |
| `books.realized` | table | 525 |
| `books.proofs` | table | 526 |
| `ops.kill` | table | 534 |
| `ops.kill_counts` | table | 544 |
| `mem.callout_replies` | table | 553 |
| `slow.reports` | table | 557 |
| `slow.jobs` | table | 564 |
| `slow.cursors` | table | 569 |
| `slow.pumpfun_callout` | view | 573 |
| `slow.pumpfun_callout_comment` | view | 583 |
| `slow.pumpfun_update` | view | 588 |
| `slow.pumpfun_caller` | view | 592 |
| `slow.pumpfun_coin` | view | 597 |
| `slow.pumpfun_trade_flow` | view | 603 |
| `slow.media` | view | 607 |
| `slow.report_feed` | view | 616 |
