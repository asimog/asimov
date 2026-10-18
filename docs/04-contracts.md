# 04 · Contracts

The shapes every part agrees on. Source of truth: the zod schemas in `packages/contracts/src/index.ts` (`TOPICS`). The Tape validates every body against them on write. JSON Schema for the Python services is emitted from the zod schemas when the first Python service needs it. Commit hashes are computed over `canonical()` JSON (sorted keys). If code and this doc disagree, fix both in the same change.

## Event envelope

```json
{
  "id": "ev_01JA...",
  "topic": "callout.created",
  "v": 1,
  "event_time": "2026-10-18T14:02:11.204Z",
  "seen_time":  "2026-10-18T14:02:12.880Z",
  "source": "feedtap",
  "subject": "co_01JA...",
  "causes": ["ob_01JA..."],
  "mode": "live",
  "body": { }
}
```

- `source`: `feedtap | session:S1..S8 | nats | rpc | grpc | xeye | reflex | guard | trader | publisher | treasurer | wallet | scorekeeper | attention | strategy pool | riskgate | agent:<name> | system`.
- `subject`: the main ID the event is about. Lets `ctl why` and the website jump straight to it.
- `causes`: upstream IDs. Must never be empty except for observations.
- `v`: schema version of `body`. Bump on any change. No backward compatibility (pre-users rule): replays use the tape's own version or are regenerated.

## Topics

### Senses

| Topic | Body (main fields) |
|---|---|
| `observation.raw` | `kind` (http, ws, dom, frame, tx), `url`, `request_id`, `blob_ref` (object storage key), `sha256` |
| `callout.created` | `callout_id` (pump id), `mint`, `author_wallet`, `author_handle`, `text`, `media[]`, `mcap_at_call_usd`, `price_sol_at_call`, `created_at`, `chain` |
| `callout.updated` | `callout_id`, `update_id`, `text`, `media[]`, `created_at` |
| `callout.reply` | `callout_id`, `mint`, `reply_id`, `parent_id?`, `wallet?`, `handle?`, `text`, `likes`, `media_url?`, `created_at` (Reply Reader, `GET /callout/{id}/replies`) |
| `media.cached` | `media_id`, `kind` (callout, coin), `mint`, `callout_id?`, `url`, `sha256`, `bytes`, `mime` (Media cache; the file is in `tape.blobs`) |
| `callout.reply` | `callout_id`, `reply_id`, `parent_id`, `author_wallet`, `text`, `created_at` |
| `callout.repost` / `callout.quote` | `callout_id`, `by_wallet`, `quote_text?`, `created_at` |
| `callout.counts` | `callout_id`, `likes`, `replies`, `reposts`, `quotes`, `observed_at` |
| `callout.deleted` | `callout_id`, `observed_at` |
| `caller.profile` | `wallet`, `handle`, `followers?`, `bio?`, `x_handle?`, `callout_ids_seen[]` |
| `trade.curve` / `trade.amm` | `UnifiedTradeSchema` fields from `@pump-fun/shared-contracts` (amountSol, baseAmount, marketCap, mintAddress, priceSol, tx, type, userAddress, timestamp, ...) |
| `curve.state` | `mint`, `virtual_sol`, `virtual_tokens`, `real_sol`, `real_tokens`, `progress`, `complete` |
| `coin.graduated` | `mint`, `pool`, `slot` |
| `wallet.funded_by` | `wallet`, `funder`, `first_funding_tx`, `at` |
| `coin.watched` (v2) | `mint`, `reason` (`caller_buy`, `smart_buy`, `heat`, `metrics`), `wallet` (the buyer for `caller_buy` and `smart_buy`), `buyers_60s`, `net_sol_60s`, `trigger_tx`, `features` (launch features at promotion: `from_birth` (seen from its first trade; bundle fields count only then), `fresh_known` (the Index is old enough to call a wallet new), `age_s`, `first_slot`, `creator`, `trades`, `buyers`, `holders_est`, `mcap_usd`, `bundle_buys`, `bundle_wallets`, `bundle_share`, `fresh_share`, `sniper_share`, `top_buyer_share`, `creator_sold`, `smart_buyers`). Written by the Scout (docs/06, docs/23) |
| `holders.snapshot` | `mint`, `supply`, `top[{account, amount}]` (largest token accounts), `excluded[]` (accounts owned by programs: the bonding curve, AMM pools, lockers), `top10_share` (of the whole supply, held by people) |
| `index.refreshed` | `version`, `window_days`, `wallets`, `coins`, `smart[{wallet, copy_net, copy_win_lcb, n, lead_s, archetype}]` (docs/23) |
| `x.post` | `handle`, `post_id`, `text`, `created_at`, `screenshot_ref` |
| `session.task` | `session`, `task_id`, `goal`, `url`, `granted_by` (attention event id) |
| `session.read` | `session`, `task_id`, `url`, `refs_read[{ref, role, text, box}]`, `extracted` (typed facts) |
| `session.health` | `session`, `state` (idle, reading, blocked, crashed), `fps`, `error?` |

