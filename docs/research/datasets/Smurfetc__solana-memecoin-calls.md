# Smurfetc/solana-memecoin-calls

Checked 2026-10-17 by code on the local copy in `.upstreamref/datasets/Smurfetc__solana-memecoin-calls/`. Every number below has its denominator.

## 1. What it is
- Source: Hugging Face dataset `Smurfetc/solana-memecoin-calls`. Made by "SmugCalls", a fully automated bot that posts to a public Telegram channel when its own filters fire (not human callers). The card says the file is hashed and the hash is anchored in Bitcoin (OpenTimestamps). I checked the SHA-256 of `calls.jsonl`: it equals `attest.json` (5731c5b1...4f1). I did not verify the .ots receipts.
- Rows: 10,269 (one per token, 0 duplicate mints, 0 empty fields). Span: 2026-06-30 to 2026-10-17 (110 days with calls, median 93 calls per day; June has only 14 rows).
- License: CC0 (public domain). Size: 1.66 MB. Full download, nothing sampled.
- Files: `calls.jsonl` (data), `README.md`, `LICENSE`, `attest.json`, `calls-a.ots`, `calls-b.ots`, `verify.py` (not run).
- Columns:
  - `mint` token address, e.g. `Ai66...ppump`.
  - `sym` ticker, e.g. `CATE`.
  - `t` call time, unix seconds, e.g. 1785083184.
  - `utc` same time as text.
  - `mc` market cap in USD at the call, e.g. 21077 (median 13,038; 5th to 95th percentile 6,686 to 28,354).
  - `peak` highest later market cap divided by `mc`, e.g. 4167.35. A "ratchet": it only goes up.
  - `tg` Telegram message number, e.g. 4448.
- Odd: `tg` runs to 20,846 but only 10,269 rows exist. About half the channel messages are not in the file. Reason not stated.
- Text aimed at an AI agent: none found. The README has a paid-data upsell ($20/month); ignored.

## 2. Point in time or snapshot
- `mc`, `t`, `utc`, `mint`, `sym`: recorded at the call. Safe.
- `peak`: FILLED IN LATER. It is the best point over an open-ended future ("ratchet", never revised down). It leaks the future by design. The window length is not given, so a July call has had about 3 months to run and an October call a few days. Do not use it as a feature, only as a label.
- Share reaching 2x by call month: Jul 36.7% (of 2,672), Aug 35.3% (of 3,378), Sep 33.2% (of 2,707), Oct 28.5% (of 1,498). Older calls have more time yet score higher, so either the market got worse or the window is short. Cannot tell.
- The card says the public file leaves out "peaks re-verified against post-migration prices" and a flag for SOL-price moves. So `peak` here is unverified and in USD.

## 3. Bias
- One caller only, and it is a bot with its own filters. Says nothing about human callers or crowds.
- Losers are kept (card claim; consistent with 65.8% never doubling).
- Only the peak is recorded. No exit price, no end price, no time to peak. "Went to zero" cannot be measured: `peak` is at least 1.0 for 10,253 of 10,269 rows (16 rows are below 1, min 0.09).
- Tokens the bot never called are missing, so no "what the bot skipped" control.
- No costs, no slippage, no fees. Peak is not a payout (the card says so too).
- Calls are on the bonding curve at low cap, but this is an alert we cannot reproduce: the bot's filters are hidden.

## 4. What it can teach Asimog (0 to 3)
- (a) Caller and callout behaviour: 1. One bot, no caller identity, no position, no crowd.
- (b) Wallet behaviour: 0. No wallets.
- (c) Coin metrics at about 6K cap vs outcome: 1. Only `mc`. Calls at mc 5K to 7K: 29.9% reach 2x (103 of 345); mc under 5K: 9.2% (21 of 228).
- (d) Text and sentiment: 0. Ticker only.
- (e) Labels to test strategies: 2. Honest base rates of the "peak after a call", but peak only, no exit.

## 5. One measured finding
Outcome after a call, valid-at-call field `mc` plus recorded `peak`. Peak only, costs NOT included, no exit rule.
- Reached 2x: 34.2% (3,514 of 10,269). 3x: 21.0% (2,158). 5x: 11.2% (1,151). 10x: 4.8% (495). 100x: 0.27% (28). Median peak 1.53x. Mean peak 4.33x, but one row is 6,195x.
- Never got above 1.1x: 21.6% (2,220 of 10,269 rows have peak under 1.1). That is the nearest thing to "went nowhere"; true zeros are not recorded.
- Rough ceiling: sell exactly at 2x with no costs and the 34.2% winners return 0.684 of stake in total. To break even the other 65.8% must still be worth at least 48% of entry. The file cannot say if they were.
```
d = read_jsonl("calls.jsonl")                 # n = 10269
share(k) = count(d.peak >= k) / 10269         # k = 2 -> 3514/10269
weak     = count(d.peak < 1.1) / 10269
by_mc    = groupby(cut(d.mc,[0,5k,7k,10k,15k,25k,inf])).mean(peak>=2)
breakeven_rest = (1 - 2*share(2)) / (1 - share(2))
```
- 2x share by call cap: under 5K 9.2% (228 rows), 5-7K 29.9% (345), 7-10K 32.8% (1,834), 10-15K 34.0% (3,966), 15-25K 38.0% (3,042), over 25K 34.1% (832).

## 6. Verdict: USE AS PRIORS
Small, clean, tamper-evident, with losers kept, but one hidden-filter bot and peak-only outcomes with no exits or costs, so it cannot grade a strategy.
Plug-in: a baseline row in the caller ledger ("a public bot, 2x rate 34.2% on peak, gross"). Scorekeeper compares our net 2x rate and net result against it, always labelled as gross-peak vs net. Test idea: a replay check that our ledger's loser share is not lower than 65.8% for similar caps.
