# 05 · Data model

One Postgres 17 database. Schemas: `tape`, `mem`, `board`, `reflex`, `mind`, `money`, `ops`, `agents` (LangGraph checkpoints), `bettafish` (owned by the BettaFish fork). Projections in `mem` can always be rebuilt from `tape.events`; nothing else can.

Roles: `core_writer` may `INSERT` into `tape` and never `UPDATE` or `DELETE` there. Projection workers own `mem`. The `money` tables are written only by Hands and Treasury.

## tape

| Table | Columns | Notes |
|---|---|---|
| `events` | `id` text pk, `topic` text, `v` int, `event_time` timestamptz, `seen_time` timestamptz, `source` text, `subject` text, `causes` text[], `mode` text, `body` jsonb | Partition by month on `seen_time`. Index `(topic, seen_time)`, `(subject, seen_time)`, GIN on `causes`. |
| `consumer_offsets` | `consumer` text pk, `last_seen_time`, `last_event_id`, `updated_at` | Resume point per consumer. |
| `observations` | `id` pk, `kind`, `url`, `request_id`, `blob_ref`, `sha256`, `seen_time` | Raw blobs live in object storage. |

## mem (projections)

| Table | Key | Main columns |
|---|---|---|
| `coins` | `cn_` id, unique `mint` | symbol, name, creator, created_at, curve state, graduated_at, pool, last_price_sol, last_mcap_usd |
| `callers` | `cl_` id, unique `wallet` | handle, x_handle, first_seen, callout_count, dna (jsonb, from `caller.dna`) |
| `callouts` | `co_` id, unique `pump_callout_id` | coin, caller, text, media, mcap_at_call, price_at_call, created_at, first_call_on_coin bool, opportunity_age_min, pre_move_pct, echo_score, counts (jsonb), deleted |
| `callout_updates` | `pump_update_id` | callout, text, created_at |
| `callout_edges` | (from, to, kind) | kind: reply, repost, quote, same_origin (echo). Weighted. |
| `bars_1m` | (coin, minute) | open, high, low, close (SOL), volume_sol, buys, sells, unique_buyers, callouts, distinct_callers, quality_weighted_calls, echo_ratio, net_flow_sol, top10_share |
| `wallets` | `wl_` id, unique address | role guesses (creator, caller, sniper, bundler), linked caller |
| `wallet_links` | (wallet, caller) | evidence ids, confidence |
| `x_posts` | post_id | handle, text, created_at, screenshot_ref |

## board

| Table | Columns | Notes |
|---|---|---|
| `signals` | `id` pk, `kind`, `subject`, `value` jsonb, `confidence`, `produced_at`, `valid_until`, `inputs` text[], `analyzer` | Append-only. |
| view `live` | latest signal per `(kind, subject)` where `valid_until > now()` | Replays query with the virtual clock instead of `now()`. |

## reflex

| Table | Columns | Notes |
|---|---|---|
| `packs` | name, version pk, questions jsonb, state_builder, model, created_at | A pack version never changes; edits make a new version. |
| `questions` | `jq_` id, pack, type (choice, score, noul, box), text, options or levels jsonb, status (shadow, live, dropped), born_at, lift jsonb | The evolving question bank. |
| `cache` | (pack_version, state_sha256) pk, answers jsonb, model, at | What-if replays and dedupe of identical states. |

## mind

| Table | Columns |
|---|---|
| `strategies` | `sr_` id, `spec` jsonb (docs/08 DSL), `family`, `horizon`, `parents` text[], `origin`, `born_at`, `retired_at`, `retire_reason` |
| `stats` | strategy pk, trades, wins, net_sum and net_sq (returns per SOL), rets[] (last 400), equity, peak, max_dd (SOL), mk60[] (60 s buy markouts), stage (ghost, probe, full), share, last_trade_at |
| `positions` | `ps_` id, strategy, mint, callout, opened_at, tokens, tokens_left, cost_sol (incl. rent), proceeds_sol, rent_sol, entry_price, exit_bands (±5% per exit), exits jsonb, commit, closed_at, net_sol, exit_reason. One row per ghost book position. |
| `intents` | `in_` id, strategy, mint, side, size_sol, fraction (tokens to sell), position, reason, created_at, fill_after (intent time + modeled latency), event. Pending only: deleted when filled or refused. |
| `fills` | fill event id, intent, strategy, mint, side, at, price_sol, mk jsonb (h1s, h10s, h60s, h5m), done |
| `coin_callout` | mint pk, latest callout, author wallet, at. Joins coin signals to callout and caller signals. |
| `commits` | `cm_` id, kind, sha256, content jsonb (private until revealed), made_at, revealed_at |
| `desk_clock` | name pk (next_alloc, next_evolve), at, round. Periodic rounds run on Tape time. |
| `outcome_watch` | callout pk, the callout's event id, mint, author, created_at (platform time), at (`t0`, our seen time), probs jsonb (probability signals at callout time), done int[] (resolved horizons). Prices are read from the Tape at resolution (docs/07) |
| `scores` | (kind, horizon_min) pk, n, brier_sum, hits, p_sum |
| `limits` | `version` pk, body jsonb, set_by, set_at | Only the admin path inserts. |

## money