### Mind

| Topic | Body |
|---|---|
| `attention.grant` | `job` (session_read, swarm_run, synthesis_deep, x_lookup), `subject`, `voi`, `cost_est`, `budget_left` |
| `intent.created` | `strategy_id`, `mint`, `side` (buy, sell), `size_sol` (buys) or `fraction` (tokens to sell), `reason[]` (score vs threshold, edge vs cost floor, or the exit rule), `score`, `board` (the score terms, edge and cost in bps, callout id) |
| `intent.ghost_filled` | `intent_id`, `strategy_id`, `mint`, `side`, `sol` (spent on buys incl. priority fee, received on sells), `tokens`, `price_sol` (average), `fee_sol` (pump fee + priority fee), `rent_sol` (token account, buys), `slippage_bps` |
| `position.closed` | `position_id`, `strategy_id`, `mint`, `cost_sol` (incl. rent), `proceeds_sol`, `rent_refund_sol`, `net_sol`, `held_ms`, `exit_reason` |
| `order.created` | `order_id` (subject), `intent_id`, `strategy_id`, `mint`, `side`, `size_sol` (buys) or `fraction` (sells), `max_slippage_bps`, `limits_version`. Written only by the live gate (`hands/order-gate.ts`), after the Risk Gate said yes. |
| `order.rejected` | `intent_id`, `reason_code` (Risk Gate codes in docs/08, plus `fill_failed` for a modeled landing failure), `detail` |
| `strategy.born` | `strategy_id`, `family`, `horizon`, `origin` (seed, mutation, crossover, proposal), `parents[]`, `spec` |
| `strategy.retired` | `strategy_id`, `reason` (lcb_below_zero, drawdown, markout_60s_negative, idle, pool_cap), `trades`, `lcb` |

### Hands

