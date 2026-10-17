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
| `callout.reply` | `callout_id`, `reply_id`, `parent_id`, `author_wallet`, `text`, `created_at` |
| `callout.repost` / `callout.quote` | `callout_id`, `by_wallet`, `quote_text?`, `created_at` |
| `callout.counts` | `callout_id`, `likes`, `replies`, `reposts`, `quotes`, `observed_at` |
| `callout.deleted` | `callout_id`, `observed_at` |
| `caller.profile` | `wallet`, `handle`, `followers?`, `bio?`, `x_handle?`, `callout_ids_seen[]` |
| `trade.curve` / `trade.amm` | `UnifiedTradeSchema` fields from `@pump-fun/shared-contracts` (amountSol, baseAmount, marketCap, mintAddress, priceSol, tx, type, userAddress, timestamp, ...) |
| `curve.state` | `mint`, `virtual_sol`, `virtual_tokens`, `real_sol`, `real_tokens`, `progress`, `complete` |
| `coin.graduated` | `mint`, `pool`, `slot` |
| `holders.snapshot` | `mint`, `taken_at`, `holders[{owner, amount}]` (only for our coin and watched coins) |
| `wallet.funded_by` | `wallet`, `funder`, `first_funding_tx`, `at` |
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
| `order.created` | `intent_id`, `mint`, `side`, `size_sol`, `max_slippage_bps`, `limits_version` |
| `order.rejected` | `intent_id`, `reason_code` (Risk Gate codes in docs/08, plus `fill_failed` for a modeled landing failure), `detail` |
| `strategy.born` | `strategy_id`, `family`, `horizon`, `origin` (seed, mutation, crossover, proposal), `parents[]`, `spec` |
| `strategy.retired` | `strategy_id`, `reason` (lcb_below_zero, drawdown, markout_60s_negative, idle, pool_cap), `trades`, `lcb` |

### Hands

| Topic | Body |
|---|---|
| `order.submitted` | `order_id`, `tx_sig`, `route` (curve, amm), `submitted_at` |
| `order.filled` | `order_id`, `tx_sig`, `tokens`, `sol`, `fee_sol`, `price_sol`, `slot` |
| `order.failed` | `order_id`, `tx_sig?`, `error`, `retryable` |
| `position.changed` | `position_id`, `mint`, `tokens`, `cost_basis_sol`, `realized_pnl_sol` |
| `post.queued` | `kind` (callout, update, reply), `mint`, `callout_id?`, `text`, `media_ref?`, `because[]` (order or signal ids) |
| `post.published` | `post_id`, `kind`, `pump_id`, `url`, `published_at` |
| `post.refused` | `post_id`, `reason` (cooldown, holding_below_threshold, moderation, existing, session) |
| `fees.swept` | `sweep_id`, `tx_sig`, `sol`, `to_war_chest_sol`, `to_ops_sol` |
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
| `job.queued` / `job.started` / `job.done` | `job_id`, `agent`, `trigger_event`, `cost_usd?`, `result_ref?` |
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
| `soul.updated` | `version`, `sha256`, `diff_ref` |
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
