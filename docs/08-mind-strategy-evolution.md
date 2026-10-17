# 08 · Mind: strategies that evolve

There is no fixed list of strategies. Strategies are **genomes**: small JSON rule sets over Board signals. A population of them, the **Brood**, trades on paper all the time. The **Allocator** gives real capital to the ones that earn it. The **Risk Gate** has the last word on every order.

## Genome DSL

A genome is data. No code, no `eval`. The interpreter is a pure TS function.

```json
{
  "id": "gn_01JA...",
  "family": "wave_anticipation",
  "horizon": "medium",
  "universe": { "all": [
    { "sig": "regime.state", "field": "p.stirring", "op": ">=", "v": 0.5 },
    { "sig": "age.opportunity", "field": "pre_move_pct", "op": "<", "v": 40 },
    { "sig": "curve.progress", "field": "p", "op": "<", "v": 0.85 }
  ]},
  "score": { "sum": [
    { "w": 0.6, "sig": "hawkes.wave_p" },
    { "w": 0.3, "sig": "swarm.wave_p", "missing": "skip" },
    { "w": 0.3, "sig": "jev.wave_p" },
    { "w": 0.2, "sig": "jev.callout.thesis_quality", "field": "score_norm" },
    { "w": -0.4, "sig": "jev.coin.clone", "field": "score_norm" },
    { "w": 0.2, "sig": "shadow.call_p", "field": "expected_count_norm" },
    { "w": -0.5, "sig": "echo.score", "field": "max_recent" }
  ]},
  "enter_if": { "score_gte": 0.55 },
  "size": { "kelly_fraction": 0.25, "max_sol": 1.0, "max_impact_bps": 300 },
  "call": { "policy": "after_fill", "template": "wave" },
  "exits": [
    { "when": { "mult_gte": 2.0 }, "sell": 0.25 },
    { "when": { "mult_gte": 3.0 }, "sell": 0.25 },
    { "when": { "sig": "regime.state", "field": "p.crowded", "op": ">=", "v": 0.6 }, "sell": 0.5 },
    { "when": { "held_min_gte": 360 }, "sell": 1.0 }
  ],
  "stop": { "any": [ { "mult_lte": 0.6 }, { "sig": "regime.tremor", "op": "exists" } ] }
}
```

Rules:

- A `sig` must be a kind in `04-contracts.md`. The validator rejects unknown kinds and fields.
- `missing`: `skip` drops the term and renormalizes weights; a number uses that value. Default is `skip`. This is how genomes keep working while slow organs (BettaFish, MiroShark) have no fresh signal.
- `call.policy`: `after_fill` (post once the holding is confirmed), `after_fill_delay:<s>`, or `silent` (trade without a callout).
- `horizon: fast` genomes may only reference System One signals (math organs and `jev.*`). The validator rejects a fast genome that references `synthesis.*` or `swarm.*`.
- Jev answers are used as probabilities and confidence, never as numbers to do math on inside Jev. Weights live in the genome and evolve.
- Exit `mult_gte` values are bands: the Executor picks a point inside ±5% at random, so copy-traders cannot front-run exact levels.
- Families are labels for niches, not code paths. Seed families: `wave_anticipation`, `bellwether_follow`, `graduation_run`, `narrative_rotation`, `fly`. New families can appear through mutation or proposals.

## The Brood loop

| Step | When | What |
|---|---|---|
| Evaluate | Every Board change for a coin, and every 5 s | Every genome checks universe, score, entry, exits and stops for coins it watches. Outputs intents. |
| Ghost fill | Every intent | The fill model fills it on paper. Every genome builds a ghost record, whether or not it has capital. |
| Score | At exits and horizons | `genome_scores` updated: net SOL per trade after all costs, follower PnL, drawdown, hit rate. |
| Allocate | Every 15 min | Allocator sets capital per genome (below). |
| Evolve | Every hour | Selection, mutation, crossover, proposals, retirement (below). |

## Fill model (shared by ghost, replay and live checks)

From QuantConnect Lean's main lesson: one fill model interface for backtest and paper; live fills are compared against it.

```
expected fill = curve quote at (intent time + latency)
latency       ~ measured live distribution (start: lognormal, median 1.5 s)
slippage      = curve impact of our size on the state at fill time
costs         = pump fees (from SDK) + priority fee + Jito tip if used
fail chance   = measured live failure rate (start: 5%)
```

Live fills are compared to the ghost fill of the same intent. If the median gap goes over 30% of the modeled slippage for a day, `system.fill_model_drift` fires and promotions pause.

## Selection and evolution

