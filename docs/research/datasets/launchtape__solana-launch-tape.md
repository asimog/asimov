# launchtape/solana-launch-tape

Checked 2026-10-17. Data kept at `.upstream/datasets/launchtape__solana-launch-tape/` (not in git). Scripts: session scratchpad `datasets/lt1.py`, `lt2.py`, `lt3.py`.
All numbers below were computed by code from the files. Small samples: read every share with its count.

## 1. What it is
- Source: HF dataset by "launchtape" (launchtape.io), a seller of daily on-chain data. This is the free 2-hour sample of seven paid files. License: custom "launch-tape-data-licence": personal and research use inside your own team, no resale, no republishing of the files. So keep the data out of git and out of any public repo. Derived results are ours.
- How collected: public Solana RPC, PumpPortal free feed, IPFS gateways, Meteora and Jupiter public APIs. No wallet labels. Gaps are written as `gap` rows, not filled.
- Size 265.4 MB (17.8 KB docs + 265.4 MB data), 18 files, every table twice (`.jsonl.gz` and `.parquet`, same rows). All downloaded.
- Windows (UTC): gradtrades, pregrad, padfeed, meteora-pools 2026-10-10 14:00-16:00; curvetape, launchmeta 2026-10-13 14:00-16:00; gradholders 2026-10-14 04:00-06:00.
- Tables (rows):
  - `curvetape` 470,519: `create` 4,416, `trade` 456,540, `adopt` 2,978, `complete` 105, `migrate` 121, `end` 6,358, `gap` 1. Every trade on every pump.fun curve. 58 MB parquet.
    - Trade columns: `mint`, `slot`, `off` (slots since creation), `side`, `wallet`, `tokens`, `sol` (without fees), `fee` + `cfee` (protocol + creator fee, 0.95% + 0.3% of `sol`, so 2.5% round trip), `capAfter` (market cap in SOL after the trade, e.g. 56.28), `curveSol` (real reserve, 12.56), `vs`/`vt` (virtual reserves).
    - Create columns: `creator`, `name`, `sym`, `uri`, `quote` (null = SOL), `mayhem`.
  - `gradtrades` 417,544: every PumpSwap trade in the first 30 min after 105 graduations (wallet, price, reserves, fees). 52 MB.
  - `pregrad` 14,417: creates, curve trades, `record` (picture at graduation, 69), `outcome` (67: best gain `maxGain` and worst drop `minDrop` in 10 min after graduation vs price 10 s after it).
  - `padfeed` 3,602: graduations on Meteora DBC and Raydium LaunchLab, with US$ prices of SOL every 30 s (`qpx`).
  - `meteora_pools` 23,794; `launchmeta` 4,597 (name, description, website flags, picture hash); `gradholders` 251 (top 20 token accounts at +1, +10, +60 min after graduation).
- The README lists a `graduates` CSV; it is not in the repo. The README also says full days cost money (sales text, ignored).

## 2. Point in time or filled in later
- Point in time: every `curvetape` trade (chain facts with slot and time), `create`, `padfeed` `qpx`, `launchmeta` `create` phase, `gradholders` (stamped with `mark` minutes after graduation).
- Leaks the future: `end` rows (`maxCap`, `lastCap`, totals, written when the coin stops being followed), `pregrad` `outcome` (`maxGain`, `minDrop`, `crashed`), `gradtrades` `end` totals. `record` is a snapshot at graduation.
- No field is a holder count. I rebuilt holders by replaying wallet balances from the trades up to each moment (see 5). Tokens moved by plain transfer are not seen.