| Topic | Body |
|---|---|
| `order.submitted` | `order_id`, `tx_sig`, `route` (curve, amm), `submitted_at` |
| `order.filled` | `order_id`, `intent_id`, `strategy_id`, `mint`, `side`, `tx_sig`, `tokens`, `sol` (spent on buys, received on sells; measured from the transaction), `fee_sol` (pump fees + priority fee + tip + network fee), `price_sol`, `slot`, `rent_sol` (token account rent paid, buys) |
| `order.failed` | `order_id`, `tx_sig?`, `error`, `retryable` |
| `signer.refused` | `job`, `reason` (a treasury job the Signer refused: sweep, proof, collect; counts toward the kill trigger) |
| `position.changed` | `order_id`, `strategy_id`, `mint`, `tokens` (held after), `closed` (fully exited), `account_closed` (token account closed, rent back), `rent_back_sol` |
| `ledger.entry` | `entry_id`, `kind` (deposit, close_account, sweep_collect, sweep_split, memo, fee; fills are journaled by Books itself from `order.filled`), `tx_sig?`, `legs[{account, lamports}]` (debits positive, credits negative, sum 0). Accounts: `sol:<wallet>` (the chain balance), `pos:<mint>` (cost of tokens held), `rent:<wallet>`, `exp:fees`, `inc:creator_fees`, `ext:world`. |
| `books.reconciled` | `hour`, `ok`, `wallets[{wallet, ledger_lamports, chain_lamports}]`, `degraded?` |
| `kill.changed` | `on`, `reason`, `by` (owner, daily_loss, signer_refusals, fill_drift, feed_gap, books) |
| `proof.published` | `n`, `hour`, `sha256`, `prev_sha256`, `memo_sig?` |
| `thesis.formed` | `thesis_id`, `mint`, `strategy_id`, `position_id`, `kind` (`pre_call`, `post_call`), `claims[{class, text}]`, `prediction{p, horizon_min, what}`, `plan{entry_price_sol, size_sol, ladder[{mult, sell}], stop, max_hold_min}`, `invalidation[]`, `commit_id` |
| `post.queued` | `post_id`, `kind` (callout, update, reply), `mint`, `house_id` (our callout on the coin), `thesis_id` (null on updates), `text`, `checks[]` (rules passed), `because[]` (fill or position event ids), `paper` |
| `post.published` | `post_id`, `kind`, `pump_id`, `url`, `published_at` |
| `post.refused` | `post_id`, `reason` (cooldown, holding_below_threshold, moderation, existing, session) |
| `fees.swept` | `sweep_id`, `collect_sig?`, `split_sig?`, `collected_lamports` (0 when nothing), `to_trade_lamports`, `to_agent_lamports`, `to_operator_lamports` |
| `profit.hour_closed` (M5) | `hour`, `realized_pnl_sol`, `high_water_mark_sol`, `distributable_sol` |
| `distribution.planned` / `distribution.sent` (M5) | `distribution_id`, `hour`, `recipients[{wallet, sol, why}]`, `manifest_sha256`, `tx_sigs[]` |
| `seat.order_created` (M5) | `deposit_id`, `payout_wallet`, `deposit_address`, `quoted_seat`, `quoted_price_tokens`, `expires_at` |
| `seat.deposit_seen` (M5) | `deposit_id`, `amount_tokens`, `from`, `tx_sig` |
| `seat.granted` / `seat.refunded` (M5) | `seat_id` or `deposit_id`, `seat_number`, `payout_wallet`, `burn_tx` or `refund_tx` |

### Labs

| Topic | Body |
|---|---|
| `synthesis.run` | `run_id`, `scope` (feed, coin), `subject?`, `started_at`, `finished_at?`, `report_ref?` |
| `synthesis.forum_line` | `run_id`, `agent` (insight, query, media, host), `text`, `cited[]` (`co_` ids) |
| `swarm.run` | `run_id`, `coin`, `branches` (A, B), `agents`, `rounds`, `cost_usd`, `state` (running, done, truncated) |
| `swarm.post` | `run_id`, `branch`, `round`, `agent` (simulated id and persona), `kind` (callout, reply, buy, sell), `text?`, `simulated: true` |

### Reflex and agents

