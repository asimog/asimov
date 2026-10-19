# Strategy

How Asimog decides to buy and sell: strategies as data, the families, calibration, selection, exits, the Risk Gate and the fill model. Target design; gaps are rows in `PLAN.md`. No number here is a performance claim. Every edge is measured on ghost trades first, then probes, after all costs.

## 1. What we know

| # | Lesson | Evidence |
|---|---|---|
| 1 | Buying after a public callout loses | Our tape: 54 of 61 measured callouts lost at 5 min after costs |
| 2 | Callers buy before they call | Author buy a median 57 s before the callout; but only 2 of 34 known-caller buys led to their call within 5 min |
| 3 | A fixed coin filter ("buy every coin crossing 6K") loses once fills are realistic | Three public launch datasets |
| 4 | More distinct wallets early goes with success; holder counts alone do not | Memecoin Corpus, launchtape |
| 5 | Graduation is usually the top | MELT: 67.5% of graduates fall below 0.3x within an hour |
| 6 | Peaks flatter every record | Call datasets record peaks, not exits or costs |
| 7 | Many datasets leak the future | pump-gold, MELT feature timing |

The edge, if any, is in information others act on later: which wallets are early and right, which callers move the crowd, and what we can still copy after our delay. Plus refusing bad coins and exiting fast. Details: `docs/research/`.

## 2. Strategies as data

A strategy is JSON, read by a pure TS interpreter (`mind/dsl.ts`). No code, no eval.

```json
{
  "family": "pre_call", "horizon": "fast",
  "universe": { "all": [ { "sig": "precall.callout_p", "op": "exists" },
                         { "sig": "curve.progress", "field": "progress", "op": "<", "v": 0.85 } ] },
  "score": { "sum": [ { "w": 0.6, "sig": "precall.callout_p", "field": "p" },
                      { "w": 0.2, "sig": "flow.state", "field": "heat" },
                      { "w": -0.3, "sig": "flow.state", "field": "top_share" },
                      { "w": 0.2, "sig": "synthesis.coin", "missing": "skip" } ] },
  "enter_if": { "score_gte": 0.55 },
  "call": { "policy": "after_fill" },
  "exits": [ { "when": { "mult_gte": 1.3 }, "sell": 0.5 },
             { "when": { "called_s_gte": 30 }, "sell": 1.0 },
             { "when": { "held_min_gte": 3 }, "sell": 1.0 } ],
  "stop": { "any": [ { "mult_lte": 0.85 } ] }
}
```

Rules:

- A `sig` must be in the signal catalog (`docs/generated/signals.md`); unknown kinds and fields are refused.
- `missing: skip` drops a term and renormalizes. This keeps strategies running while slow signals are absent.
- `fast` strategies may use System One signals only. Slow kinds (`synthesis.*`, `swarm.*`, `mood.*`) are for `medium` and `slow`.
- Every spec needs a take-profit, a stop and a time exit. The validator lists every reason a spec is invalid and clamps sizes to limits.
- Take-profit levels are bands: the exit picks a point inside plus or minus 5%, so copy traders cannot front-run exact levels.
- Every threshold may evolve within validator bounds. "6K" is only where a seed starts.

## 3. In play and families

