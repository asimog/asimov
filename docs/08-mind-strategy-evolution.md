# 08 · Mind: strategies that evolve

There is no fixed list of strategies. Strategies are **strategies**: small JSON rule sets over Board signals. A population of them, the **Strategy Pool**, trades on paper all the time. The **Allocator** gives real capital to the ones that earn it. The **Risk Gate** has the last word on every order.

## Strategy DSL

A strategy is data. No code, no `eval`. The interpreter is a pure TS function.

```json
{
  "id": "sr_01JA...",
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
    { "w": 0.2, "sig": "callers.call_p", "field": "expected_count_norm" },
    { "w": -0.5, "sig": "echo.score", "field": "max_recent" }
  ]},
  "enter_if": { "score_gte": 0.55 },
  "size": { "kelly_fraction": 0.25, "max_sol": 1.0, "max_impact_bps": 300 },
  "call": { "policy": "after_fill", "template": "wave" },
  "exits": [
    { "when": { "mult_gte": 2.0 }, "sell": 0.25 },
    { "when": { "mult_gte": 3.0 }, "sell": 0.25 },
    { "when": { "sig": "regime.state", "field": "p.crowded", "op": ">=", "v": 0.6 }, "sell": 0.5 },
    { "when": { "held_min_gte": 10 }, "sell": 1.0 }
  ],
  "stop": { "any": [ { "mult_lte": 0.6 }, { "sig": "regime.tremor", "op": "exists" } ] }
}
```

Rules:

- A `sig` must be a kind in `04-contracts.md`. The validator rejects unknown kinds and fields.
- `missing`: `skip` drops the term and renormalizes weights; a number uses that value. Default is `skip`. This is how strategies keep working while slow analyzers (BettaFish, MiroShark) have no fresh signal.
- `call.policy`: `after_fill` (post once the holding is confirmed), `after_fill_delay:<s>`, or `silent` (trade without a callout).
- `horizon: fast` strategies may only reference System One signals (math analyzers and `jev.*`). The validator rejects a fast strategy that references `synthesis.*` or `swarm.*`.
- Jev answers are used as probabilities and confidence, never as numbers to do math on inside Jev. Weights live in the strategy and evolve.
- Exit `mult_gte` values are bands: the Executor picks a point inside ±5% at random, so copy-traders cannot front-run exact levels.
- Families are labels for niches, not code paths. Seed families (`services/core/src/mind/seeds.ts`, 6 × 6 variants: fast, medium, slow × tight, loose): `wave_anticipation`, `bellwether_follow`, `graduation_run`, `narrative_rotation`, `fresh_thesis` (first call on a coin, specific thesis, no pre-move), and `pre_call` (below). Post-call families require a callout signal in their universe. `fly` joins when the Connectome Lab produces signals. New families can appear through mutation or proposals.
- `called_s_gte: n` is an exit that holds once a callout has landed on the coin at least n seconds ago, after our entry. It is how a pre-call position sells into the callout it predicted.
- Every spec needs a `mult_gte` take-profit, a `mult_lte` stop and a `held_min_gte` exit within its horizon. The validator lists every reason a spec is invalid.
- **Cost floor.** The score is read as a win chance p. With take-profit `tp` and stop `s`, expected edge = p·(tp − 1) − (1 − p)·(1 − s). An entry needs edge above the round-trip cost: 2 × pump fee + 2 × curve slippage at the order size. Size is `kelly_fraction` × Kelly(p, b = (tp − 1)/(1 − s)) × book, then clamped to limits.

## Pre-call: buy before the callout

Buying after a callout is the losing side (docs/07 scorekeeper: 54 of 61 measured callouts lost money at 5 min after costs). Callers must hold a coin to call it, so their own buy announces the callout: a median 57 s earlier on the fixture, with a median 3-minute peak 1.30x above that buy (docs/research/pre-call-evidence.md).

