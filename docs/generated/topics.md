# Topics

Generated from `packages/contracts/src/index.ts` by `npm run docs:gen`. Do not edit by hand.

80 topics.

| Topic | Body fields |
|---|---|
| `observation.raw` | `kind`, `url`, `sha256`, `bytes`, `blob_ref`, `sample` |
| `coin.seen` | `mint`, `symbol`, `name`, `image`, `mcap_usd`, `program`, `chain` |
| `callout.created` | `callout_id`, `mint`, `symbol`, `name`, `author_wallet`, `author_user_id`, `author_handle`, `author_x`, `author_followers`, `author_total_callouts`, `text`, `media_url`, `mcap_at_call_usd`, `price_at_call_usd`, `created_at`, `chain`, `quoted_callout_id`, `author_position`, `via` |
| `callout.updated` | `callout_id`, `mint`, `update_id`, `text`, `created_at` |
| `callout.reply` | `callout_id`, `mint`, `reply_id`, `parent_id`, `wallet`, `handle`, `text`, `likes`, `media_url`, `created_at` |
| `media.cached` | `media_id`, `kind`, `mint`, `callout_id`, `url`, `sha256`, `bytes`, `mime` |
| `callout.counts` | `callout_id`, `mint`, `likes`, `replies`, `comments`, `reposts`, `quotes`, `views`, `multiple`, `max_multiple`, `mcap_usd` |
| `filter.sampled` | `reason`, `source`, `chain`, `callout`, `launch` |
| `caller.position` | `callout_id`, `mint`, `wallet`, `is_exited`, `amount_held`, `realized_pnl_sol`, `at` |
| `trade.curve` | `mint`, `tx`, `slot_index_id`, `ts`, `side`, `wallet`, `sol`, `usd`, `tokens`, `price_sol`, `price_usd`, `mcap_usd`, `on_curve`, `program`, `pool_sol` |
| `trade.amm` | `mint`, `tx`, `slot_index_id`, `ts`, `side`, `wallet`, `sol`, `usd`, `tokens`, `price_sol`, `price_usd`, `mcap_usd`, `on_curve`, `program`, `pool_sol` |
| `session.task` | `session`, `task_id`, `url`, `state`, `facts`, `boxes` |
| `session.read` | `session`, `task_id`, `url`, `state`, `facts`, `boxes` |
| `session.health` | `session`, `task_id`, `url`, `state`, `facts`, `boxes` |
| `jev.answer` | `pack`, `pack_version`, `model`, `subject`, `state_sha256`, `answers`, `latency_ms`, `input_tokens` |
| `intent.created` | `strategy_id`, `mint`, `side`, `size_sol`, `fraction`, `reason`, `in_play`, `score`, `board` |
| `intent.ghost_filled` | `intent_id`, `strategy_id`, `mint`, `side`, `sol`, `tokens`, `price_sol`, `fee_sol`, `rent_sol`, `slippage_bps` |
| `order.rejected` | `intent_id`, `reason_code`, `detail` |
| `order.created` | `order_id`, `intent_id`, `strategy_id`, `mint`, `side`, `size_sol`, `fraction`, `max_slippage_bps`, `limits_version` |
| `order.submitted` | `order_id`, `tx_sig`, `route`, `submitted_at` |
| `order.filled` | `order_id`, `intent_id`, `strategy_id`, `mint`, `side`, `tx_sig`, `tokens`, `sol`, `fee_sol`, `price_sol`, `slot`, `rent_sol` |
| `order.failed` | `order_id`, `tx_sig`, `error`, `retryable` |
| `signer.refused` | `job`, `reason` |
| `position.changed` | `order_id`, `strategy_id`, `mint`, `tokens`, `closed`, `account_closed`, `rent_back_sol` |
| `ledger.entry` | `entry_id`, `kind`, `tx_sig`, `legs` |
| `fees.swept` | `sweep_id`, `collect_sig`, `split_sig`, `collected_lamports`, `to_trade_lamports`, `to_agent_lamports`, `to_operator_lamports` |
| `books.reconciled` | `hour`, `ok`, `degraded`, `wallets` |
| `kill.changed` | `state`, `reason`, `by` |
| `limits.changed` | `version`, `key`, `value`, `by` |
| `lists.loaded` | `kind`, `version`, `count`, `sha256`, `by` |
| `config.loaded` | `file`, `sha256`, `value` |
| `proof.published` | `n`, `hour`, `sha256`, `prev_sha256`, `memo_sig` |
| `markout.measured` | `fill_id`, `mint`, `side`, `h1s`, `h10s`, `h60s`, `h5m`, `cost_bps` |
| `commit.made` | `commit_id`, `kind`, `sha256`, `reveal_after` |
| `commit.revealed` | `commit_id`, `content`, `matches` |
| `position.closed` | `position_id`, `strategy_id`, `mint`, `cost_sol`, `proceeds_sol`, `rent_refund_sol`, `net_sol`, `held_ms`, `exit_reason` |
| `strategy.born` | `strategy_id`, `family`, `horizon`, `origin`, `parents`, `spec` |
| `strategy.retired` | `strategy_id`, `reason`, `trades`, `lcb` |
| `kernel.allocation` | `round`, `hurdle`, `shares` |
| `calibration.map` | `family`, `version`, `decisions`, `bins` |
| `outcome.measured` | `method`, `callout_id`, `mint`, `author_wallet`, `horizon_min`, `t0`, `call_lag_ms`, `entry_basis`, `price0_sol`, `price_sol`, `multiple`, `peak_multiple`, `trough_multiple`, `t_peak_s`, `net_multiple`, `ref_sol`, `phase`, `graduated`, `trades`, `pre_call_trades`, `new_callouts`, `coverage`, `gaps`, `supersedes` |
| `score.updated` | `kind`, `horizon_min`, `n`, `brier`, `base_rate`, `skill` |
| `precall.detected` | `mint`, `caller`, `trade_id`, `buy_sol`, `p`, `horizon_min` |
| `coin.watched` | `mint`, `reason`, `wallet`, `note`, `buyers_60s`, `net_sol_60s`, `trigger_tx`, `features`, `creator_record` |
| `coin.unwatched` | `mint`, `reason`, `by` |
| `coin.graduated` | `mint`, `tx`, `price_sol`, `at` |
| `holders.snapshot` | `mint`, `supply`, `top`, `excluded`, `top10_share`, `features` |
| `index.refreshed` | `version`, `window_days`, `wallets`, `coins`, `smart` |
| `budget.spent` | `analyzer`, `units`, `amount`, `job_event_id` |
| `guard.refused` | `subject`, `where`, `rules` |
| `budget.exhausted` | `analyzer`, `hour`, `used`, `cap` |
| `thesis.formed` | `thesis_id`, `mint`, `strategy_id`, `position_id`, `kind`, `claims`, `prediction`, `plan`, `invalidation`, `commit_id` |
| `post.queued` | `post_id`, `kind`, `mint`, `house_id`, `thesis_id`, `text`, `checks`, `because`, `paper` |
| `synthesis.feed` | `synthesis_id`, `window_min`, `preset`, `narratives`, `coin_stances`, `suspicious`, `claims_total`, `claims_dropped` |
| `mood.feed` | `synthesis_id`, `mood`, `label`, `n_callouts` |
| `synthesis.coin` | `synthesis_id`, `mint`, `stance`, `narrative`, `claims`, `claims_total`, `claims_dropped`, `preset` |
| `synthesis.forum_line` | `synthesis_id`, `round`, `agent`, `text`, `cites` |
| `swarm.wave_p` | `swarm_id`, `mint`, `wave_p`, `samples`, `preset`, `usd`, `truncated` |
| `swarm.impact` | `swarm_id`, `mint`, `d_callers`, `d_net_sol`, `samples`, `truncated` |
| `swarm.post` | `swarm_id`, `mint`, `branch`, `platform`, `round`, `agent`, `archetype`, `text`, `simulated` |
| `proposal.strategy` | `proposal_id`, `by`, `spec`, `why`, `because` |
| `jevq.proposed` | `question_id`, `pack`, `text`, `type`, `by` |
| `report.drafted` | `report_id`, `day`, `text`, `checks` |
| `integrity.text` | `finding_id`, `text`, `checks` |
| `ops.alert` | `severity`, `text`, `finding` |
| `ops.stop_requested` | `action`, `scope`, `reason` |
| `ops.restart_requested` | `scope`, `reason` |
| `report.published` | `report_id`, `producer`, `kind`, `subject`, `window_from`, `window_to`, `preset`, `sha256`, `summary`, `cites`, `parent_reports`, `simulated`, `cites_dropped` |
| `swarm.beliefs` | `swarm_id`, `mint`, `topic`, `simulated`, `branches` |
| `attention.grant` | `job`, `subject`, `voi`, `cost_est`, `budget_left` |
| `jev.escalated` | `subject`, `gate_reasons`, `job`, `voi` |
| `soul.updated` | `version`, `sha256`, `prev_sha256`, `chain_sha256`, `reason`, `by`, `diff_ref` |
| `job.queued` | `job_id`, `agent`, `trigger_event`, `cost_usd`, `result_ref`, `error` |
| `job.started` | `job_id`, `agent`, `trigger_event`, `cost_usd`, `result_ref`, `error` |
| `job.done` | `job_id`, `agent`, `trigger_event`, `cost_usd`, `result_ref`, `error` |
| `system.note` | `kind`, `detail` |
| `system.gap` | `source`, `scope`, `from`, `to`, `reason` |
| `system.schema_drift` | `kind`, `detail` |
| `system.source_disagree` | `mint`, `fact`, `nats`, `rpc`, `at` |
| `tape.archived` | `partition`, `file`, `rows`, `sha256`, `target`, `from`, `to`, `at` |
