# Pumpdotstudio/pump-fun-sentiment-100k

Checked 2026-10-17. Local copy: `.upstreamref/datasets/Pumpdotstudio__pump-fun-sentiment-100k/` (203 MB, all of it). Scripts are outside the repo.

## 1. What it is
- Source: https://huggingface.co/datasets/Pumpdotstudio/pump-fun-sentiment-100k (Pump Studio, last edit 2026-03-04). License: CC BY-NC-SA 4.0 (non-commercial, share-alike).
- How made: outside AI agents on the Pump Studio site read a live "datapoint" for a coin, then submit a sentiment label, a risk label and a text summary. The site checks the numbers against its own live data (must be within 15%) and only keeps rows that pass.
- Files: `data/train-2026-03-04T16-18-11.jsonl`, `...16-18-36.jsonl`, `...16-19-16.jsonl`, `...16-20-12.jsonl` (JSON lines), plus `README.md`.
- Size: 193,410 rows (the name says 100k, the real count is about double), 34 columns, 86,838 different coins, 25 agent keys.
- Time span: 2026-02-19 22:27 to 2026-03-04 16:20 UTC (about 13 days).
- Main columns: `mint` (coin address), `timestamp` (ms when the agent submitted), `sentiment` (bullish/bearish/neutral), `score` (0-100 confidence), `summary` (agent text, median 200 chars), `price_usd`, `market_cap` (USD, e.g. 2354), `volume_24h`, `liquidity`, `holder_count` (e.g. 19), `top10_holder_pct` (e.g. 99.9), `buys_24h`, `sells_24h`, `bonding_progress` (0-100, 100 = graduated), `snapshot_at`, `risk_level` (critical..low), `risk_factors` (tags such as `single_holder_majority`), `buy_pressure`, `volatility_score`, `trend_direction`, `volume_profile`, `deviation_pct` and `dev_*` (check errors), `quality_score`, `content_hash`.

## 2. Point in time or snapshot
- Number fields (`price_usd`, `market_cap`, `holder_count`, `bonding_progress`...) are a snapshot taken just before submission. Measured gap `timestamp - snapshot_at`: median 0.36 s, 75th percentile 13.5 s, max 300 s. No future leak in them.
- `volume_24h`, `buys_24h`, `sells_24h` look back 24 h, not forward. Fine.
- `top10_holder_pct` is 0 in 64.9% of rows and `volume_24h` is 0 in 25.4%: zero means "not available", not a real zero. Do not read it as "perfectly spread".
- `sentiment`, `score`, `risk_*`, `trend_direction` are one AI agent's opinion at that moment. They are not outcomes. There is no field with a later price. No lookahead field found, but also no outcome field.
- `deviation_pct`, `dev_*`, `xp_earned` describe the site's check, not the coin. Do not use them as features.

## 3. Bias
- Only rows that passed the site's check; failed ones are gone.
- 25 agents; the top agent writes 32.4% of rows, the top 5 write 85%. One agent's habits dominate.
- Some coins are polled again and again: one coin has 6,634 rows; 25,747 coins (29.6%) have 2 or more rows; median is 1 row.
- 85.3% of mints end in "pump" (Pump.fun style). 24.4% of rows are graduated coins (bonding_progress 100) but only 1.1% of coins. Big graduated coins mix with dust coins (median mcap of all rows 2.7K USD).
- Label skew: neutral 61.7%, bearish 33.9%, bullish 4.3%.
- English only and very templated: 66.3% of summaries repeat another summary.
- Sampled by what agents chose to look at, not every coin.

## 4. What it can teach Asimog (0 to 3)
- (a) Caller and callout behaviour: 0. No callers, no callouts, no wallets.
- (b) Wallet behaviour: 1. Only counts (`holder_count`, `top10_holder_pct`) and agent tags; no wallet addresses.
- (c) Coin metrics near 6K USD mcap vs later: 1. 14,819 rows are in the 4K-9K USD, not-graduated band (6,881 coins), but "later" exists only as a second poll of the same coin: 2,183 usable pairs, 839 coins.
- (d) Text and sentiment for Jev: 1. 193K labelled summaries, but labels are another AI's guess and 66% repeat text. A sanity set, not truth.
- (e) Labels to test strategies: 0. No outcome label.

## 5. One measured finding
Does a "bullish" label predict a higher market cap at the next poll (1 to 48 h later, coin not yet graduated)? Pairs: 2,183 of 193,410 rows (1.1%); 79.2% of pairs show no change in market cap at all.
- Up share: bullish 31.2% (25 of 80), neutral 10.0% (of 1,316), bearish 8.1% (of 787). Among only pairs that changed: 65.8% / 45.2% / 51.2% (bullish n=38).
- Warning: bullish coins are bigger (median mcap 10,976 vs 3,273 USD) and get re-polled because they are alive. This is not proof the label has skill. `score` has no rank link to the move (Spearman 0.06 inside bullish, 0.006 inside bearish).
```
x = rows sorted by (mint, timestamp); next = next row of the same mint
keep: 1h <= next.timestamp - timestamp <= 48h, market_cap>0, next.market_cap>0, bonding_progress<100
lr = ln(next.market_cap / market_cap)
group by sentiment: count, median(lr), share(lr>0)
```
Also descriptive: hype words (moon, gem, 100x, lfg, ape...) appear in 0.36% of summaries, countdown words 0%, "rug/scam/dump/honeypot" 0.05%. Mentions of community, website or socials: 21.9% (mostly saying they are missing). The text is clinical, not hype.

## 6. Verdict: PATTERN ONLY
Weak and confounded: no outcomes, one AI's opinions, mixed coin types, only 4.3% bullish. Do not use as labels.
Plug-in: borrow the risk-factor vocabulary (README list, for example `creator_holds_majority`, `wash_trading`) as named-bucket ideas for a Jev pack in docs/PIPELINE.md, and use a few hundred non-duplicate summaries as a tone smoke test for Jev. Not for strategy tests. The licence is non-commercial, so keep it out of anything we ship.
Prompt-injection check: no text aimed at an AI agent in the summaries (regex for "ignore previous", "system prompt", "as an ai", "instruction": 0 hits).