- **Niches** (MAP-Elites style): family × horizon (fast < 30 min, medium < 2 h, slow < 6 h) × size class. Each niche keeps its best genomes, so the Brood never collapses into one idea.
- **Fitness**: lower confidence bound (90%) of net SOL per trade after costs. A genome needs real evidence to rank high.
- **Hard gates** (fail any one and the genome cannot hold capital): follower PnL ≥ 0 over its last 30 trades with callouts; fewer than 30% of its ghost exits inside the first 5 minutes after its own callout; max ghost drawdown < 30%.
- **Entry rank**: for each trade, how many other buyers came between the trigger and our fill. Fitness is cut for genomes whose median entry rank is worse than the median crowd buyer's.
- **Mutation operators**: nudge a weight or threshold (Gaussian, 10%); add or drop a score term from the signal catalog; change one exit step; change call policy; change sizing fraction.
- **Crossover**: universe and score from parent A, exits and stops from parent B, within the same horizon.
- **Proposals**: the Postmortem agent (or a human) submits genomes with `octo propose`, usually after a postmortem. They enter as ghosts with `origin: proposal`. They never skip gates.
- **Population caps**: 128 ghosts, 16 live. Each hour: up to 16 offspring and 4 proposals; the worst ghosts by fitness LCB in crowded niches retire to make room.
- **Retirement**: LCB below 0 after 50 trades, drawdown over its limit, or no trades for 7 days. Retired genomes stay in the lineage forever.

## Allocator

- Live-eligible genomes have a posterior over mean net return per SOL traded (Student-t from their trades, with a skeptical prior centered at −1% per trade).
- Every 15 min: draw one sample per genome (Thompson sampling). Capital share is proportional to positive samples. Genomes with a negative sample get zero for this round.
- Caps: 25% of the war chest per genome; 5% for genomes in probe.
- **Promotion gates**
  - Ghost → probe: 30 or more ghost trades after birth, LCB(net per trade) > 0 in **two separate time windows** (first half and second half of its trades), all hard gates passed. Probe trades are 0.05 SOL and silent (no callout).
  - Probe → full: 20 or more live trades, live-vs-ghost slippage gap within 30%.
- The Fly genome has a fixed 1% sleeve and skips the allocator.

## One coin, one callout

Several genomes may hold the same coin. The octopus has one Pump.fun account, and the platform allows one active callout per coin.

- Positions are tracked per genome (sub-ledgers), but the wallet holds one combined position.
- The first live entry with `call.policy != silent` makes Herald post the callout. The thesis comes from that genome's template and the signals it used.
- Later entries and every exit by any genome become **updates** to that callout, describing the combined position ("added 0.4 SOL", "sold 25% at 2.1x, holding 50%").
- When the combined position is closed, Herald posts a final update with the result.

## Risk Gate

A pure function. Inputs: intent, current portfolio, the live limits version, the Board. Output: an order, or a rejection with a reason code. Every outcome is an event.

### Default limits (live)

| Limit | Pre-coin | After coin |
|---|---|---|
| Max order | 0.25 SOL | 1 SOL |
| Max position per coin (combined) | 0.5 SOL | 2 SOL |
| Max open coins | 6 | 10 |
| Daily realized loss stop | 20% of war chest | 15% of war chest |
| Max price impact | 300 bps | 300 bps |
| Min liquidity | curve real SOL ≥ 3, or pool ≥ $20k | same |
| Quote freshness | ≤ 3 s | ≤ 3 s |
| Coins never traded | our own coin, coins in our blocklist | same |

Limits live in `mind.limits` with a version. Only the admin path changes them. Code never changes limits.

### Reason codes

`stale_quote`, `impact_too_high`, `liquidity_too_low`, `position_cap`, `open_coins_cap`, `order_cap`, `daily_loss_stop`, `blocklisted`, `own_coin`, `kill_switch`, `mode_not_live`, `duplicate_intent`, `wallet_balance_low`, `genome_not_live`.

## Ways the Mind fails

1. A genome overfits recent noise. Fitness is an LCB and only counts trades after birth (no look-back fitting), so luck alone rarely promotes.
2. Many genomes pile into the same coin. The combined position cap and open-coins cap stop it.
3. A slow organ goes missing for hours. `missing: skip` keeps genomes running; the Scorekeeper shows the drop in their results.
4. The fill model is optimistic. Live-vs-ghost drift detection pauses promotions.
5. The evolution loop floods the Brood with near-copies. Niche caps and a minimum distance between genome specs (weights and thresholds) reject duplicates.
6. A proposal contains a dangerous rule (for example `max_sol: 100`). The validator clamps all sizes to limits; the Risk Gate enforces them anyway.