- **In play.** The desk evaluates a coin while it is in play: within `ENTRY_WINDOW_MIN` after its latest callout, or after a known caller's buy on it (`precall.callout_p` on the Board). For a pre-call coin the Board holds coin signals (`curve.*`, `flow.state`, `precall.callout_p`, `hawkes.*`) and the buying caller's `caller.dna`; callout signals are absent, so post-call families (which require `age.opportunity` or a `jev.callout.*` field in their universe) do not fire.
- **The `pre_call` seed family.** Universe: `precall.callout_p` exists, curve progress < 0.85, `flow.state.top_share` < 0.6. Score: `precall.callout_p.p` (0.6), `precall.callout_p.p_peak` (0.3, skip when missing), `flow.state.heat` (0.2), `caller.dna.followers_norm` (0.2, skip), minus `flow.state.top_share` (0.3). Exits: half at the first take-profit band, `called_s_gte` 30 s (tight) or 60 s (loose) sells the rest into the callout, and a hold limit of 3, 6 or 10 min by horizon. Stop 0.88x (tight) or 0.8x (loose).
- **Calls.** `pre_call` strategies use `call.policy: after_fill`, so the house posts its own callout (on paper, docs/09) before the caller it predicted. The house record of being early is public in the caller ledger.

## The Strategy Pool loop

| Step | When | What |
|---|---|---|
| Evaluate | Every Board change for a coin, and every 5 s | Every strategy checks universe, score, entry, exits and stops for coins it watches. Outputs intents. |
| Ghost fill | Every intent | The fill model fills it on paper. Every strategy builds a ghost record, whether or not it has capital. |
| Score | At exits and horizons | `strategy_scores` updated: net SOL per trade after all costs, follower PnL, drawdown, hit rate. |
| Allocate | Every 2 min of Tape time (`ALLOCATE_EVERY_S`) | Allocator sets capital per strategy (below). |
| Evolve | Every 2 min of Tape time (`EVOLVE_EVERY_S`) | Selection, mutation, crossover, proposals, retirement (below). |

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

- **Niches** (MAP-Elites style): family × horizon (compressed: fast ≤ 3 min, medium ≤ 10 min, slow ≤ 30 min of holding; `HORIZON_*_MIN`). Each niche keeps its best strategies, so the Strategy Pool never collapses into one idea.
- **Fitness**: lower confidence bound (90%) of net SOL per trade after costs. A strategy needs real evidence to rank high.
- **Risk gate on strategies**: max ghost drawdown < 30% before any capital.
- **Honest trading code** (applies to every strategy that trades with a callout; a breach is a bug, not a trade-off): the position is disclosed in the callout; every exit is posted as an update as it happens (or in the next allowed update window); no side wallets, ever; never trade our own coin; never promise returns; cut losses whenever the strategy says so. Followers take their own risk in a free market. We owe them the truth, not a guaranteed outcome.
- **Published, not gated**: follower PnL and time-from-callout-to-first-exit are shown for every callout on the Ledger. Transparency is the discipline.
- **Entry rank**: for each trade, how many other buyers came between the trigger and our fill. Fitness is cut for strategies whose median entry rank is worse than the median crowd buyer's.
- **Mutation operators**: nudge a weight or threshold (Gaussian, 10%); add or drop a score term from the signal catalog; change one exit step; change call policy; change sizing fraction.
- **Crossover**: universe and score from parent A, exits and stops from parent B, within the same horizon.
- **Proposals**: the Postmortem agent (or a human) submits strategies with `ctl propose`, usually after a postmortem. They enter as ghosts with `origin: proposal`. They never skip gates.
- **Population caps**: 128 ghosts (`POOL_MAX`), 16 live. Each evolve round: up to 16 offspring from parents with at least 2 trades (`EVOLVE_PARENT_MIN_TRADES`), at most 12 per niche, none closer than 0.05 in spec distance to a niche member; the worst ghosts by fitness LCB in crowded niches retire to make room.
- **Retirement**: LCB below 0 after 50 trades, drawdown over 30% of its book, median 60 s markout below 0 over 50 trades, or no trades for 2 hours (`RETIRE_IDLE_MIN`). Retired strategies stay in the lineage forever.
- **Ghost books.** Every strategy trades its own 0.2 SOL ghost book (`GHOST_BOOK_SOL`) through the same Risk Gate and limits as the firm. An intent fills at the first trade seen after a modeled latency (lognormal, median 1.5 s), at that trade's curve state, with pump fees, a priority fee, 5% modeled landing failures (failed exits retry) and token-account rent that comes back when the position closes.

## Markouts first

Every fill records markouts at 1 s, 10 s, 60 s and 5 min (mid price move in our favor, net of the spread we crossed). Early in a strategy's life, fitness weights the 60 s markout heavily; as trades accumulate, net PnL takes over. A strategy with a negative median 60 s markout over 50 trades is retired, whatever its PnL says.