| Topic | Body |
|---|---|
| `jev.answer` | `pack`, `pack_version`, `model` (versioned id), `subject`, `state_sha256`, `state_ref` (blob), `answers` (raw response), `latency_ms`, `input_tokens` |
| `jev.escalated` | `subject`, `gate_reasons[]`, `job` (synthesis_coin, swarm_run), `voi` |
| `guard.verdict` | `text_ref`, `destination` (llm:<agent>, post), `verdict` (pass, review, block), `flags{}` |
| `jevq.proposed` / `jevq.promoted` / `jevq.dropped` | `question_id`, `pack`, `text`, `type`, `lift?` |
| `job.queued` / `job.started` / `job.done` | `job_id`, `agent`, `trigger_event`, `cost_usd?`, `result_ref?`, `error?`. Written by the agents runtime through the `job_event` tool |
| `synthesis.feed` | `synthesis_id`, `window_min`, `preset`, `narratives[{title, summary, cites[]}]`, `coin_stances[{mint, symbol, stance, why, cites[]}]`, `suspicious[{pattern, text, cites[]}]`, `claims_total`, `claims_dropped`. Core refuses a claim whose `cites` is empty or names a callout it has not seen. The Board signal of the same kind is projected from it |
| `mood.feed` | `synthesis_id`, `mood` (-1 to 1, computed by code from callout text), `label`, `n_callouts` |
| `synthesis.coin` | `synthesis_id`, `mint`, `stance`, `narrative`, `claims[{text, cites[]}]`, `claims_total`, `claims_dropped`, `preset` |
| `synthesis.forum_line` | `synthesis_id`, `round`, `agent` (insight, query, media, host), `text`, `cites[]` |
| `swarm.wave_p` | `swarm_id`, `mint`, `wave_p` (share of branch-A samples reaching 5 or more distinct tracked callers), `samples`, `preset`, `usd`, `truncated` |
| `swarm.impact` | `swarm_id`, `mint`, `d_callers`, `d_net_sol` (branch B minus A), `samples`, `truncated` |
| `swarm.post` | `swarm_id`, `mint`, `branch` (A, B), `round`, `agent`, `archetype`, `text`, `simulated` (always true) |
| `proposal.strategy` | `proposal_id`, `by`, `spec` (a valid DSL spec, docs/08), `why[]`, `because[]` (event ids). A record only; the Strategy Pool decides what to do with it |
| `jevq.proposed` | `question_id`, `pack`, `text`, `type` (yes_no, probability), `by` |
| `report.drafted` | `report_id`, `day`, `text`, `checks[]`. A draft; publishing is S9 |
| `integrity.text` | `finding_id`, `text`, `checks[]`. Prose for `/integrity`; it states data and names no person |
| `ops.alert` | `severity` (info, warn, page), `text`, `finding` |
| `report.published` | `report_id`, `producer`, `kind` (feed, coin, swarm), `subject`, `window_from?`, `window_to?`, `preset`, `sha256` (of the canonical IR and Markdown in `slow.reports`), `summary`, `cites[]`, `parent_reports[]`, `simulated`, `cites_dropped` (docs/24 section 6) |
| `ops.restart_requested` | `scope`, `reason`. The Ops agent asks the owner to restart a consumer or sense; a record only, nothing restarts on it |
| `ops.stop_requested` | `action` (pause, kill), `scope`, `reason`. The kill switch (S6.7) acts on it; thinking agents can stop, never start |
| `soul.updated` | `version`, `sha256`, `prev_sha256`, `chain_sha256`, `reason`, `by`, `diff_ref` (blob) |
| `wallet.audit` | `endpoint`, `capability`, `accepted`, `reason?`, `request_sha256` |

### Firm

| Topic | Body |
|---|---|
| `commit.made` | `commit_id`, `kind` (hypothesis, forecast, decision), `sha256`, `reveal_after` |
| `commit.revealed` | `commit_id`, `content`, `matches` (sha256 of canonical JSON of `content` equals the committed hash) |
| `markout.measured` | `fill_id` (the fill event), `mint`, `side`, `h1s`, `h10s`, `h60s`, `h5m` (bps in our favor against our fill price; null if the coin went quiet) |
| `books.reconciled` | `hour`, `ledger_sol`, `chain_sol`, `diff_lamports`, `ok` |
| `nav.daily` | `day`, `nav_usd`, `nav_sol`, `components{}` |
| `counsel.request` | `request_id`, `action`, `facts_ref` |
| `counsel.decision` | `request_id`, `decision` (approve, deny, conditions), `signature` |
| `milestone.changed` | `from`, `to`, `reason`, `evidence[]` |
| `kernel.allocation` | `round`, `hurdle`, `shares[{strategy_id, n, mean, lcb, sample, share, stage}]` (desk level today; venues, social and budget levels reuse the shape) |
| `forecast.made` / `forecast.resolved` | `market` (venue, id), `question`, `p`, `market_p_at_commit`, `commit_id`; on resolve `outcome`, `brier` |
| `social.snapshot` | `day`, `followers_pump`, `followers_x`, `engagement{}`, `visitors`, `bounty_participants` |
| `social.posted` | `channel` (x, pumpfun), `post_id`, `kind`, `because[]` |
| `bounty.posted` / `bounty.submission` / `bounty.paid` | `bounty_id`, `channel`, `task`, `budget_sol`, `deadline`; submission `by`, `ref`; paid `to`, `sol`, `tx_sig` |
| `build.task` / `build.pr` / `build.result` | `task_id`, `goal`, `repo`; pr `url`, `branch`; result `suites{}`, `artifacts_ref`, `merged` |

