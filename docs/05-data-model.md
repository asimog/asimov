# 05 · Data model

One Postgres 17 database. Schemas: `tape`, `mem`, `board`, `reflex`, `mind`, `money`, `ops`, `agents` (LangGraph checkpoints), `bettafish` (owned by the BettaFish fork). Projections in `mem` can always be rebuilt from `tape.events`; nothing else can.

Roles: `octo_writer` may `INSERT` into `tape` and never `UPDATE` or `DELETE` there. Projection workers own `mem`. The `money` tables are written only by Hands and Treasury.

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
| `signals` | `id` pk, `kind`, `subject`, `value` jsonb, `confidence`, `produced_at`, `valid_until`, `inputs` text[], `organ` | Append-only. |
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
| `genomes` | `gn_` id, `spec` jsonb (docs/08 DSL), `parents` text[], `origin`, `born_at`, `retired_at`, `family`, `niche` |
| `ghost_positions` | `id`, genome, coin, opened_at, tokens, cost_sol, exits jsonb, closed_at, net_sol |
| `genome_scores` | genome, window, trades, net_sol, net_per_trade, follower_pnl_sol, max_drawdown, hit_rate, posterior jsonb |
| `allocations` | genome, capital_sol, since, posterior |
| `limits` | `version` pk, body jsonb, set_by, set_at | Only the admin path inserts. |

## money

| Table | Columns |
|---|---|
| `orders` | `or_` id, intent, genome, coin, side, size_sol, max_slippage_bps, state (created, submitted, filled, failed), tx_sig, limits_version |
| `fills` | order, tx_sig, tokens, sol, fee_sol, price_sol, slot |
| `positions` | `ps_` id, coin, tokens, cost_basis_sol, realized_pnl_sol, opened_at, closed_at, callout (our post id) |
| `posts` | id, kind, coin, pump_id, text, media_ref, because text[], state (queued, published, refused), published_at |
| `fee_sweeps` | `sp_` id, at, tx_sig, sol, to_war_chest_sol, to_ops_sol |
| `profit_hours` | hour pk, realized_pnl_sol, cumulative_pnl_sol, high_water_mark_sol, distributable_sol, holder_pool_sol |
| `holder_samples` | hour, sample_n (1..4), taken_at, owner, amount | Four random samples per hour. |
| `distributions` | `ds_` id, hour, manifest jsonb, manifest_sha256, state, tx_sigs text[] |
| `seats` | `st_` id, seat_number unique, payout_wallet, granted_at, deposit, paid_tokens, burn_tx, active, lifetime_sol |
| `seat_market` | singleton: last_sale_at, last_seat_number | Drives the premium decay in the quote. |
| `holder_clusters` | hour, cluster_id, owners text[], rule (common_funder, transfer_link), evidence | Published in each proof (docs/10). |
| `deposits` | `dp_` id, payout_wallet, deposit_address unique, derivation_index unique, quoted_seat, quoted_price_tokens, expires_at (15 min), state (open, filled, refunded, expired), received_tokens, tx_sigs |
| `accruals` | wallet pk, sol_owed, since | Payouts below 0.001 SOL wait here. |
| `ledger_proofs` | hour, segment_hash, prev_segment_hash, file_ref | Hash-joined hourly exports (chainplot pattern). |

## ops

| Table | Columns |
|---|---|
| `budgets` | organ, hour, units, cap, spent |
| `tentacle_sessions` | tentacle, session_id, state, url, task, started_at, last_frame_at |
| `scores` | target, metric, window, value, at |
| `admin_actions` | id, action, by, at, detail | Every human override. |
| `jobs` | `jb_` id, agent, trigger_event, state (queued, running, done, failed), lease_until, attempts, cost_usd, result_ref | Postgres job queue for thinking agents and System Two runs (`FOR UPDATE SKIP LOCKED`). |

## BettaFish schema

`bettafish.pumpfun_callout` and `bettafish.pumpfun_callout_comment` are **views** over `mem.callouts`, `mem.callout_updates` and replies. Their column names follow the MediaCrawler platform-table convention that BettaFish's InsightEngine expects (`title`/`content`, `nickname`, `liked_count`, `comment_count`, `share_count`, `create_time`, `source_keyword`, url column). The fork adds `pumpfun_callout` to InsightEngine's table list and hotness formula (docs/07).

## Retention

| Data | Keep |
|---|---|
| Tape | Forever in archive files; 90 days hot in Postgres for `trade.*`, forever for everything else |
| Frames | 7 days for Rewind, then 1 frame per minute per tentacle |
| HAR files | 30 days |
| Holder samples | Forever (they justify payouts) |