## Allocator

- The Allocator is the firm's one allocation kernel (docs/22) applied at desk level. The hurdle is zero net return after all costs; later, the measured yield on idle capital.
- Live-eligible strategies have a posterior over mean net return per SOL traded (Student-t from their trades, with a skeptical prior centered at −1% per trade).
- Every round: draw one sample per strategy (Thompson sampling). Capital share is proportional to positive samples. Strategies with a negative sample get zero for this round.
- Caps: 25% of the war chest per strategy; 5% for strategies in probe.
- **Promotion gates**
  - Ghost → probe: 30 or more ghost trades after birth, LCB(net per trade) > 0 in **two separate time windows** (first half and second half of its trades), the strategy risk gate passed. Ghost and probe trades are one fixed size, the owner limit `probe_order_sol` (0.01 SOL by default), and probe trades are silent (no callout). Only a `full` strategy sizes by Kelly on its kernel share of the book.
  - Probe → full: 20 or more live trades, live-vs-ghost slippage gap within 30%.
- The Fly strategy has a fixed 1% sleeve and skips the allocator.

## One coin, one callout

Several strategies may hold the same coin. The agent has one Pump.fun account, and the platform allows one active callout per coin.

- Positions are tracked per strategy (sub-ledgers), but the wallet holds one combined position.
- The first live entry with `call.policy != silent` makes Publisher post the callout. The thesis comes from that strategy's template and the signals it used.
- Later entries and every exit by any strategy become **updates** to that callout, describing the combined position ("added 0.4 SOL", "sold 25% at 2.1x, holding 50%").
- When the combined position is closed, Publisher posts a final update with the result.

## Risk Gate

A pure function. Inputs: intent, current portfolio, the live limits version, the Board. Output: an order, or a rejection with a reason code. Every outcome is an event.

### Default limits (sized for the 0.2 SOL start; the owner sets real limits later)

| Limit | Default |
|---|---|
| Max order | 0.02 SOL |
| Max position per coin (combined) | 0.04 SOL |
| Max open coins | 5 |
| Free SOL kept for fees and rent | ≥ 0.1 SOL |
| Daily realized loss stop | 25% of trading capital |
| Max price impact | 300 bps |
| Min expected move | above the round-trip cost floor (about 3% on the curve, docs/21 §5) |
| Min liquidity | curve real SOL ≥ 3, or pool ≥ $20k |
| Quote freshness | ≤ 3 s |
| Coins never traded | our own coin, coins in our blocklist |
| Rug and bundle floor (docs/23) | first-slot buyers holding 20% of supply, top 10 holding 30% of supply (curve excluded), fresh-wallet share 60%, creator sold 50% |

Limits live in `mind.limits` with a version, and the owner lists in `mind.lists`. Only the admin path changes them: `ctl limits set <key> <value> --token <admin>`, `ctl limits show`, `ctl lists load <kind> <file> --token <admin>`, each with an event on the Tape (`limits.changed`, `lists.loaded`). Every gate reads them through `loadLimits`, as of the decision time. Code never changes limits.

### Reason codes

`stale_quote`, `impact_too_high`, `liquidity_too_low`, `position_cap`, `open_coins_cap`, `order_cap`, `daily_loss_stop`, `bundled`, `concentrated`, `fresh_wallets`, `creator_sold`, `blocklisted`, `own_coin`, `kill_switch`, `mode_not_live`, `duplicate_intent`, `wallet_balance_low`, `strategy_not_live`.

## Ways the Mind fails

1. A strategy overfits recent noise. Fitness is an LCB and only counts trades after birth (no look-back fitting), so luck alone rarely promotes.
2. Many strategies pile into the same coin. The combined position cap and open-coins cap stop it.
3. A slow analyzer goes missing for hours. `missing: skip` keeps strategies running; the Scorekeeper shows the drop in their results.
4. The fill model is optimistic. Live-vs-ghost drift detection pauses promotions.
5. The evolution loop floods the Strategy Pool with near-copies. Niche caps and a minimum distance between strategy specs (weights and thresholds) reject duplicates.
6. A proposal contains a dangerous rule (for example `max_sol: 100`). The validator clamps all sizes to limits; the Risk Gate enforces them anyway.