### Scoring and system

| Topic | Body |
|---|---|
| `outcome.measured` (v2) | `method` (`ov2`), `callout_id`, `mint`, `author_wallet`, `horizon_min` (1, 3, 5 by default), `t0` (the callout's `seen_time`), `call_lag_ms`, `entry_basis` (`last_before`, `first_after`, `none`), `price0_sol`, `price_sol`, `multiple`, `peak_multiple`, `trough_multiple`, `t_peak_s`, `net_multiple` (round trip of `ref_sol` through the fill model), `ref_sol`, `phase` (`curve`, `amm`), `graduated`, `trades`, `pre_call_trades`, `new_callouts`, `coverage` (`ok`, `no_entry`, `no_trades`, `gap`), `gaps[]` (event ids), `supersedes` (event id of the outcome this one corrects, or null). Rules: docs/07 scorekeeper |
| `score.updated` | `kind` (probability signal), `horizon_min`, `n`, `brier`, `base_rate`, `skill` (1 − Brier / base-rate variance) |
| `budget.spent` / `budget.exhausted` | `analyzer`, `units`, `amount`, `job_event_id` |
| `system.mode` / `system.kill` / `system.pause` | `by`, `scope`, `reason` |
| `system.gap` (v2) | `source` (`feed`, `feed.push`, `trades`, `rpc`), `scope` (a mint, or null for the whole source), `from`, `to` (null: still missing, for example a coin that left the watched set), `reason`. Written by the sense that missed the data (docs/07 coverage) |

## Signal

```json
{
  "id": "sg_01JA...",
  "kind": "hawkes.wave_p",
  "subject": "cn_01JA...",
  "value": 0.64,
  "confidence": 0.7,
  "produced_at": "...",
  "valid_until": "...",
  "inputs": ["ev_...", "sg_..."],
  "analyzer": "hawkes@3"
}
```

### Signal kinds (v1)

| Kind | Subject | Value | Valid for | Analyzer |
|---|---|---|---|---|
| `age.opportunity` | callout | minutes since first call on the coin, and % price move before this call | 6 h | age |
| `echo.score` | callout | 0..1 share of this call explained by an earlier origin | 2 h | echo |
| `echo.ring` | caller | ring id and member callers | 24 h | echo |
| `hawkes.intensity` | coin | callouts per minute expected now | 2 min | hawkes |
| `hawkes.branching` | coin | branching ratio n | 5 min | hawkes |
| `hawkes.wave_p` | coin | P(≥5 tracked callers in 2 h) | 5 min | hawkes |
| `regime.state` | coin | posterior over {dormant, stirring, ignition, wave, crowded, distribution} | 2 min | regime |
| `regime.tremor` | coin | change-point probability and the series that broke | 10 min | regime |
| `curve.quote` | coin | SOL in → tokens, price impact, mcap at given sizes | 30 s | curve |
| `curve.progress` | coin | 0..1 and SOL to graduation | 30 s | curve |
| `flow.state` | coin | 60 s buys, sells, unique buyers, net SOL, acceleration, top-buyer share, known callers buying, heat 0..1 | 2 min | flow |
| `precall.callout_p` | coin | P(a callout on the coin within the horizon) over known callers who bought it; the most likely caller, their buy-to-call lag, peak record, population rate | horizon | precall |
| `risk.state` | coin | Rug and bundle features: `bundle_share`, `bundle_wallets`, `fresh_share`, `sniper_share`, `top10_share` (curve excluded, null until a snapshot), `creator_sold`, `breaches` (count over the owner's floor), `score` 0..1 (higher is riskier) | 30 min | risk |
| `wallets.smart_buying` | coin | Index smart wallets that bought in the last `SMART_WINDOW_MIN`: `n`, `score` 0..1, `best_wallet`, `copy_net_med`, `lead_s_med` | window | wallets |
| `callers.call_p` | coin | per tracked caller: P(calls in 2 h); plus expected count | 10 min | shadows |
| `caller.dna` | caller | calls seen (`n`), median opportunity age and pre-move, and from our own outcomes resolved before the callout: `resolved`, `net_win` (share with `net_multiple > 1` at 5 min), `med_net` | 24 h | callers |
| `synthesis.feed` | global | narratives with heat, cited callout ids | 30 min | bettafish |
| `synthesis.coin` | coin | stance, heat, key claims with citations | 30 min | bettafish |
| `mood.feed` | global and coin | fear, greed, fomo, disgust, calm (0..1 each) | 15 min | bettafish |
| `swarm.wave_p` | coin | P(wave) from the swarm, branch A and B | 30 min | miroshark |
| `swarm.impact` | coin | expected extra callers if the agent calls | 30 min | miroshark |
| `integrity.finding` | caller or coin | pattern (echo_ring, late_caller, dump_on_followers), evidence ids, confidence | 7 d | hunt |

Hunt indicators (`wash_atomic`, `bundle_buy`, `author_trades`, `ticker_collision`, `no_pump_suffix`, `thin_curve`) are not signals in v1. Case files compute them from the Tape on demand (docs/07 case files), so they need no Board history.
| `baseline.attention` | coin | TimesFM forecast of callouts/min | 15 min | baseline |
| `fly.action` | coin | buy, sell or hold from the fly readout | 1 min | fly |
| `jev.callout.<q>` | callout | Choice, Score or Noul answer with probabilities and confidence (mint, kind, thesis_quality, promo, countdown, injection) | 6 h | reflex |
| `jev.coin.<q>` | coin | narrative path, clone score, organic momentum, stance, mood channels | 5 min | reflex |
| `jev.wave_p` | coin | fast wave probability: Tier 1 Caller models combined with the `callers` pack | 5 min | reflex |
| `jev.callers.call_p` | coin | per candidate caller: P(calls in 2 h) from Jev | 5 min | reflex |
| `jev.entry.<q>` / `jev.exit.<q>` | coin | semantic red flags at entry; rug reports, cooling, new bellwether interest on held coins | 2 min | reflex |
| `jev.reply.<q>` | reply | spam, insult, FUD, question, insider claim; hide flag | 24 h | reflex |
| `jev.link.<q>` | pair of ids | same-entity score and disagreeing fields | 7 d | reflex |
| `jev.q.<id>` | any | an evolved question from the bank (docs/17) | per question | reflex |

## Intent and Order rules

- An intent always carries the `board_snapshot_ref`: the exact signals the strategy saw. Replays and postmortems use it.
- An order is created only by the Risk Gate, with the `limits_version` it checked against.
- A post is created only by Publisher from orders, position changes, or hunt findings above threshold.

## Naming

- Topics: `noun.verb_past` (`callout.created`), lowercase, dot-separated.
- Signal kinds: `analyzer.quantity` (`hawkes.wave_p`).
- One term per thing (see `GLOSSARY.md`). If a new word is needed, add it to the glossary in the same change.
