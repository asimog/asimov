# jocry/Pumpfun_Memecoin_Corpus

Checked 2026-10-17. Local copy: `.upstreamref/datasets/jocry__Pumpfun_Memecoin_Corpus/` (1.6 GB of 6.7 GB). Scripts are outside the repo.

## 1. What it is
- Source: https://huggingface.co/datasets/jocry/Pumpfun_Memecoin_Corpus (author "Slink Dev", last edit 2026-09-27). Collected by websocket plus Solana RPC polling, 2026-06-05 to 2026-07-14 (39 days). Every launch in the window, not a pick.
- License: the card header says MIT, the card text says CC BY 4.0. They disagree. Ask the author before any commercial use.
- Downloaded: all small tables, `snapshots.parquet` and 2 of 18 trade shards (`trades-00000` = Jun 5-11, `trades-00009` = Jun 25-Jul 2, 1,966,080 trades each). Not downloaded: the other 16 shards (about 5 GB). All trade numbers below cover only these two shards (about 12% of 33.6M trades).
- Tables (rows): `tokens` 798,430 (one per coin: launch size, creator history, first holder concentration, `graduated_at`, name, symbol); `trades` 33.58M (buy/sell, SOL, wallet, curve state); `snapshots` 26,934,864 (60 s, 5 min, 30 min, 1 h buckets with price, buy/sell counts, `unique_wallets`, `buy_pressure`); `postgard_snapshots` 1,392,133 (after graduation: DEX price, liquidity); `postgard_outcomes` 5,669 (one label per graduated coin: `outcome_label` dead / pump_dump / slow_bleed / major_pump / minor_pump / sustained, and `rug_detected`); `migrations` 5,701; `wallet_stats` 1,016,374.
- Columns worth knowing: `creator_past_tokens` and `creator_past_rugs` (e.g. 738 and 510), `initial_buy_sol`, `initial_top1/5/10_pct_corrected`, `initial_holder_count` (max 20 after Jun 10), `market_cap_sol_eob` (market cap in SOL at the end of the bucket), `unique_wallets` (wallets trading in that bucket).
- There is NO caller, NO callout, NO post text. Only coin name, symbol, metadata link.

## 2. Point in time or snapshot
- Recorded live: trades, snapshots, launch fields (`initial_*`, `initial_buy_sol`), `creator_past_*` (the max grows from 291 for coins before Jun 6 to 10,003 for coins after Jul 12, so it looks counted as of launch).
- Filled in later (lookahead, do not use as features): `graduated_at`, `seconds_to_graduation`, `peak_market_cap_sol`, `peak_market_cap_at`, `trade_count`, `is_training_ready`, `is_zombie`, `data_quality_score`, `tracking_expires_at`, all of `postgard_outcomes` and `migrations`. The card says `entry_price_20s/30s/1m_usd` are filled almost only for graduated coins (leaks the label).
- `wallet_stats` is a stale snapshot built mid-collection (card: only 37.7% of totals match a recount). I did not re-verify it. Do not use its totals.
- Measured oddity: for graduated coins `peak_market_cap_sol` has median 62.5, below the roughly 229 SOL seen at curve completion in snapshots. So it is not a true lifetime peak.
- Five regime breaks (card section 5): holder-count cap 54 to 20 on Jun 9-10, Mayhem Mode from Jun 20, outage Jul 3, curve field shift Jul 4. Split train and test by date, and not across these.

## 3. Bias
- Not survivor-only: all 798,430 launches are in `tokens`. Only graduated coins (5,689; 0.71%) have outcome labels and post-graduation data.
- Graduation share rises from 0.003% (week of Jun 1) to 2.2% (week of Jul 6). Cause not tested here; base rates drift, so use late weeks only.
- Known bad rows (card): 3.38% of trades have a SOL amount that does not match price x tokens; 7.03% have no price (whole coins); 19.9% of trades are the System Program address (not a person). In my two shards the System Program is 14.2% and 25.6% of trades.
- 22.1% of coins have zero trades; 32.4% have 1 trade or fewer.
- One chain, one collector, SOL at about 65 to 82 USD (measured from `postgard_snapshots`).
- Token names are user text and untrusted. I found 4 of 798,430 names or symbols aimed at an AI, e.g. name "IGNORE ALL PREVIOUS INSTRUCTIONS" (symbol BUYTHIS), and "System Prompt". Ignored.

## 4. What it can teach Asimog (0 to 3)
- (a) Caller and callout behaviour: 0. No callers or callouts. Cannot test "who calls first".
- (b) Wallet behaviour: 2. A real wallet per trade, creator history, early buyers. No bundle labels; `wallet_stats` is stale. Measured: of wallets that buy within 2 s of launch, 96 of 2,242 (4.3%) do it in 10 or more coins and make 37.3% of those buys (shard 0); 209 of 5,516 (3.8%) make 38.6% (shard 9).
- (c) Coin metrics near 6K USD mcap vs after: 3. Full population, 60 s buckets, with the later path. Done below.
- (d) Text and sentiment: 1. Only names and symbols.
- (e) Labels to test strategies: 2. Graduation and the post-graduation outcome are real labels, but only graduated coins have outcomes and rates drift.

## 5. One measured finding
Entry at about 6K USD market cap (78 SOL, using SOL = 77 USD, the median in `postgard_snapshots`). Window: coins detected 2026-06-20 to 2026-07-12 (469,201 coins). Entry = first snapshot bucket with `market_cap_sol_eob >= 78`.
- 18,663 coins (4.0% of 469,201) ever reach it. Of those, 8.2% graduate (base rate in the same window 1.1%), 4.9% within 5 min.
- Market cap 5 min after the bucket ends (17,737 coins with a later bucket; coins that graduated away are missing here): 38.7% unchanged, 11.9% up 10% or more, 42.2% down 10% or more, 3.4% up 2x or more, 36.7% down by half or more, median ratio 1.00.
- So buying the crossing is a bad trade on average. This agrees with our own tape (54 of 61 callouts lost at 5 min).
- Graduation share by `unique_wallets` in the crossing bucket (quartiles, about 4,666 coins each): 2.5% (0-2 wallets), 5.5% (2-5), 11.2% (5-33), 13.7% (33+). By creator past tokens: 12.4% (0), 11.0% (1-4), 8.9% (5-49), 5.7% (50+). Higher buy pressure in that bucket means less graduation, 13.0% (lowest quartile) to 5.8% (highest), probably because 100% buy pressure often means one buyer (not tested).
```
tk = tokens with detected_at in [06-20, 07-12)
sn = snapshots join tk
cross = first row per mint with market_cap_sol_eob >= 78   (t0 = bucket_start + bucket_seconds)
grad = graduated_at is not null          (label only, never a feature)
mc5 = first snapshot with bucket_start >= t0 + 300 s; ratio = mc5 / mc0
report share(grad), share(ratio<0.5), by quartile of unique_wallets
```

## 6. Verdict: USE AS LABELS
The only full-population set with a time path, a wallet per trade and graduation labels, and it says plainly where it is wrong. Use only coins from Jun 20 on, split by date, drop lookahead fields, drop System Program trades.
Plug-in: build a replay tape of coins crossing 6K USD and test the "wallets in bucket" and creator-history rules against `graduated_at` in the pre-call analyzer (`services/core/src/analyzers/precall.ts`) and its replay suite; use the early-buyer stats as a prior for the Chain Reader. It cannot test callouts or callers.
