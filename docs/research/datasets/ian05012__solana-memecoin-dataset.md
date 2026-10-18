# ian05012/solana-memecoin-dataset

Checked 2026-10-17 by code on `.upstreamref/datasets/ian05012__solana-memecoin-dataset/` (shallow clone, nothing run from it; only parquet files were read with pandas, pyarrow and duckdb). Every number has its denominator.

## 1. What it is
- Source: GitHub `ian05012/solana-memecoin-dataset`. A shelved "early buy" ML project. A collector watched freshly graduated Pump.fun tokens and the GMGN trending board every 10 minutes, took a feature snapshot, and later filled in forward-return labels. License: MIT. Clone is 578 MB (data files about 303 MB). Under 2 GB, so fully used.
- Span of snapshots: 2026-06-10 to 2026-06-29 (20 days, one market regime).
- Files (rows): `data/tokens.parquet` 44,460 snapshots of 31,013 tokens (92 columns); `trades-000..003.parquet` 9,500,565 wallet trades over 66,990 tokens and 734,407 wallets; `ohlcv.parquet` 272,426 15-minute candles for 11,170 tokens; `sequences.parquet` 506,628; `wallets.parquet` 11,817; `wallet_funding.parquet` 15,493; `scripts/` (3 GMGN collector files, not run).
- Main columns (all in `tokens`):
  - `token_address`, `symbol`, `captured_at` (snapshot time, e.g. 2026-06-10 08:36 UTC).
  - `market_cap_usd` (median 27,159; 25% under 8,212), `time_since_launch_sec` (median 519), `liquidity_usd`.
  - Holders: `holder_count`, `top10_holder_pct`, `sniper_count`, `smart_money_count`, `bundler_pct_holders` (bundler = many wallets bought in one block by one entity).
  - Flow: `buy_usd_1h`, `sell_usd_1h`, `unique_buyers`, `flipper_ratio`.
  - Labels: `reaches_2x`, `max_return_1h/6h/24h/3d`, `runner_peak_x`, `staged_exit_return`, `mdd_from_peak` (drop from peak), `time_to_peak_sec`.
- Only 38.6% of token addresses end in "pump" (so Pump.fun-launched). The rest are other tokens from the trending board.
- Agent-aimed text: none found. A comment in the README ("tg_mention_count is shit") is just the author's note.

## 2. Point in time or snapshot
- Snapshot features (holders, flow, caps): recorded at capture time, built from "the last 200 trades before the snapshot". Treat as point in time.
- Labels are filled in later and are futures by design: all `max_return_*`, `reaches_2x`, `runner_peak_x`, `staged_exit_return`, `mdd_from_peak`, `time_to_peak_sec`. The README says so.
- LEAK in the trades table: of 5,513,690 trades on dataset tokens, 1,526,178 (27.7%) happen after the token's first snapshot; 18,533 of 31,004 tokens have such trades (across all those trades the 99th percentile is 31,727 s after the first capture). Building a wallet graph from all trades leaks the future.
- LEAK in `wallets`: "smart_money" means a hit rate of 40% or more and cash profit, judged over the whole collection. It is an end-of-period verdict, not what was known at the time. `first_seen_at` is 2026-06-14 to 06-30, so those wallets were tagged late.
- BROKEN labels: `max_return_*` is exactly 0.0 for 44,400 of 44,460 rows (99.9%). The script writes 0.0 when no candles were found. Only about 60 rows hold a real value. Also 4,675 rows have `reaches_2x` = True while `max_return_24h` = 0. So `reaches_2x` and `runner_peak_x` come from a different, undocumented source. I rebuilt a 24 h max from the candles for 10,981 first snapshots: it agrees with `reaches_2x` on 86.3% (9,478 of 10,981).
- 1,986 rows (4.5%) have no `reaches_2x`: mostly the last days, not yet labelled.

## 3. Bias
- Survivors: only tokens that lived long enough to be seen were captured (the author says the 2x rate is above the true rate).
- Mix: 61% of tokens are not Pump.fun launches. Caps run up to 53 billion USD (mean 28 million), so the table mixes micro caps and big coins.
- 1.43 snapshots per token on average (7,874 tokens have more than one, up to 13). Rows are not independent: use first snapshot only. All-snapshot 2x rate is 11.0% (4,678 of 42,474); first snapshot per token only is 8.7% (2,634 of 30,215).
- No callers, no callouts, no text. Coverage for features is patchy (smart_entry_rec is 67% empty, boost fields 98% empty).
- Dead tokens are filled with 0 (staged_exit_return = 0 for 64.5% of first snapshots, but only 3.6% of Pump.fun ones at 10K cap or less), so non-pump rows look worse because they have no data.
- 20 days, one regime (June 2026). Low day: 2026-06-19 has 681 rows.

## 4. What it can teach Asimog (0 to 3)
- (a) Caller and callout behaviour: 0. No callers. `tg_mention_count` is sparse.
- (b) Wallet behaviour: 2. Wallet trades, funding edges and tags are rare and useful for graph tests, but wallet tags and later trades leak.
- (c) Coin metrics at about 6K cap vs outcome: 3. Holders, snipers, bundlers, top10 against the 2x label, usable on Pump.fun-only rows.
- (d) Text and sentiment: 0.
- (e) Labels to test strategies: 2. `reaches_2x` and the simulated `staged_exit_return` are usable as priors; `max_return_*` is not.

## 5. One measured finding
Outcome for Pump.fun tokens ("pump" suffix), first snapshot per token, cap at snapshot 4,000 to 9,000 USD (n = 3,287), with a valid label. Gross of costs (the exit simulation does not say if fees or slippage are in).
- Reached 2x within 24 h: 19.1% (629 of 3,287). Reached 3x or more (`runner_peak_x`): 7.7%. 5x or more: 1.3%.
- Simulated staged exit (sell half at 2x, etc.) averages 0.674 of the stake, so about minus 33% before any costs. Only 20.6% of those snapshots end at 1.0 or more. Only 4.6% are exactly 0.
- By holders (2x share): up to 50 holders 13.6% (1,214 rows), 50 to 100: 22.3% (1,423), 100 to 200: 25.5% (478), 200 to 400: 13.6% (147).
```
v = tokens[reaches_2x.notna()]; f = v.sort_values(captured_at).drop_duplicates(token_address)
s = f[f.token_address.endswith("pump") & f.market_cap_usd.between(4000, 9000)]   # n = 3287
share2x = s.reaches_2x.mean(); exit = s.staged_exit_return.mean()
by_holders = s.groupby(cut(s.holder_count,[0,50,100,200,400,1e6])).reaches_2x.mean()
```
- Ignore `max_return_*`: 99.9% zero.

## 6. Verdict: PATTERN ONLY
Rich in features, but the main labels are half broken, the trades and wallet tags leak the future, and the sample is survivors from one 20-day month, mixed with non-Pump.fun coins.
Plug-in: use `reaches_2x` with the pump-only, first-snapshot filter as a second prior beside the SmugCalls base rate (Scorekeeper comparison). Use holder and sniper buckets as ideas for analyzer features, but retest them on our own tape. Never feed its wallet tags or full trade table into a test.
