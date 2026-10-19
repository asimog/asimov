# Tables and views

Generated from `services/core/src/sql/schema.sql` by `npm run docs:gen`. Do not edit by hand.

67 objects.

| Name | Kind | Line |
|---|---|---|
| `tape.events` | table | 14 |
| `tape.events_default` | table | 29 |
| `tape.events_default_inputs_hot` | table | 30 |
| `tape.events_default_inputs_kept` | table | 31 |
| `tape.events_default_derived` | table | 32 |
| `tape.dedupe` | table | 48 |
| `tape.consumer_offsets` | table | 54 |
| `tape.archived` | table | 62 |
| `tape.feed_cursors` | table | 94 |
| `tape.blobs` | table | 102 |
| `mem.coins` | table | 112 |
| `mem.callers` | table | 128 |
| `mem.callouts` | table | 138 |
| `mem.callout_updates` | table | 160 |
| `mem.bars_1m` | table | 167 |
| `mem.bar_buyers` | table | 178 |
| `board.signals` | table | 184 |
| `mind.strategies` | table | 199 |
| `mind.stats` | table | 210 |
| `mind.positions` | table | 228 |
| `mind.intents` | table | 253 |
| `mind.fills` | table | 269 |
| `mind.coin_callout` | table | 282 |
| `mind.commits` | table | 289 |
| `mind.desk_clock` | table | 297 |
| `mind.outcome_watch` | table | 303 |
| `mind.score_days` | table | 318 |
| `mind.prob_watch` | table | 330 |
| `mind.calibration` | table | 342 |
| `mind.coin_watch` | table | 351 |
| `mind.coin_precall` | table | 357 |
| `mind.house` | table | 367 |
| `mind.limits` | table | 377 |
| `mind.lists` | table | 384 |
| `ops.soul_versions` | table | 395 |
| `idx.wallet_coin` | table | 407 |
| `idx.wallet_coin_all` | table | 430 |
| `idx.wallet_day` | table | 449 |
| `idx.leaderboard` | table | 463 |
| `idx.coin` | table | 475 |
| `idx.wallet` | table | 489 |
| `idx.scout_wallet` | table | 502 |
| `idx.funder` | table | 508 |
| `idx.seed` | table | 515 |
| `hands.orders` | table | 523 |
| `hands.dead_letters` | table | 539 |
| `books.entries` | table | 545 |
| `books.balances` | table | 552 |
| `books.lots` | table | 553 |
| `books.realized` | table | 561 |
| `books.proofs` | table | 562 |
| `ops.kill` | table | 570 |
| `ops.kill_counts` | table | 580 |
| `mem.callout_replies` | table | 589 |
| `slow.reports` | table | 593 |
| `slow.jobs` | table | 600 |
| `slow.cursors` | table | 605 |
| `slow.pumpfun_callout` | view | 609 |
| `slow.pumpfun_callout_comment` | view | 619 |
| `slow.pumpfun_update` | view | 624 |
| `slow.pumpfun_caller` | view | 628 |
| `slow.pumpfun_coin` | view | 633 |
| `slow.pumpfun_trade_flow` | view | 639 |
| `slow.media` | view | 643 |
| `slow.report_feed` | view | 652 |
| `wiki.pages` | table | 667 |
| `wiki.prose` | table | 679 |