## 3. Bias
- Only 2 hours (Tuesday 2026-10-13, 14:00-16:00 UTC) of curve trades. One short window, one market mood; small counts.
- Coins created before 14:00 appear only as `adopt` rows (partial history); I used only the 3,454 SOL-quoted coins created in the window (4,416 creates; 962 are USDC or other quote tokens; 1,085 of all creates are mayhem).
- Right-censored: coins still alive at 16:00 may be unresolved.
- One 121 s feed gap (`boxcap`). Continuity check (curve SOL change must equal each trade's SOL): 368 of 351,228 trades in 166 coins break. I report results without those coins.
- `pregrad` `outcome`/`record`, `gradtrades`, `gradholders` cover graduates only (survivor sets: 105 of 4,416 = 2.4%).
- `padfeed` SOL price is from 2026-10-10 (3 days before curvetape).

## 4. What it can teach Asimog (0 to 3)
- (a) Callers and callouts: 0. No social posts; `launchmeta` only has coin metadata.
- (b) Wallet behaviour: 3. Per-trade wallets let me count creation-slot buyers (bundles), real holders and the creator's sells. Best of the two datasets for this.
- (c) Coin metrics at ~6K vs what happened after: 3 for shape (full path, exact point in time), 1 for statistics (2 hours, 568 clean crossers).
- (d) Text and sentiment: 1. Name, ticker, description, website flags, picture hash for 4,470 coins; no reaction data. A repeated `imgSha` finds copy-paste coins (2,423 distinct hashes in 4,312 pictures).
- (e) Labels for strategies: 2. Exact 2x/0.7x labels are computable, but only for this window.

## 5. Measured findings
Set: SOL-quoted coins created in the window, 3,409 with at least one trade. SOL price US$109.78 (padfeed, first `qpx` row), so 6K USD = 54.65 SOL cap.
Entry = first trade whose `capAfter` is at least 54.65. Win = cap reaches 2x entry cap before 0.7x (exit at the first trade past the line, so gaps are included). Holders = wallets with more than 1 token net after the entry trade, creator excluded (the curve is not a wallet in this data). Bundle = distinct non-creator wallets buying in the creation slot (`off`=0).
- Crossed 6K: 1,069 of 3,409 = 31.4%. Non-mayhem 680; non-mayhem with clean trade chain 568. Of these 568, 517 (91%) crossed under 30 s after creation, median 0.2 s: they are one-slot bundle launches nobody can follow.
- Zero latency (fills at the crossing trade; not achievable), 568 coins: win 128 = 22.5%, loss 416 = 73.2%, open 24 = 4.2%; wins among resolved 23.5% (95% range about 20-27%). Mean exit multiple 1.036, so +1.1% after 2.5% fees.
- With a 5 s fill delay (entry = first trade 5 s or more later still at or above 6K; 338 of 1,069 crossers had already fallen below, so no entry): n=350, win 51 = 14.6%, loss 284 = 81.1%, open 15; resolved 15.2%; mean exit multiple 0.877, -14.8% after fees. With a 15 s delay: n=280, win 12.9%, resolved 13.9%, -16.4%.
- Slow crossers only (age 30 s or more at crossing, 51 coins): win 9 = 17.6%, resolved 19.1%; at 5 s delay n=44, win 18.2%. Too few to trust.
- Holders at the crossing (568 coins): median 8, 75th percentile 12, max 52. Under 10: 374; 10-19: 134; 20-49: 59; 50-99: 1; 100 or more: 0.
  - At least 20 holders: n=60, win 8 = 13.3%, resolved 14.0%, mean exit 0.871 (worse than baseline). At 5 s delay n=42, win 11.9%.
  - At least 50: n=1 (loss). At least 100: n=0. In 2 hours almost no coin has 50 real holders at 6K.
- Bundle (zero latency): 3 or more wallets n=367, win 20.7% (20.9% resolved); under 3 n=201, win 25.9% (28.7%); none n=62, 14.5%. At 5 s delay: 15.7% vs 12.7%. No stable difference.
- SOL price sensitivity (all crossers incl. mayhem, zero latency): US$100: n=901, 25.6% win (28.8% resolved); US$109.78: n=1,069, 22.9% (25.7%); US$130: n=1,433, 21.4% (24.0%).
- Fees: `fee`+`cfee` measured at 1.25% per side on the sample rows (2.5% round trip), included above where marked "after fees". Slippage not included.
- Break-even (+100% / -30% / 2.5% cost) is 25.0% wins among resolved. Only the untradeable zero-latency set gets near it.

Query logic (pandas on `curvetape` parquet):
```
cs = create rows with quote is null ; tr = trade rows of cs mints, sorted by mint, slot, t, i
cap_thr = 6000/109.78 ; k = first index with capAfter>=cap_thr (decision) ; entry = k, or first t>=t[k]+delay with cap>=cap_thr
holders = count wallets with cumsum(+tokens buy, -tokens sell) up to k > 1, excluding creator
bundle = nunique(wallet) among buys with off==0, excluding creator
after = rows past entry ; win if first(cap>=2*e) before first(cap<=0.7*e) ; loss the other way ; else open
drop coins where |curveSol diff - (+/-sol)| > 0.002 on any trade (missing trade) ; non-mayhem only
```

## 6. Verdict: PATTERN ONLY
It is the right shape (every trade, wallet, slot, fee, cap), so it can compute exactly the Scanner's labels, holders and bundle signs point in time. But 2 hours and 568 clean crossers is too few for thresholds, and the licence forbids sharing the files.
Plug-in for Asimog: (1) a replay-test fixture shape for the Scanner (`docs/14-testing.md`): tape of creates and trades, check "first 6K crossing, holders excl. curve and creator, bundle in creation slot"; (2) baseline sanity: untradeable instant crossers must be excluded or the baseline looks profitable; (3) our own Chain Reader tape should record `off`, `fee`, `cfee` and `capAfter` like this one. For thresholds, record 2+ weeks of our own tape.
Text check: no instructions aimed at an AI in README, MANIFEST or names (one coin is called "Prompt Nap", harmless). The README advertises paid plans and a "test prompt"; ignored.
