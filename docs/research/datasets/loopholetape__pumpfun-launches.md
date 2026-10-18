# loopholetape/pumpfun-launches

Checked 2026-10-17. Data kept at `.upstreamref/datasets/loopholetape__pumpfun-launches/` (not in git). Scripts: session scratchpad `datasets/lh1.py`, `lh2.py`, `lh3.py`.
All numbers below were computed by code from the files. SOL price used: US$109.78 (see section 5).

## 1. What it is
- Source: HF dataset by "loopholetape", an automated agent. License CC BY 4.0. Size 284.9 MB, 61 files, all downloaded (under 3 GB).
- How collected: its own Solana recorder reads the pump.fun program live (Yellowstone gRPC). One row per launch, with outcome labels filled in later.
- Span: launches 2026-08-31 04:03 UTC to 2026-10-08 23:59 UTC (39 days), 1,445,227 launches. Every launch the recorder saw, not only winners.
- Files (all parquet):
  - `data/launches/` 12 day files, 586,019 rows, 43 columns, 88 MB (complete decoder, 2026-09-27 on).
  - `data/launches_legacy/` 27 day files, 859,208 rows, 114 MB (before a decoder fix: about 48% of buys were not recorded).
  - `data/graduation_pools/graduation_pools.parquet` 19,377 rows, 11 columns. First 30 min of each PumpSwap pool.
  - `data/features/` 15 day files, 1,903,695 rows, 66 columns, 81 MB. A per-minute score log per coin (the owner's API inputs).
  - Plus README.md (70 KB), KNOWN_ISSUES.md, quickstart.py, schema.json.
- Main columns of `launches` (meaning):
  - `mint`, `creator` wallet addresses; `t0` launch unix time.
  - `name`, `symbol`, `uri`: creator text (untrusted).
  - `dev_buy_sol` creator first buy in SOL; `dev_share` creator share of supply after it.
  - `quote_asset` sol/usdc/stock/other; `mayhem` 1 = pump.fun mayhem mode.
  - `graduated` 1 = reached ~85 SOL real reserve and moved to PumpSwap.
  - `rugged` 1 = their rule fired: reserve fell to 25% of its peak (peak at least 5 SOL), or creator sold half within 300 s and reserve fell.
  - `rug_dt_s`, `dev_first_sell_dt_s`, `migrate_dt_s`: seconds after launch.
  - `peak_rs`, `terminal_rs`: highest and last real SOL in the curve ("real reserve" = SOL buyers put in).
  - `f10_*` (state at under 10 s of age): `f10_bundle_wallets` (wallets whose first buy was in the creation slot or the next), `f10_insider_share`, `f10_n_buys`, `f10_rep_n/rug/grad` (creator's past launches). `f60_*` same at 10-60 s.
- `features` adds per row: `t`, `age_s`, `f_rs` (real SOL reserve at that moment), `f_n_buys`, `f_bundle_wallets`, `f_dev_share`, flags (`flag_creator_sold`, ...), the odds the API served, plus the outcomes.
- Missing entirely: holder counts, per-trade rows, buyer wallet addresses, USD market cap, callers, tweets.

## 2. Point in time or filled in later
- Point in time (safe as inputs): `f10_*`, `f60_*`, all `f_*` and `flag_*` in `features` (stored as of `t`), `dev_buy_sol`, `dev_share`, `f10_rep_*` (counted strictly before the launch).
- Leaks the future: `graduated`, `rugged`, `rug_dt_s`, `peak_rs`, `terminal_rs`, `migrate_dt_s`, `dev_first_sell_dt_s`, `rugged_not_graduated`, `rug_within_300s_after_row`.
- Read later than launch (2026-09-30 to 10-12): `curve_complete`, `mayhem`, `quote_asset`, `holder_reward`, `creator_fee_bps` (their KI-15).
- Trap: 1,124,855 `features` rows were sampled after the coin's own rug. Keep `rugged_before_row=0`, `migrated_before_row=0`, `repaired=false` when predicting.
- USD market cap is not stored. I convert reserve to cap with the pump.fun curve: cap_SOL = (30+real_SOL)^2/32.19. It matched launchtape's `capAfter` on the rows I checked.

## 3. Bias
- Not survivors-only: all launches. 2.82% graduate (classic, 2026-09-27 on), 60.6% are flagged rugged.
- 10.4% of curves are not SOL-quoted (USDC, stocks, other tokens); SOL columns are null there. Mayhem coins (27%) rug 89%; keep them apart.
- 4.2% of SOL-quoted rows have no outcome yet (null, not "no rug").
- `f10_*` exists for only 68% of launches and that half is not random (68.8% rugged vs 41.8% for the rest, their KI-01).
- `launches_legacy` undercounts buys and peaks (decoder_complete = 0). I used only `launches` and `features` from 2026-09-27.
- `features` rows are sparse: under 30 s at most one row, then once a minute to 5 min, then every 5 min to 15 min, and only after 5 buys were booked. The price path is a sample, not a full path.
- Recorder gaps (largest 28.9 min on 2026-09-09), one 39-day window, one market regime.

## 4. What it can teach Asimog (0 to 3)
- (a) Callers and callouts: 0. No social data.
- (b) Wallet behaviour: 2. Bundle-wallet count, insider share, dev share, creator history (serial ruggers by creator address). No buyer wallet list.
- (c) Coin metrics at 6K vs what happened after: 1. Per-minute reserve samples give a rough path. No holders, no USD cap.
- (d) Text and sentiment: 1. Name, symbol, uri of 1.4M coins only; no descriptions.
- (e) Labels for strategies: 2. Large and honest graduation, rug and peak labels. They are their rules, not our "2x before 0.7x".

## 5. Measured findings
Set: SOL-quoted, non-mayhem, decoder complete (`launches`, 2026-09-27 to 10-08), 368,605 resolved launches.
6K USD at SOL US$109.78 = 54.65 SOL market cap = 11.94 SOL real reserve. This dataset has no SOL price; I took the 2026-10-10 price from launchtape (days off, see sensitivity).
- Crossed 6K (peak_rs at least 11.94): 68,605 of 368,605 = 18.6%.
- Of those 68,605: peak reached 2x the threshold price (reserve at least 29.32): 25,608 = 37.3% (upper bound, ignores the 0.7 stop). Graduated 15.4%. Rug rule fired 86.3%. Ended at or below 0.7x the threshold price: 84.6%.
- Sampled path from `features` (entry = first row at or above threshold, entry price at most 1.3x threshold; 11,732 coins; median entry age 40 s):
  - Win (2x first) 1,186 = 10.1%. Loss (0.7x first) 8,713 = 74.3%. Open 1,833 = 15.6%. Wins among resolved: 12.0%.
  - SOL US$100: 11.3% win, 13.4% of resolved (n=10,328). SOL US$130: 8.3% and 10.0% (n=15,336).
  - 27% of the open ones peaked above 2x, so the true share is about 10% to 14%.
- Holders are not in the data. Closest substitute is buys booked (not unique wallets) at the entry row:
  - 20 or more: n=9,898, win 9.9%, 11.9% of resolved. 50 or more: n=6,551, 10.2%, 12.3%. 100 or more: n=2,282, 9.5%, 11.7%.
  - Under 20: n=1,834, 11.2%, 12.6%. No lift from more buys.
- Bundle wallets at the entry row: 3 or more n=9,189, win 10.2% (11.8% of resolved). Under 3: n=2,543, win 9.8% (12.9%).
- Bundle at under 10 s (`f10_bundle_wallets`), crossers only:
  - 3 or more: n=45,237 (71%): ever-2x upper bound 33.9%, graduated 9.8%, rugged 91.8%.
  - Under 3: n=18,440: 45.9%, 29.6%, 72.1%. Few bundle wallets gives about 3x the graduation rate, but not a better 2x-before-0.7x.
- Fees (~2.5%) are not included. With +100% / -30% payoffs and 2.5% cost, break-even is 25.0% wins among resolved. 12% is far below: buying every crosser loses.

Query logic:
```
thr_cap = 6000/109.78 ; cap(rs) = (30+rs)^2/32.19 ; rs(cap) = sqrt(cap*32.19)-30
rows: features, launch_quote_asset='sol', launch_mayhem=0, launch_decoder_complete=1, settled, not repaired, lag<=10s
entry = first row by t with cap>=thr_cap, rugged_before_row=0, migrated_before_row=0; keep if cap<=1.3*thr_cap
after = later rows with migrated_before_row=0 ; win_t = first cap>=2*entry_cap ; loss_t = first cap<=0.7*entry_cap
res = win if win_t<loss_t ; loss if loss_t<win_t ; else open (open and graduated=1 counts as win)
upper bound (launches table): peak_rs>=11.94 is crossed ; peak_rs>=29.32 is ever 2x
```
- Limits: sparse samples miss quick dips and spikes; the entry is later and higher than the true crossing.

## 6. Verdict: USE AS PRIORS
Large (1.4M launches) and clean on labels, but no holders, no trades and sparse price rows, so it cannot give exact 2x-before-0.7x labels.
Plug-in for Asimog: (1) scorecard baseline "buy every 6K crosser" = about 10-14% wins vs 25% break-even; (2) Scanner prior: 71% of crossers already show 3+ bundle wallets and 86% are flagged rugged; (3) test `f10_rep_*` creator history as a feature.
Text check: no instructions aimed at an AI in the card or KNOWN_ISSUES (only a normal warning that creator text may contain some, KI-14). The card also advertises a paid API and an MCP server; ignored. Never feed `name`/`uri` to an LLM as instructions.
