# 04 · Contracts

The shapes every part agrees on. Source of truth: JSON Schemas in `packages/contracts/schemas/`. TS types and Python models are generated from them. If code and this doc disagree, fix both in the same change.

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

- `source`: `feedtap | tentacle:T1..T8 | nats | rpc | grpc | xeye | reflex | guard | trader | herald | treasurer | wallet | scorekeeper | attention | brood | riskgate | agent:<name> | system`.
- `subject`: the main ID the event is about. Lets `octo why` and the website jump straight to it.
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
| `tentacle.task` | `tentacle`, `task_id`, `goal`, `url`, `granted_by` (attention event id) |
| `tentacle.read` | `tentacle`, `task_id`, `url`, `refs_read[{ref, role, text, box}]`, `extracted` (typed facts) |
| `tentacle.health` | `tentacle`, `state` (idle, reading, blocked, crashed), `fps`, `error?` |

### Mind

| Topic | Body |
|---|---|
| `attention.grant` | `job` (tentacle_read, swarm_run, synthesis_deep, x_lookup), `subject`, `voi`, `cost_est`, `budget_left` |
| `intent.created` | `genome_id`, `mint`, `side` (buy, sell), `size_sol` or `fraction`, `reason` (rule ids that fired), `board_snapshot_ref` |
| `intent.ghost_filled` | `intent_id`, `price_sol`, `tokens`, `slippage_bps`, `latency_ms_assumed` |
| `order.created` | `intent_id`, `mint`, `side`, `size_sol`, `max_slippage_bps`, `limits_version` |
| `order.rejected` | `intent_id`, `reason_code` (see Risk Gate codes in docs/08), `detail` |
| `genome.born` / `genome.retired` | `genome_id`, `parents[]`, `origin` (mutation, crossover, proposal, seed), `reason?` |
| `allocation.set` | `genome_id`, `capital_sol`, `posterior` |

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
| `profit.hour_closed` | `hour`, `realized_pnl_sol`, `high_water_mark_sol`, `distributable_sol` |
| `distribution.planned` / `distribution.sent` | `distribution_id`, `hour`, `recipients[{wallet, sol, why}]`, `manifest_sha256`, `tx_sigs[]` |
| `seat.order_created` | `deposit_id`, `payout_wallet`, `deposit_address`, `quoted_seat`, `quoted_price_tokens`, `expires_at` |
| `seat.deposit_seen` | `deposit_id`, `amount_tokens`, `from`, `tx_sig` |
| `seat.granted` / `seat.refunded` | `seat_id` or `deposit_id`, `seat_number`, `payout_wallet`, `burn_tx` or `refund_tx` |

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

### Scoring and system

| Topic | Body |
|---|---|
| `outcome.resolved` | `about` (signal or intent id), `horizon`, `observed` (value), `resolved_at` |
| `score.written` | `target` (signal kind, genome, organ, tentacle), `metric`, `value`, `window` |
| `budget.spent` / `budget.exhausted` | `organ`, `units`, `amount`, `job_event_id` |
| `system.mode` / `system.kill` / `system.pause` | `by`, `scope`, `reason` |

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
  "organ": "hawkes@3"
}
```

### Signal kinds (v1)

| Kind | Subject | Value | Valid for | Organ |
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
| `shadow.call_p` | coin | per tracked caller: P(calls in 2 h); plus expected count | 10 min | shadows |
| `caller.dna` | caller | lead time, median opportunity age, hit rate, follower PnL, sample size | 24 h | shadows |
| `synthesis.feed` | global | narratives with heat, cited callout ids | 30 min | bettafish |
| `synthesis.coin` | coin | stance, heat, key claims with citations | 30 min | bettafish |
| `mood.skin` | global and coin | fear, greed, fomo, disgust, calm (0..1 each) | 15 min | bettafish |
| `swarm.wave_p` | coin | P(wave) from the swarm, branch A and B | 30 min | miroshark |
| `swarm.impact` | coin | expected extra callers if the octopus calls | 30 min | miroshark |
| `hunt.finding` | caller or coin | pattern (echo_ring, late_caller, dump_on_followers), evidence ids, confidence | 7 d | hunt |
| `baseline.attention` | coin | TimesFM forecast of callouts/min | 15 min | baseline |
| `fly.action` | coin | buy, sell or hold from the fly readout | 1 min | fly |
| `jev.callout.<q>` | callout | Choice, Score or Noul answer with probabilities and confidence (mint, kind, thesis_quality, promo, countdown, injection) | 6 h | reflex |
| `jev.coin.<q>` | coin | narrative path, clone score, organic momentum, stance, mood channels | 5 min | reflex |
| `jev.wave_p` | coin | fast wave probability: Tier 1 Shadows combined with the `shadow` pack | 5 min | reflex |
| `jev.shadow.call_p` | coin | per candidate caller: P(calls in 2 h) from Jev | 5 min | reflex |
| `jev.entry.<q>` / `jev.exit.<q>` | coin | semantic red flags at entry; rug reports, cooling, new bellwether interest on held coins | 2 min | reflex |
| `jev.reply.<q>` | reply | spam, insult, FUD, question, insider claim; hide flag | 24 h | reflex |
| `jev.link.<q>` | pair of ids | same-entity score and disagreeing fields | 7 d | reflex |
| `jev.q.<id>` | any | an evolved question from the bank (docs/17) | per question | reflex |

## Intent and Order rules

- An intent always carries the `board_snapshot_ref`: the exact signals the genome saw. Replays and postmortems use it.
- An order is created only by the Risk Gate, with the `limits_version` it checked against.
- A post is created only by Herald from orders, position changes, or hunt findings above threshold.

## Naming

- Topics: `noun.verb_past` (`callout.created`), lowercase, dot-separated.
- Signal kinds: `organ.quantity` (`hawkes.wave_p`).
- One term per thing (see `GLOSSARY.md`). If a new word is needed, add it to the glossary in the same change.