A coin is in play for a reason, recorded on every decision so results split by why we looked. The desk keeps the latest reason that started within `ENTRY_WINDOW_MIN`; each `intent.created` carries it as `in_play` (a sell carries its position's), and `mind.positions.in_play` keeps it for the scorecard.

| Reason | Starts when |
|---|---|
| `callout` | A callout lands on the coin |
| `precall` | `precall.detected`: a known caller bought a coin they have not called |
| `smart_buy` | A wallet in the current smart set buys, or a followed wallet buys (`coin.watched` reason `smart_buy` or `follow`) |
| `scout` | The Scout promotes the coin on heat or metrics |

A `coin.watched` with reason `caller_buy` starts `precall` too.

| Family | Idea | Reason |
|---|---|---|
| `pre_call` (primary) | A good caller bought and has not called. Buy, sell into their callout or on their first sell | `precall` |
| `smart_early` | Copy wallets the Index scores as copyable | `smart_buy` |
| `launch_scan` | Coin metrics alone: flow, buyers, low concentration, dev buy floor, no risk breach | `scout` |
| `curve_climb` | Enter after real curve progress with healthy flow; tight stops | `scout` |
| `graduation_run` | The last part of the curve; ghost only until the AMM fill model has impact | `scout` |
| Post-callout controls | `wave_anticipation`, `bellwether_follow`, `narrative_rotation`, `fresh_thesis` | `callout` |

The post-callout families are a control group. We expect them to lose; their results show whether costs and fills are modeled right. They never leave ghost without a held-out window.

**The `pre_call` score** multiplies two questions, each from the caller's own record as of now, shrunk to the population when the record is thin:

```
P(caller calls within H | they bought) x E[net of our entry at exit | they called]  minus the cost of a miss
```

Caller record fields: `buy_to_call_rate`, `lag_med_s`, `post_call_net`, `dump_rate`, `creator_share`, `n_calls`. A caller with a high `creator_share` promotes their own coins: skip. A caller with a high `dump_rate` sells into followers: exit on their first sell.

## 4. Calibration

A score is a ranking, not a probability. Per family, closed ghost decisions are binned by entry score (at least `CALIB_MIN_PER_BIN` each); each bin gives the share with net above zero and the mean net multiple, made non-decreasing in score. Maps are versioned and emitted on the Tape.

- Entry needs the map's expected net at this score, minus this trade's slippage and fees, above zero.
- Until a family has a map with at least 3 bins, every entry uses the fixed probe size.
- After that: fractional Kelly on the map's win chance, capped at `KELLY_CAP`, then by the kernel share and stage, then by the owner's limits.
- A term whose signal confidence is below `TERM_MIN_CONF` counts as missing.

## 5. The pool, selection and capital

| Step | When | What |
|---|---|---|
| Evaluate | Each Board change for a coin, and every 5 s | Every strategy checks universe, score, entry, exits and stops; writes intents |
| Ghost fill | Every intent | The fill model fills it on the strategy's own ghost book |
| Score | At exits and horizons | Net after all costs, fee-adjusted markouts, drawdown, entry rank |
| Allocate, evolve | Every `ALLOCATE_EVERY_S`, `EVOLVE_EVERY_S` of Tape time | Kernel shares; selection, mutation, crossover, proposals, retirement |

Honest promotion:

1. Niches are family x horizon; each keeps its best, and at least one living member.
2. Fitness is the 90% lower bound of net SOL per trade after costs, raised for the number of living family members.
3. Parents need `EVOLVE_PARENT_MIN_TRADES` (10). Correlated trades on one coin count once.
4. A family must clear its bound in a held-out window (the latest 30%) before any member leaves ghost.
5. Ghost to probe: 30 trades, bound above the hurdle in both halves. Probe size is the owner limit `probe_order_sol`; probes are silent.
6. Probe to full: 20 live trades, live against ghost slippage within 30%. Only `full` sizes by Kelly on its kernel share.
7. Retire on: bound below zero after 50, drawdown over 30%, negative fee-adjusted 60 s markout over 50, idle time counted only in active market minutes.

The kernel: Thompson sampling over each live strategy's posterior of net return per SOL (skeptical prior at minus 1% per trade). Caps: 25% of the trading book per strategy, 5% in probe.

Proposals from the Postmortem agent or a human enter as ghosts and never skip a gate.

## 6. Exits

Exits matter more than entries, because most coins fade within minutes. Every exit check gets the Board for its coin. Exits are decided once per decision and applied to the live leg.

| Exit | When |
|---|---|
| Take-profit ladder | Sell parts at rising multiples (bands) |
| Hard stop | Multiple at or below a floor |
| Time exit | Held longer than the horizon allows |
| Sell into the callout | Seconds after the predicted callout lands (`called_s_gte`) |
| Trailing stop | Fall from the peak since entry (`trail_from_peak`) |
| Caller sold | The pre-call caller sells part of their buy (`caller_sold_gte`) |
| Creator sold, flow died | Board conditions |

## 7. Risk Gate and limits

A pure function: `(intent, book, limits, quote, flags) -> order | rejection(reason)`. No network, no model. Every result is an event. The paper and live gates use one book shape and the same caps.

Owner limits (defaults in `config/limits.default.json`, changed only by `ctl limits set` with the admin token, read as of decision time):

| Limit | Default |
|---|---|
| `max_order_sol`, `max_position_sol`, `max_open_coins`, `min_free_sol` | 0.02, 0.04, 5, 0.1 |
| `probe_order_sol` | 0.005 |
| `daily_loss_stop_frac` (live book), `max_drawdown_frac` | 0.25, 0.4 |
| `max_consecutive_losses`, `loss_cooldown_min` | 5, 30 |
| `max_impact_bps`, `min_real_sol`, `max_quote_age_ms`, `max_slippage_bps` | 300, 3, 3000, 300 |
| `max_bundle_share`, `max_top10_share`, `max_creator_sold` | 0.2, 0.3, 0.5 |
| `max_creator_launches_7d`, `require_risk_state` | 10, true |

Reason codes are listed in `mind/risk.ts` and appear on every rejection: quote, impact, liquidity, caps, loss stops, risk floors (and `no_risk_state` when a coin has no `risk.state`), lists, kill state, mode, duplicates, balance, strategy stage.

## 8. Fill model

One fill model for ghost legs, replays, outcomes and the Index copy scores (`mind/fill.ts`):

```
fill      = curve state at the first trade after intent time + latency
latency   ~ measured live distribution (start: lognormal, median 1.5 s)
slippage  = curve impact of our size at fill time
costs     = protocol fees (from the SDK) + priority fee + rent (refunded when the account closes)
fail      = measured landing failure rate (start 5%); failed exits retry
```

After graduation the AMM model adds price impact; until it does, AMM families stay ghost. Live fills are compared to their ghost twin; a drift past `KILL_FILL_DRIFT_X` moves the kill state to `exit_only` and pauses promotions.

## 9. One coin, one callout

The platform allows one active callout per coin and we have one account. The first live entry with a call policy makes Publisher post the callout; later entries and exits by any strategy are updates on the combined position; the close posts a final update. Ghost fills of other strategies stay on their own books.

## 10. Scorecard

`ctl strategies` per family and in-play reason: decisions and effective n, win share, mean and median net after costs, lower bound, calibration error per bin, fee-adjusted markouts at 10 s, 60 s and 5 min, entry rank, live against ghost slippage, and for the slow mind, USD spent and markout gap against control.

## 11. Ways it fails

1. Overfitting: many strategies, few trades. Defence: section 5 and the control families.
2. Small samples: no claim before 50 decisions per family; every number shows its n.
3. Costs modeled too low: live against ghost drift pauses promotions; probes stay tiny.
4. Callers adapt or are copied: Index decay and recent windows.
5. Wrong caller identity: `caller_wallets` and funder links.
6. Lookahead: the `no-lookahead` replay check.
7. The slow mind costs more than it earns: the control split and daily caps (`SLOW-MIND.md`).
8. Platform risk: one account, honest user agent, rate limits, no gaming of rankings.
