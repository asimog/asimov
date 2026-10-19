# Tables and views

Generated from `services/core/src/sql/schema.sql` by `npm run docs:gen`. Do not edit by hand.

64 objects.

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
| `mind.positions` | table | 227 |
| `mind.intents` | table | 251 |
| `mind.fills` | table | 267 |
| `mind.coin_callout` | table | 280 |
| `mind.commits` | table | 287 |
| `mind.desk_clock` | table | 295 |
| `mind.outcome_watch` | table | 301 |
| `mind.score_days` | table | 316 |
| `mind.prob_watch` | table | 328 |
| `mind.calibration` | table | 340 |
| `mind.coin_watch` | table | 349 |
| `mind.coin_precall` | table | 355 |
| `mind.house` | table | 362 |
| `mind.limits` | table | 372 |
| `mind.lists` | table | 379 |
| `ops.soul_versions` | table | 390 |
| `idx.wallet_coin` | table | 402 |
| `idx.wallet_coin_all` | table | 425 |
| `idx.wallet_day` | table | 444 |
| `idx.leaderboard` | table | 458 |
| `idx.coin` | table | 470 |
| `idx.wallet` | table | 484 |
| `idx.scout_wallet` | table | 497 |
| `idx.seed` | table | 502 |
| `hands.orders` | table | 510 |
| `hands.dead_letters` | table | 526 |
| `books.entries` | table | 532 |
| `books.balances` | table | 539 |
| `books.lots` | table | 540 |
| `books.realized` | table | 548 |
| `books.proofs` | table | 549 |
| `ops.kill` | table | 557 |
| `ops.kill_counts` | table | 567 |
| `mem.callout_replies` | table | 576 |
| `slow.reports` | table | 580 |
| `slow.jobs` | table | 587 |
| `slow.cursors` | table | 592 |
| `slow.pumpfun_callout` | view | 596 |
| `slow.pumpfun_callout_comment` | view | 606 |
| `slow.pumpfun_update` | view | 611 |
| `slow.pumpfun_caller` | view | 615 |
| `slow.pumpfun_coin` | view | 620 |
| `slow.pumpfun_trade_flow` | view | 626 |
| `slow.media` | view | 630 |
| `slow.report_feed` | view | 639 |
