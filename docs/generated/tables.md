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
| `mind.prob_watch` | table | 333 |
| `mind.calibration` | table | 345 |
| `mind.coin_watch` | table | 354 |
| `mind.coin_precall` | table | 360 |
| `mind.house` | table | 370 |
| `mind.limits` | table | 380 |
| `mind.lists` | table | 387 |
| `ops.soul_versions` | table | 398 |
| `idx.wallet_coin` | table | 410 |
| `idx.wallet_coin_all` | table | 433 |
| `idx.wallet_day` | table | 452 |
| `idx.leaderboard` | table | 466 |
| `idx.coin` | table | 478 |
| `idx.wallet` | table | 492 |
| `idx.scout_wallet` | table | 505 |
| `idx.funder` | table | 511 |
| `idx.seed` | table | 518 |
| `hands.orders` | table | 526 |
| `hands.dead_letters` | table | 542 |
| `books.entries` | table | 548 |
| `books.balances` | table | 555 |
| `books.lots` | table | 556 |
| `books.realized` | table | 564 |
| `books.proofs` | table | 565 |
| `ops.kill` | table | 573 |
| `ops.kill_counts` | table | 583 |
| `mem.callout_replies` | table | 592 |
| `slow.reports` | table | 596 |
| `slow.jobs` | table | 603 |
| `slow.cursors` | table | 608 |
| `slow.pumpfun_callout` | view | 612 |
| `slow.pumpfun_callout_comment` | view | 622 |
| `slow.pumpfun_update` | view | 627 |
| `slow.pumpfun_caller` | view | 631 |
| `slow.pumpfun_coin` | view | 636 |
| `slow.pumpfun_trade_flow` | view | 642 |
| `slow.media` | view | 646 |
| `slow.report_feed` | view | 655 |
| `wiki.pages` | table | 670 |
| `wiki.prose` | table | 682 |