| Table | Columns |
|---|---|
| `orders` | `or_` id, intent, strategy, coin, side, size_sol, max_slippage_bps, state (created, submitted, filled, failed), tx_sig, limits_version |
| `fills` | order, tx_sig, tokens, sol, fee_sol, price_sol, slot |
| `positions` | `ps_` id, coin, tokens, cost_basis_sol, realized_pnl_sol, opened_at, closed_at, callout (our post id) |
| `posts` | id, kind, coin, pump_id, text, media_ref, because text[], state (queued, published, refused), published_at |
| `fee_sweeps` | `sp_` id, at, tx_sig, sol, to_war_chest_sol, to_ops_sol |
| `hands.orders` | order_id pk, intent_id, state (submitted, retry, filled, failed), tx_sig, memo, attempts, next_at, close_pending, created_at, updated_at. The Trader's own idempotency record; `submitted` commits before the confirm wait. |
| `hands.dead_letters` | event_id pk, consumer, error, at. An event the Trader could not process. |
| `books.entries` | entry_id pk, seen_time, kind, tx_sig, legs jsonb. Projection of `ledger.entry`. |
| `books.balances` | account pk, lamports. Sum of legs. |
| `books.lots` | seq, strategy_id, mint, tokens, cost_sol. FIFO cost basis; `books.realized` holds realized SOL per strategy and day. |
| `ops.kill` | singleton: state (running, exit_only, halted), reason, by, at. Projection of `kill.changed`; read by the Risk Gate flags and the Trader. |
| `ops.kill_counts` | cause, at, event_id pk. Occurrences counted towards the automatic triggers (signer refusals, fill drift); cleared on resume. |
| `books.proofs` | n pk, hour, sha256, prev_sha256, body jsonb, memo_sig |
| `profit_hours` | hour pk, realized_pnl_sol, cumulative_pnl_sol, high_water_mark_sol, distributable_sol, holder_pool_sol |
| `holder_samples` | hour, sample_n (1..4), taken_at, owner, amount | Four random samples per hour. |
| `distributions` | `ds_` id, hour, manifest jsonb, manifest_sha256, state, tx_sigs text[] |
| `seats` | `st_` id, seat_number unique, payout_wallet, granted_at, deposit, paid_tokens, burn_tx, active, lifetime_sol |
| `seat_market` | singleton: last_sale_at, last_seat_number | Drives the premium decay in the quote. |
| `holder_clusters` | hour, cluster_id, owners text[], rule (common_funder, transfer_link), evidence | Published in each proof (docs/10). |
| `deposits` | `dp_` id, payout_wallet, deposit_address unique, derivation_index unique, quoted_seat, quoted_price_tokens, expires_at (15 min), state (open, filled, refunded, expired), received_tokens, tx_sigs |
| `accruals` | wallet pk, sol_owed, since | Payouts below 0.001 SOL wait here. |
| `ledger_proofs` | hour, segment_hash, prev_segment_hash, file_ref | Hash-joined hourly exports (chainplot pattern). |

## social, forecasts, builds

| Table | Columns |
|---|---|
| `social.daily` | day pk, followers_pump, followers_x, engagement jsonb, visitors, bounty_participants |
| `social.posts` | id, channel, post_id, kind, because text[], at |
| `social.bounties` | id, channel, task, budget_sol, deadline, state, results jsonb |
| `forecasts.forecasts` | id, venue, market_id, question, p, market_p, commit_id, made_at, outcome, brier |
| `builds.tasks` | id, goal, repo, state, pr_url, suites jsonb, artifacts_ref, merged_at |

Money tables for payouts and seats (`profit_hours`, `holder_samples`, `distributions`, `seats`, `deposits`, `accruals`) are created at milestone M5.

## ops

| Table | Columns |
|---|---|
| `browser_sessions` | session, session_id, state, url, task, started_at, last_frame_at |
| `scores` | target, metric, window, value, at |
| `soul_versions` | version, sha256, prev_sha256, chain_sha256, body, reason, by, at | Every `SOUL.md` version. `chain_sha256 = sha256(prev chain + sha256(body))`; version 0 is the genesis file. Written only by `soul.update` in core. |

## agents (own schema, own role)

Thinking agents get no access to `tape`, `mem` or `mind`; they read and write through the core MCP server. The agents process owns the schema `agents`:

| Table | Columns | Notes |
|---|---|---|
| `jobs` | `jb_` id, agent, trigger, dedupe (unique), state (queued, running, done, failed), attempts, cost_usd, result, error, created_at, started_at, finished_at | The job queue (`FOR UPDATE SKIP LOCKED`). Triggers are cron slots and Tape events; no agent decides which agent runs. |
| `cursors` | agent, seen_time, id | Where each event trigger stopped reading. |
| `spend` | lane, hour, usd | Per-lane spend, checked before every model call. |
| LangGraph checkpoint tables | made by `@langchain/langgraph-checkpoint-postgres` | One thread per job. |

## BettaFish schema

`bettafish.pumpfun_callout` and `bettafish.pumpfun_callout_comment` are **views** over `mem.callouts`, `mem.callout_updates` and replies. Their column names follow the MediaCrawler platform-table convention that BettaFish's InsightEngine expects (`title`/`content`, `nickname`, `liked_count`, `comment_count`, `share_count`, `create_time`, `source_keyword`, url column). The fork adds `pumpfun_callout` to InsightEngine's table list and hotness formula (docs/07).

## Retention

| Data | Keep |
|---|---|
| Tape | Forever in archive files; 90 days hot in Postgres for `trade.*`, forever for everything else |
| Frames | 7 days for Rewind, then 1 frame per minute per session |
| HAR files | 30 days |
| Holder samples | Forever (they justify payouts) |
