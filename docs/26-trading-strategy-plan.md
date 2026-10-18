# 26 · Trading strategy plan

This doc plans how the strategies get better. It builds on docs/08 (the Strategy DSL, the pool, the gate), docs/23 (the Index) and docs/25 (the domain model). Nothing here is built yet unless it says SHIPPED. No number in this doc is a performance claim. Every edge must be measured on ghost trades first, then on probe trades, after all costs.

Wallet lists, keys, API keys and callout tapes come later from the owner. Until then every list is empty (docs/25 section 6), and every plan below must run, and do nothing harmful, with empty lists.

## 1. What we know

Measured by us:

- Buying after a public callout lost money: 54 of 61 measured callouts lost at 5 minutes after costs (docs/08, docs/07 scorekeeper).
- Callers buy before they call. On the first fixture the caller's own buy came a median 57 s before the callout, and the median 3-minute peak was 1.30x above that buy (`docs/research/pre-call-evidence.md`). One fixture of 10 minutes is a small sample. Treat this as a reason to measure, not as an edge.

Claimed by outside sources (from the owner's research notes; not verified by us):

- A round trip on the curve costs about 2.5% in fees before slippage and priority fees. Our fill model computes this from the curve, so we do not need the claim.
- Most launches never graduate, most traders lose, and sandwich bots take value on high-slippage orders.
- One public parameter set (dev buy at least 1 SOL, take profit +30%, stop -30%, hold at most 120 s) showed positive expectancy in someone's test. We can add it as a seed and let our own measurement judge it.

What follows from this: the edge, if there is one, is in being early with good callers and good wallets, in refusing bad coins, and in exiting fast. Not in predicting moonshots.

## 2. What is wrong today

From the audit of 2026-10-18 (the fix plan lives in `docs/audits/`, which is gitignored). These block any honest improvement, so they come first.

| Problem | Where | Why it matters |
|---|---|---|
| The score is used as a win chance | `mind/dsl.ts:173-182` | Kelly sizes and the cost floor are computed from a number that is not a probability. |
| A 2-hour quiet spell can retire every strategy, and an empty pool is never re-seeded | `mind/evolve.ts:77`, `mind/desk.ts:182` | The desk can stop trading forever without an error. |
| `launch_scan` and `smart_early` only see coins that a caller touched | `mind/desk.ts:444` (in play needs a callout or a known caller's buy) | Two families cannot test their own idea. |
| Markouts ignore fees, and retirement uses them | `mind/desk.ts:372`, `mind/evolve.ts:76` | A strategy that loses its fees each trade passes. |
| Parents are picked after 2 trades, and up to 128 correlated strategies are each tested alone | `mind/evolve.ts:10,82`, `mind/kernel.ts:53-60` | Some will pass the promotion test by luck. |
| Strategies cannot read slow signals | `mind/dsl.ts:9-31` | BettaFish and MiroShark cannot improve any trade. |
| Exits that read the Board get an empty Board in the sweep | `mind/desk.ts:223,511-513` | A creator-sold or flow-died exit would sell everything or never fire. |
| Lookahead in callout analyzers; backfilled trades timed by fetch time | `analyzers/cheap.ts`, `analyzers/precall.ts` | Signal scores and caller records are biased. |
| The live leg is not tied to the paper position | `hands/order-gate.ts` | See docs/25 section 5.2. No live strategy is safe until this is fixed. |

## 3. Families

A family is a niche label with its own universe, score and exits (docs/08). This is the target set. Each family records an **in-play reason**, so results split by why the coin was looked at.

### In-play reasons

Today a coin is in play only after a callout or a known caller's buy (`desk.ts:inPlay`). Target:

| Reason | Starts when | Lasts | Status |
|---|---|---|---|
| `callout` | A callout lands on the coin | `ENTRY_WINDOW_MIN` | SHIPPED |
| `precall` | A known caller buys a coin they have not called | `ENTRY_WINDOW_MIN` | SHIPPED, but detected by searching Board rows; target is the `precall.detected` topic |
| `smart_buy` | A wallet in the current smart set buys | `SMART_WINDOW_MIN` | PLANNED |
| `scout` | The Scout promotes a coin on flow or heat | `ENTRY_WINDOW_MIN` | PLANNED |

### The families

| Family | Idea | Status | Change |
|---|---|---|---|
| `pre_call` | A good caller bought and has not called. Buy, then sell into their callout. | SHIPPED seed | The primary family. Rebuild its score around caller quality (below). Add exits on the caller's own sell. |
| `smart_early` | Copy wallets that the Index scores as copyable. | SHIPPED seed | Give it the `smart_buy` in-play reason. Require the wallet's copy score from the current Index version. |
| `launch_scan` | Coin metrics alone: flow, buyers, low concentration, no risk breach. | SHIPPED seed | Give it the `scout` reason. Add a dev-buy floor as a universe condition that evolution can move (start at 0.5 SOL). |
| `curve_climb` | Enter after real progress (20% to 60% of the curve) with healthy flow. | PLANNED seed | New universe on `curve.progress` and `flow.state`. Tight stops. |
| `graduation_run` | Ride the last part of the curve into graduation. | SHIPPED seed | Keep as ghost only until the AMM fill model has an impact term (`fill.ts:47` has none). |
| `post_grad_pullback` | Buy a graduated coin on its first healthy pullback. | PLANNED | Needs the AMM impact model and a `coin.graduated` event. Later. |
| `wave_anticipation`, `bellwether_follow`, `narrative_rotation`, `fresh_thesis` | Post-callout families. | SHIPPED seeds | Keep as ghosts. They are the control group: we expect them to lose, and their results show whether our costs and fills are modeled right. Never promote them without a held-out window. |

### Rebuilding `pre_call`

Today its score adds `precall.callout_p.p` (the chance the caller calls within 5 minutes), the caller's past peak rate, flow heat and follower count. A callout that comes is not a profit. The target score asks two separate questions and multiplies them:

```
P(caller calls within H | this caller bought)              from the caller's own record, shrunk to the population rate
E[net multiple of our entry at exit | caller called]       from this caller's past calls, through our fill model, after costs
```

Then subtract the cost of a miss (the caller does not call, and we exit on time). All three numbers are computed in code from the caller's own record as of now. The caller record needs these fields, each computed from append-only rows:

| Field | Means |
|---|---|
| `buy_to_call_rate` | Share of the caller's qualifying buys followed by their own callout within H |
| `lag_med_s` | Median seconds from buy to callout (SHIPPED inside the signal) |
| `post_call_net` | Median net multiple of an entry at our latency after their buy, exited 30 to 60 s after their callout |
| `dump_rate` | Share of calls where the caller sold more than half their buy within 2 minutes of calling |
| `creator_share` | Share of the caller's calls on coins they or a funded wallet created |
| `n_calls` | Evidence count; below `PRECALL_MIN_CALLS` the caller's numbers are shrunk hard to the population |

Rules for the family:

1. A caller whose `creator_share` is high is a deployer promoting their own coins. Skip.
2. A caller with a high `dump_rate` sells into their own followers. The exit must beat them: sell on their first sell.
3. Owner lists apply: a buy by any wallet in `caller_wallets` for that caller counts as the caller's buy (docs/25 section 6).

## 4. From score to win chance (calibration)

A score is a ranking, not a probability. Calibration turns it into one, from our own ghost results.

1. For each family, collect closed ghost decisions with their entry score and their net result after costs.
2. Sort by score into bins of at least `CALIB_MIN_PER_BIN` decisions (start 20). For each bin, compute the share with net above zero and the mean net multiple. Make both non-decreasing in score (isotonic). Version the map and emit it on the Tape so replays read the same map.
3. The cost floor becomes: the expected net from the map at this score, minus this trade's own slippage and fees, must be above zero. This counts every exit type, including time exits.
4. Sizing:
   - Until a family has a calibration map with at least 3 bins, every entry uses the fixed probe size.
   - After that, fractional Kelly on the map's win chance and the family's measured average win and loss, capped at `KELLY_CAP` (start 0.25 of Kelly), then by the kernel share and stage, then by the owner's limits.
5. Signal confidence is used here: a term whose signal has confidence under `TERM_MIN_CONF` counts as missing.

This replaces the "score as P(win)" math in `evaluateEntry`. It is small code: a lookup table per family and version.

## 5. Selection and promotion

The goal is to stop promoting luck.

1. **Parents need evidence.** `EVOLVE_PARENT_MIN_TRADES` from 2 to 10.
2. **Correlated trades count once.** When several strategies of one family hold the same coin at once, promotion counts that coin once, with the family's mean result. Strategy-level stats stay as they are for display.
3. **Promotion by family first.** A family must clear its LCB in a held-out window (the latest 30% of its time span) before any member can leave ghost. A member then needs its own LCB above the hurdle in both halves, as today.
4. **Correct for many tries.** The member's LCB uses a z value raised for the number of living members of its family (a Bonferroni-style correction). With 12 members, the 90% bound becomes roughly a 99% bound.
5. **Fee-adjusted markouts.** Store markouts after the round-trip cost at our size. Retire on the fee-adjusted median.
6. **No pool wipe.** Idle time counts only minutes in which the coins the strategy could see traded. Every niche keeps at least one living strategy. A niche with none gets its seed back.
7. **Probe means small.** Probe size is one owner limit, `probe_order_sol`, below `max_order_sol`. docs/08 today says both "5% of the book" and "0.05 SOL". It becomes one number.

## 6. Exits

Exits matter more than entries on Pump.fun, because most coins fade within minutes.

| Exit | When | Status |
|---|---|---|
| Take-profit ladder | Sell parts at rising multiples | SHIPPED (`mult_gte` steps with `sell` fractions) |
| Hard stop | Multiple at or below a floor | SHIPPED (`mult_lte`) |
| Time exit | Held longer than the horizon allows | SHIPPED (`held_min_gte`) |
| Sell into the callout | Seconds after the predicted callout lands | SHIPPED (`called_s_gte`) |
| Trailing stop | Fall of X from the peak multiple since entry | PLANNED (`trail_from_peak`) |
| Caller sold | The pre-call caller sells part of their buy | PLANNED (`caller_sold_gte`) |
| Creator sold | The creator's sold share rises above a level | PARTIAL: possible as a Board condition, but the sweep passes an empty Board |
| Flow died | Buyers in the last 60 s fall below a level | PARTIAL: same problem |

Rules:

1. Every exit check gets the Board for its coin. Fixes the empty Board in the sweep.
2. Exits are decided once per decision and applied to the live leg too (docs/25 section 5.2).
3. Every strategy must have a stop and a time exit. SHIPPED in the validator.

## 7. Hard limits

The owner sets these. Strategies and models never change them. The first group is SHIPPED in `DEFAULT_LIMITS` (`mind/risk.ts:24-40`), but nothing writes `mind.limits` yet, so they cannot be changed without editing code.

| Limit | Default | Status |
|---|---|---|
| `max_order_sol`, `max_position_sol`, `max_open_coins`, `min_free_sol` | 0.02, 0.04, 5, 0.1 | SHIPPED |
| `daily_loss_stop_frac` | 0.25 | SHIPPED per paper book; PLANNED for the firm's live book |
| `max_impact_bps`, `min_real_sol`, `max_quote_age_ms`, `max_slippage_bps` | 300, 3, 3000, 300 | SHIPPED; slippage is not clamped in the order schema |
| `max_bundle_share`, `max_top10_share`, `max_fresh_share`, `max_creator_sold` | 0.2, 0.3, 0.6, 0.5 | SHIPPED; a coin with no `risk.state` passes all four, which is wrong |
| `require_risk_state` | true | PLANNED: refuse a buy when the coin has no risk signal |
| `probe_order_sol` | 0.005 | PLANNED |
| `max_consecutive_losses`, `loss_cooldown_min` | 5, 30 | PLANNED |
| `max_drawdown_frac` (lifetime, live book) | 0.4 | PLANNED |
| `max_creator_launches_7d` | 10 | PLANNED: refuse coins whose creator launched more than this |
| Blocked creators, wallets and mints | empty | PLANNED: owner lists |

## 8. Features to add

All as of now (docs/25 section 4), all computed in code, all logged as Board fields so strategies can use them and evolution can move their thresholds.

| Feature | From | For |
|---|---|---|
| Creator launches in 7 and 30 days | `idx.coin.creator` | Mass-deployer floor |
| Creator graduation rate, creator rug rate (creator sold over half within 10 minutes) | `idx.coin`, trades | Mass-deployer floor, taste |
| Dev buy size | the creator's first buy | `launch_scan`, `curve_climb` |
| Funder links of early buyers (RPC, candidates only, budgeted) | RPC | Bundle detection beyond the first slots |
| Live `bundle_share`, `fresh_share` | re-computed on each holder snapshot | Today they freeze at promotion |
| Caller record fields | section 3 | `pre_call` |
| Peak after the wallet's first buy | trades | Fixes `early_right` |

## 9. The slow mind cascade

BettaFish and MiroShark take minutes. A trade on Pump.fun often lasts minutes. So the slow mind must start at the pre-call moment, run cheaply by default, and never block a trade.

### Stages

| Stage | Runs | Trigger | Target time | Budget |
|---|---|---|---|---|
| 0 | Math analyzers and Jev packs | Every relevant event | under 200 ms | free or Jev budget |
| 1 | BettaFish nano: Insight engine only, no forum rounds, one coin | `precall.detected` with a caller in the top tier, or the hot set refresh | 5 to 15 s | `SLOW_STAGE1_USD_PER_RUN` |
| 2 | BettaFish lite plus a small MiroShark run (few agents, 3 to 5 rounds) | Stage 1 done and the gate below says yes | 30 to 90 s | `SLOW_STAGE2_USD_PER_RUN` |
| 3 | Full engines | Owner preset only, rare | minutes | `SLOW_STAGE3_USD_PER_RUN` |

Every stage also stops at `SLOW_USD_PER_DAY` for the whole slow mind.

### The escalation gate

Code computes every number. The gate escalates a coin from stage n to n+1 when all hold:

1. The coin is in play by `precall`, `smart_buy` or a callout in the last minute.
2. Fast signals are uncertain: the calibrated win chance is between `ESC_P_LOW` and `ESC_P_HIGH` (start 0.35 and 0.65), or two fast signals disagree by more than `ESC_DISAGREE`.
3. Value of information beats cost: (chance the decision changes) times (expected net change in SOL) is above the stage's USD cost converted to SOL.
4. The quota and the USD caps have room. A denied escalation is deferred, not dropped.

### The hot set

The top `HOT_SET_SIZE` coins (start 5) by pre-call chance times caller quality are kept warm with stage 1 runs every `HOT_SET_EVERY_S` (start 90). When the callout lands, a fresh stage 1 result is usually already on the Board.

### Partial results

The Bridge emits `synthesis.partial` as soon as the first useful piece is ready (first stance, first suspicious pattern), each with its citations. The final result supersedes it.

### How strategies use slow signals

1. Add `synthesis.coin`, `swarm.wave_p` and `mood.feed` to the signal catalog as System Two kinds. Fast strategies still cannot use them (SHIPPED rule in `validate`).
2. Every slow term uses `missing: skip`. No strategy waits.
3. A slow number is promoted to a Board signal only after core re-checks it: citations exist and were seen by now, numbers are recomputed from the run's raw counts, and texts pass the public-text check (fix plan Phase 5).

### Proving the slow mind helps

Escalation is decided by the gate, then a stable hash of the coin picks half of the eligible coins to actually run (the others are the control). After 50 escalations per stage, compare fee-adjusted markouts and net results of escalated against control coins. If the stage does not improve results by more than its cost, its quota goes to zero. Cost per useful signal is reported by `ctl slow`, which needs real cost numbers from the engines (today they report 0).

## 10. Scorecard

`ctl strategies` (PLANNED) prints, per family and per in-play reason:

- n decisions, effective n after counting correlated coins once
- win share, mean and median net after costs, LCB
- calibration error (predicted win chance against actual, per bin)
- fee-adjusted markouts at 10 s, 60 s and 5 min
- entry rank (docs/08)
- live against ghost slippage gap, once there are live legs
- for the slow mind: USD spent, escalations, markout gap escalated against control

## 11. Order of work

Each step ends in a check. The fix plan's Phases 0 to 3 come first, because measurement must be true before strategies are judged.

1. Fix the pool wipe, the fee-adjusted markouts, and the empty Board in exits. Check: a replay with a 3-hour gap keeps at least one strategy per niche.
2. Add in-play reasons and record them on every decision. Check: `launch_scan` decisions appear in a replay with no callouts.
3. Calibration maps and the new sizing. Check: a replay prints each family's map with its counts, and no entry is sized by Kelly before its family is calibrated.
4. Honest promotion (section 5). Check: in a replay, a pool of strategies with random scores promotes none.
5. Caller record fields and the rebuilt `pre_call` score. Check: on a recorded tape, the caller record matches a hand-computed table for three callers.
6. Mass-deployer features and the new limits. Check: a coin whose creator is in `blocked_creators` is refused with its reason code.
7. Owner lists loaded (when the owner supplies them). Check: loading a list emits `lists.loaded` with the right count, and replay reads the version that was active.
8. The cascade, stage 1 only, then stage 2. Check: stage 1 results reach the Board within 15 s in a live smoke, and the control split is recorded.

## 12. Ways it fails

1. Overfitting. Many strategies, few trades, and evolution that chases noise. Defence: section 5, and the control families.
2. Small samples. One 10-minute fixture is not evidence. Defence: no claim before 50 decisions per family, and every number shows its n.
3. Costs modeled too low. Sandwiches, failed lands and priority fees are worse live. Defence: the live against ghost gap pauses promotions; probe sizes stay tiny for a long time.
4. Callers adapt. If others copy the same callers or wallets, the edge shrinks. Defence: decay in the Index and recent-window scoring.
5. Caller identity is wrong. A caller buys from another wallet. Defence: `caller_wallets` lists and, later, funder links.
6. Lookahead. A feature reads the future and looks like an edge. Defence: the `no-lookahead` suite (docs/25 section 4).
7. Slow mind costs more than it earns. Defence: the control split and the per-day cap.
8. Platform risk. One account, no second chances. Defence: Platform boundaries in AGENTS.md; honest user agent; rate limits.
