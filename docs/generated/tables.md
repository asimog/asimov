# Tables and views

Generated from `services/core/src/sql/schema.sql` by `npm run docs:gen`. Do not edit by hand.

68 objects.

| Name | Kind | Line |
|---|---|---|
| `tape.events` | table | 14 |
| `tape.events_default` | table | 29 |
| `tape.events_default_inputs_hot` | table | 30 |
| `tape.events_default_inputs_kept` | table | 31 |
| `tape.events_default_derived` | table | 32 |
| `tape.dedupe` | table | 51 |
| `tape.consumer_offsets` | table | 57 |
| `tape.archived` | table | 65 |
| `tape.feed_cursors` | table | 97 |
| `tape.blobs` | table | 105 |
| `mem.coins` | table | 115 |
| `mem.callers` | table | 131 |
| `mem.callouts` | table | 141 |
| `mem.callout_updates` | table | 163 |
| `mem.bars_1m` | table | 170 |
| `mem.bar_buyers` | table | 181 |
| `board.signals` | table | 187 |
| `mind.strategies` | table | 202 |
| `mind.stats` | table | 213 |
| `mind.positions` | table | 231 |
| `mind.intents` | table | 256 |
| `mind.fills` | table | 272 |
| `mind.coin_callout` | table | 285 |
| `mind.commits` | table | 292 |
| `mind.desk_clock` | table | 300 |
| `mind.outcome_watch` | table | 306 |
| `mind.score_days` | table | 321 |
| `mind.score_samples` | table | 332 |
| `mind.prob_watch` | table | 344 |
| `mind.calibration` | table | 356 |
| `mind.coin_watch` | table | 365 |
| `mind.coin_precall` | table | 371 |
| `mind.house` | table | 381 |
| `mind.limits` | table | 391 |
| `mind.lists` | table | 398 |
| `ops.soul_versions` | table | 409 |
| `idx.wallet_coin` | table | 421 |
| `idx.wallet_coin_all` | table | 444 |
| `idx.wallet_day` | table | 463 |
| `idx.leaderboard` | table | 477 |
| `idx.coin` | table | 489 |
| `idx.wallet` | table | 503 |
| `idx.scout_wallet` | table | 516 |
| `idx.funder` | table | 522 |
| `idx.seed` | table | 529 |
| `hands.orders` | table | 537 |
| `hands.dead_letters` | table | 553 |
| `books.entries` | table | 559 |
| `books.balances` | table | 566 |
| `books.lots` | table | 567 |
| `books.realized` | table | 575 |
| `books.proofs` | table | 576 |
| `ops.kill` | table | 584 |
| `ops.kill_counts` | table | 594 |
| `mem.callout_replies` | table | 603 |
| `slow.reports` | table | 607 |
| `slow.jobs` | table | 614 |
| `slow.cursors` | table | 619 |
| `slow.pumpfun_callout` | view | 623 |
| `slow.pumpfun_callout_comment` | view | 633 |
| `slow.pumpfun_update` | view | 638 |
| `slow.pumpfun_caller` | view | 642 |
| `slow.pumpfun_coin` | view | 647 |
| `slow.pumpfun_trade_flow` | view | 653 |
| `slow.media` | view | 657 |
| `slow.report_feed` | view | 666 |
| `wiki.pages` | table | 681 |
| `wiki.prose` | table | 693 |
