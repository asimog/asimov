# Dataset review: Solid-Sea/pump-gold-dataset

Checked 2026-10-17. Clone: `.upstreamref/datasets/Solid-Sea__pump-gold-dataset` (gitignored). Scripts were read, never run. Analysis scripts: scratchpad `datasets/pg.py`, `pg2.py` (duckdb, `python -I`). Counts are over the 1,306,082 rows unless a denominator is given.

## 1. What it is
- Source: a student paper (ICDM 2026 Teen Research Symposium submission) about wash trading (fake volume between a person's own wallets). Raw trades are said to come from a public Kaggle pump.fun trade dump. `.zenodo.json` says month 2025-02, "extracted by Dune". The README claims 17,033,442 trades, but the trades are NOT in the repo.
- Files (git ls-files): `pump_gold_dataset_core.csv.gz` (83,094,306 bytes), `README.md`, `LICENSE`, `.zenodo.json`, `export_dataset.py`, `rf_classifier_eval.py`. No Drive or HF links. Nothing else to download.
- Rows: 1,306,082, one per token, 1,306,082 distinct mints. No timestamp column at all.
- Columns (10): mint, buy_count, sell_count, unique_wallets, total_quote_lamports, avg_swap_size, pmin, pmax, is_golden, is_dead.
- Mismatch: `export_dataset.py:13-14` writes 12 columns (also total_base and n_price, the number of price points). The shipped CSV has 10. So the file was not made by this exact script, or was trimmed later.
- License: LICENSE says CC BY 4.0 (credit the authors); README says "research purposes". Fine to use with credit.
- Auto-run files: no `.vscode/`, no tasks.json, no hooks. No text aimed at an AI agent found.

## 2. The label
Code, `export_dataset.py:17-18`:
```
CASE WHEN c.pmax>=10*c.pmin AND c.pmin>0 THEN 1 ELSE 0 END   -- is_golden
CASE WHEN c.pmax<2*c.pmin  AND c.pmin>0 THEN 1 ELSE 0 END   -- is_dead
```
`pmin` and `pmax` come from table `coin_path` (`export_dataset.py:16,19`), which lives in a database we do not have.

Plain answer: yes, the previous review is right. The label looks at the whole life of the coin, to the end of the data. It compares the highest price with the lowest price and never checks which came first. So:
- It uses information from after any decision time. There is no entry point.
- A coin that spikes and then crashes can be "golden" just like one that dips and then rises. The order is not in the file.
- It is max over min, not exit over entry. It is not a return you could earn.

How much does it matter? Measured:
- Median pmin = 2.82e-5; the 1st to 99th percentile of pmin is 2.70e-5 to 4.19e-5. So pmin is almost always the launch price, and "pmax >= 10 x pmin" mostly means "reached 10x the launch price".
- Of 3,304 golden coins, only 12 (0.4%) have pmin above 1.5x the typical launch price. Only those could be pure "dump" cases. 537 (16.3%) have pmin above 1.1x launch, so something moved before the low.
- Opposite error: 5,072 coins reached 10x the typical launch price, but only 3,304 are golden. About 1,768 coins that reached 10x launch are labelled not golden, because their pmin was already raised. 7 golden coins never reach 10x launch.
- A real point-in-time label (enter at a fixed early moment, measure the outcome after) CANNOT be built: no timestamps, no trade order, no price path. So "how many gold coins stop being gold" is unknown. Bounds: at least 12 (0.4%) lose the label, at most about 537 (16.3%) are in doubt, and about 1,768 would be added. For 10x-from-launch the label is roughly right, but it is a best case after the fact, not a tradeable result.
- Dead (`pmax < 2 x pmin`): 1,213,462 = 92.9% (README says 93.4%). Mostly "nobody traded": 233,063 coins (17.8%) have exactly one trade, so pmin = pmax by construction. 89,316 coins are neither golden nor dead.
- Bad prices: pmin <= 0 in 5,828 rows, pmin missing in 907, pmin exactly 1.0 in 190, pmax exactly 1.0 in 2,894. Max ratio is 37,037x.

## 3. Point in time or snapshot?
All snapshot, whole-life, computed after the coin was finished:
- buy_count, sell_count, unique_wallets, total_quote_lamports, avg_swap_size are totals over ALL trades. A coin that later goes 10x gets more trades by definition. This is the real leak: the features are partly the outcome. Golden coins (n=3,304): median 30 trades, 26 wallets, 85 SOL volume. Dead (n=1,213,462): median 6 trades, 5 wallets, 2.4 SOL.
- Mechanical effect, golden rate by trades per coin: 0.00% (1 trade), 0.10% (2-4, n=227,933), 0.14% (5-19, n=668,964), 0.81% (20-99, n=157,839), 4.65% (100+, n=18,283). More trades means more chances for a big max/min, whatever we could know at 6K.
- No launch-time fields: no creator, no first buyers, no wallet list, no time, no market cap at a moment, no holder count at 6K.

## 4. Bias
- Whole-life features leak the label. `rf_classifier_eval.py:10-19` trains on exactly these 5 features, with all gold plus 30,000 random dead coins (`random_state=42`, line 21). No AUC is printed in the repo. Any AUC from it would mean "coins with many trades have a high max/min", not "gold can be predicted early". Do not cite it.
- Gold vs dead only: the 89,316 middle coins are dropped, so it is the easy question.
- One month (2025-02), one market regime. Includes about 1.3M launches, most never near 6K, so the 0.25% rate is not "of coins that crossed 6K". The baseline "buy every coin that crosses 6K" cannot be rebuilt.
- 1,082,723 of 1,306,082 mints (82.9%) end with "pump"; the other 223,359 are of unclear origin.
- No fees, slippage or exit model. 10x max/min is not a P&L.
- Author is a high-school student; not peer reviewed yet.

## 5. What is usable for Asimog (0 = nothing, 3 = good)
| Area | Score | Why |
|---|---|---|
| (a) callers | 0 | No caller, creator, post or timestamp |
| (b) wallet behaviour | 1 | Counts only. Wallets x2 < trades in 41 of 3,304 golden (1.2%) vs 8,196 of 1,213,462 dead (0.7%). No wallet lists |
| (c) coin metrics at ~6K mcap vs outcome | 0 | Whole-life totals, no value at a moment, cannot cut at 6K |
| (d) text | 0 | None |
| (e) labels | 1 | "Reached 10x launch price" is roughly valid for 3,292 of 3,304 (99.6%) but after the fact and order-free. A sanity prior only |

Small uses: (1) base-rate prior: 0.25% of launches reach 10x max/min (0.08% with under 10 wallets, 5.6% with 100+ wallets; whole-life, so biased upward); (2) a cross-check that our Scanner's "reached 10x" counts are in the same range once we have our own ordered data; (3) the idea of a wallets-vs-trades wash ratio, to be recomputed from our own early trades.

## 6. Verdict
**PATTERN ONLY.**
- The label is whole-path max over min with no time order, and the features are whole-life totals, so no early-entry model can be trained or honestly tested here; there is no time or wallet data to rebuild a point-in-time version.
- Keep it as a base-rate cross-check (about 0.25% gold, 1.3M coins, Feb 2025) and as a warning for our own labels: label = outcome after a fixed entry, features = only what existed at entry.
