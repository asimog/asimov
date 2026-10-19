# Tables and views

Generated from `services/core/src/sql/schema.sql` by `npm run docs:gen`. Do not edit by hand.

65 objects.

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
| `mind.intents` | table | 252 |
| `mind.fills` | table | 268 |
| `mind.coin_callout` | table | 281 |
| `mind.commits` | table | 288 |
| `mind.desk_clock` | table | 296 |
| `mind.outcome_watch` | table | 302 |
| `mind.score_days` | table | 317 |
| `mind.prob_watch` | table | 329 |
| `mind.calibration` | table | 341 |
| `mind.coin_watch` | table | 350 |
| `mind.coin_precall` | table | 356 |
| `mind.house` | table | 366 |
| `mind.limits` | table | 376 |
| `mind.lists` | table | 383 |
| `ops.soul_versions` | table | 394 |
| `idx.wallet_coin` | table | 406 |
| `idx.wallet_coin_all` | table | 429 |
| `idx.wallet_day` | table | 448 |
| `idx.leaderboard` | table | 462 |
| `idx.coin` | table | 474 |
| `idx.wallet` | table | 488 |
| `idx.scout_wallet` | table | 501 |
| `idx.funder` | table | 507 |
| `idx.seed` | table | 514 |
| `hands.orders` | table | 522 |
| `hands.dead_letters` | table | 538 |
| `books.entries` | table | 544 |
| `books.balances` | table | 551 |
| `books.lots` | table | 552 |
| `books.realized` | table | 560 |
| `books.proofs` | table | 561 |
| `ops.kill` | table | 569 |
| `ops.kill_counts` | table | 579 |
| `mem.callout_replies` | table | 588 |
| `slow.reports` | table | 592 |
| `slow.jobs` | table | 599 |
| `slow.cursors` | table | 604 |
| `slow.pumpfun_callout` | view | 608 |
| `slow.pumpfun_callout_comment` | view | 618 |
| `slow.pumpfun_update` | view | 623 |
| `slow.pumpfun_caller` | view | 627 |
| `slow.pumpfun_coin` | view | 632 |
| `slow.pumpfun_trade_flow` | view | 638 |
| `slow.media` | view | 642 |
| `slow.report_feed` | view | 651 |
