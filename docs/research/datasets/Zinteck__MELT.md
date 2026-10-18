# Zinteck/MELT (Memecoin Launch Trace)

Checked 2026-10-17. Local copy: `.upstreamref/datasets/Zinteck__MELT/` (gitignored). The card has no text aimed at an AI agent. It says the paper is "under review" and anonymized, so there is no paper to cite.

## 1. What it is
- Source: Hugging Face `Zinteck/MELT`, last modified 2026-07-30. Licence **CC BY-NC 4.0** (non-commercial; fine for research, a legal question if Asimog trains on it for a business).
- How collected: parsed Solana on-chain transactions for Pump.fun launches, plus engineered features and risk labels. The card does not describe the method.
- **Population: 41,470 coins, and every one of them graduated** (`migrate_time` present in 41,470 of 41,470). "Graduated" = moved from the Pump.fun bonding curve to the open DEX (about 69K USD market cap). Created 2024-12-09 to 2025-03-01 (about 83 days).
- Size: 146 files, 25.25 GB. I downloaded 841 MB (cap was 3 GB): all of `memecoin`, `label`, `feat`, `bundle`, plus a SAMPLE of transactions: pre_migration shards 00000, 00010, 00020 (3 of 21) and post_migration shard 00000 (1 of about 120). Numbers below use the full small tables unless they say "sample".

| Table | Rows | Files |
|---|---|---|
| `memecoin/memecoin.parquet` | 41,470 | 7.6 MB |
| `label/labels.parquet` | 41,470 | 1.7 MB |
| `feat/feature.parquet` | 41,470 | 74 MB |
| `bundle/bundle-00000.parquet` | 3,328,964 | 210 MB |
| `transaction/pre_migration-00000..00020` | about 30.8M (card) | 21 files, about 3.5 GB |
| `transaction/post_migration-*` | about 187.7M (card) | about 120 files, about 21 GB |

Columns (name: meaning, example):
- memecoin: `mint_addr` coin id (`BUnX...pump`); `creation_time`, `migrate_time` unix seconds (1740786898); `name`, `symbol`, `description`, `image_url`, `twitter`, `website`, `telegram` (name filled for 26,996 coins, twitter 17,507, telegram 5,871); `signature`; `creator`.
- `creator` has **one single value for all 41,470 rows** (checked). It is the migration account, not the dev wallet. Useless for dev or caller analysis.
- transactions: `mint`, `type` (mint&swap, swap, transfer, zero), `timestamp`, `signature`, `trader_map` (JSON text `{wallet: token change}`), `token_amount`, `sol_amount`, `fee_amount`, `price` (SOL per token; the sign is a buy or sell marker, use abs), `block_slot`, `block_index`.
- bundle: `entity`, `entity_type`, `identifier`, `source`. Co-purchase 869,805 rows / 389,484 groups; Fund-flow 1,370,286 / 656,938; Jito Bundle 1,088,873 / 361,447.
- label: `mint_address`, `min_ratio` (0 to 1), `manipulated` (yes or empty), `label` (high / medium / low).
- feat: 122 numbers per coin. Group 1 timing and price, group 2 holder concentration, snipers (bought within 0/1/5/10 s), dev hold, early-holder profit, group 3 market activity (wash trades, transfers, buy/sell counts), group 4 bundle clusters and concentration. Also `ts` (price candles, 5 numbers each) and `ts_len`.

## 2. Point in time or snapshot
- Transactions: event level, unix-second timestamps. Point in time, good.
- `feat`: the card says computed only from pre-migration data. That means the whole life of the coin up to graduation, so values are a snapshot at about 69K USD, NOT at 6K. Holder counts, top-10 share, sniper share, wash ratio, `*_pnl_mean` and `*_hold_ratio` all include trades after the 6K moment. Using them for a 6K decision leaks the future.
- `label`: built from post-graduation prices (first hour after). It is an outcome. Never use it as input.
- `manipulated`: method unknown. It tracks the features very closely (see 5), so it may be circular.
- `min_ratio` is not documented. On the 341 sample coins its correlation with (lowest price / first price after graduation) is 0.73. My reading: how far price falls in the first hour after graduation. That is my assumption.

## 3. Bias
- **Survivorship (the big one).** Only graduates. Coins that die before graduating are missing, so "how fast do launches die" and "buy every coin crossing 6K" cannot be measured here.
- Graduation is fast: 5th percentile 100 s, median 402 s, 90th percentile 9,364 s. The sample leans to hot coins.
- One bull period (Dec 2024 to Feb 2025); daily launches fell from about 900 in late January to about 200 in late February. No regime test.
- Label rate is not selective: `high` is 34,890 of 41,470 (84.1 percent).
- Non-commercial licence. Metadata (name, links) missing for about 35 percent of coins.

## 4. What it can teach Asimog (0 to 3)
- (a) Caller and callout behaviour: **0**. No callouts, no callers, `creator` constant.
- (b) Wallet behaviour: **3**. Three bundle sources, sniper shares at 4 speeds, dev hold, early-holder profit, wash ratio, clusters. Best part. Rebuild point-in-time versions from raw swaps.
- (c) Coin metrics at about 6K vs outcome: **1**. Raw swaps allow it, but only for graduates and only 3 of 21 pre shards downloaded.
- (d) Text and sentiment: **1**. Names, descriptions and links for 26,996 coins; no sentiment or callout text.
- (e) Labels to test strategies: **2**. The post-graduation crash label is usable for "what happens after migration"; not as a 6K-entry label.

## 5. Measured findings (all 41,470 coins; crash = `min_ratio < 0.3`)
Query logic (DuckDB):
```
D = labels JOIN feat ON mint_address JOIN memecoin ON mint_addr
crash = min_ratio < 0.3 ;  ok = min_ratio >= 0.7
dur   = migrate_time - creation_time   (seconds)
for col in [dur, group2_sniper_0s_ratio, group4_cluster_holder_ratio]:
    q = ntile(4) over (order by col)
    group by q: count, avg(crash), avg(ok), avg(manipulated='yes'), median(min_ratio)
```
1. **Baseline: 67.5 percent of graduates (27,987 of 41,470) end the first post-graduation hour below 0.3 on `min_ratio`; only 15.6 percent (6,449) stay at 0.7 or higher.** Median `min_ratio` is 0.113. Graduation is not safety; most graduates bleed.
2. **Fast graduation predicts the crash.** Quartiles of `dur` (each n about 10,367): up to 155 s: crash 74.1 percent; 155 to 402 s: 78.5; 402 to 1,852 s: 68.5; over 1,853 s: **48.8** (ok share 21.0 versus 10.5 to 15.6). Slow, organic graduations hold better. `dur` is known at graduation, so no look-ahead for a post-graduation decision.
3. **Early snipers: weak signal.** Sniper-at-0s share lowest quartile (up to 0.0057): crash 59.9 percent; the other three: 69.0, 73.3, 67.8. Not a clean line. The `manipulated` flag climbs 22 to 95 percent over the same quartiles, but it is likely built from the same features, so do not count it as evidence.
Limits: graduates only, one period, one hour window, no fee drag (about 2.5 percent round trip) applied.

## 6. Verdict: PATTERN ONLY (plus a PRIOR for post-graduation behaviour)
Not labels for the 6K Scanner: every row graduated and features are taken at about 69K, not 6K. Useful for wallet-analysis ideas and a prior that fast pump-to-graduation is worse than slow.

Plugs into Asimog:
- Use its feature list (sniper shares at 0/1/5/10 s, dev hold, cluster share, wash ratio) and its three bundle sources (co-purchase, common funder, Jito bundle) as a checklist for `precall` and Scanner features, then recompute them from our own Tape at the 6K moment.
- Use the 67.5 percent post-graduation crash rate as a sanity prior for any hold-through-graduation rule. Keep it out of any training path until the non-commercial licence question is settled.
