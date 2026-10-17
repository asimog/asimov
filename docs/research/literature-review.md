# Literature review: what the papers change in Asimog

Read 2026-10-17. PDFs in `docs/literature/`. For each paper: the question, the data, the unit, features and labels, timing assumptions, evaluation, limits and leakage, and the Asimog part it informs. Then the decisions it led to.

Rule: no reported number from a paper is a claim about Asimog. Where a paper gives a baseline we can compute on our own tapes, we compute it (listed at the end) and publish our own number.

Depth: the four pump.fun papers were read in full. The four older social-media papers were read for abstract, question, data and method only; their exact feature lists are not recorded here.

## 1. Meme Coin Factories (Szwajcok, Tsuchiya et al., arXiv:2609.10246, Sep 2026)

| | |
|---|---|
| Question | How widespread is manipulation on pump.fun, and what strategies and tooling exist? |
| Data | Metadata for all 15,245,966 coins, 2024-01-14 to 2026-01-14 (Chainstack, Syndica, Arkham labels, pump.fun API at 4 to 5 s per request). Full transactions for a uniform 1% coin sample (152,171 coins, 49.97M tx) and a 5-day sample (149,028 coins, 37.35M tx). Coins with more than 5M tx were dropped. Comments for the 1% sample. Daily OHLC for graduated coins only. |
| Unit | Transaction (wash trading, dumps), creator address and funding cluster (obfuscation), coin (copycats), commenter address (comment bots), social post (post-based launches). |
| Features and labels | **WT1**: one address buys and sells the same amount on the same curve inside one transaction (lower bound; impossible from the UI). **WT2**: same amount at about the same price inside a time window (inclusive; false positives grow fast with the window). **DP1**: several senders transfer tokens to one dumper who sells all of it inside one transaction (all senders sign: same entity or colluding). **DP2**: the same within 24 h. **Creator clusters**: first-funder graph up to 3 hops, Arkham-labelled services removed, adversarial leave-one-out check. **Copycats**: same name, symbol, description and IPFS image hash; the earliest is the "original"; same-creator or same-cluster pairs are excluded. **No `pump` suffix**: the mint was created outside the web UI (lower bound, since suffixes can be ground). **Comment lockstep**: two addresses posting within 0.1 s of each other on at least two coins. |
| Timing | Creation and transaction times from chain. Price data is daily, and daily highs were replaced by the maximum daily low to remove pump.fun price glitches. |
| Evaluation | Descriptive prevalence plus a logistic regression of graduation on wash-trade counts (doubling wash trades: graduation odds +19%). Consistency checked across both samples. |
| Limits and leakage | Graduation (1.02% overall) is the only outcome for most analyses; correlation, not cause. Arkham label misses inflate clusters. Exact-hash copycats miss edited images. Social analysis cannot show intent. "Extractable value" uses graduated coins only. |
| Informs | **Hunt** (docs/07): `wash_atomic` (WT1) and `bundle_buy` from our own trade stream, `ticker_collision` from our coin and callout records, the no-suffix creation flag. **Indicators, never accusations**: they give lower bounds with named false-positive sources. Funding clusters wait for `wallet.funded_by` (docs/06). |

Finding we keep: manipulators prioritise transaction **count** over volume, because fees scale with volume. Trade counts and unique-wallet counts are therefore the cheapest signals to fake. Asimog never treats trade count, comment count or callout engagement as proof of demand.

## 2. Predicting the success of new crypto-tokens: the Pump.fun case (Marino, Naviglio, Tarantelli, Lillo, arXiv:2602.14860, Feb 2026)

| | |
|---|---|
| Question | Given the observable curve state, what is the probability a token graduates, and which early variables shift it? |
| Data | Every new token from 2025-09-01 to 2025-10-01, parsed from chain (pump and PumpSwap programs): 655,770 tokens, 243,123 creators, 4,338 graduations (0.63%), 2.6M trader addresses. |
| Unit | Token, observed at each bonding-curve level `vSol`. |
| Features and labels | Label: graduation (protocol-defined, about 115 virtual SOL = 30 virtual + 85 real). Conditioners, each computed only from trades up to the current `vSol`: share of direct-contract ("bot") trades, number of trades to reach the level, presence of wallets that were highly profitable **during the same month**, prolific creators. Dumps: a robust Shewhart rule (median and MAD over a 30 to 200 trade baseline) on log returns. |
| Timing | Conditioning is time-consistent along the curve. The "successful trader" and "top creator" sets are defined over the whole month, which **uses future information** for tokens early in the month. |
| Evaluation | Empirical conditional probability curves against a baseline `p_std(vSol)`, plus an economic **breakeven curve**: buying at `vSol` and holding to graduation pays only if `p > vSol² / 115²`. The unconditional curve lies below breakeven everywhere: price alone never pays for buy and hold. Fees are ignored. |
| Limits and leakage | One month. The successful-trader and top-creator flags leak (above). The text describing `isBot` contradicts itself once (which side is the UI); the later definition (direct contract call = bot) is the one used. No transaction costs. |
| Informs | **Curve analyzer and Scorekeeper**: the breakeven curve `vSol² / 115²` is a free, honest bar for any "will it graduate" claim, and our net-of-cost outcome generalises it to our order size. **No-lookahead rule** for caller features: a caller's quality at time t uses only outcomes resolved before t. Checked against our code on 2026-10-17: **`caller.dna` broke it.** It averaged pump.fun's own `max_multiple` from `mem.callouts`, which the memory projection updates from `callout.counts`, and memory runs up to one replay window (and in live, arbitrarily far) ahead of the analyzer. Fixed in S3.8: `caller.dna` now reads our own resolved outcomes, with `seen_time` before the callout. The fastest-accumulation finding (few trades to reach a level) is a candidate cheap feature for S3. |

## 3. Do Two On-Chain Observation Pipelines See the Same Tokens? (Kamat, arXiv:2609.18975 v2, Sep 2026)

| | |
|---|---|
| Question | Do two differently configured collectors on pump.fun observe the same mints? |
| Data | A cohort-detection pipeline (first ten buyers, co-occurrence graph, union-find) and a trader-side rejection log (RED-REJECT-2026-v2). Windows: 11 to 25 June 2026 and 29 June to 16 July 2026. |
| Unit | Mint set per pipeline per window. |
| Features and labels | Intersection, union, observed proportions, Jaccard and Dice, under four timestamp rules. |
| Timing | The rejection stream has a 21-day collection gap that its own dataset documentation did not mention; in v1 it covers only 4.4% of the cohort window. |
| Evaluation | Descriptive only. No confidence intervals, because inclusion is deterministic given the collector configuration and no sampling model exists. |
| Limits | Same author, infrastructure and programme for both pipelines; not independent. Version 1 overstated results and was corrected (§7.2). |
| Informs | **Coverage is a first-class output.** In v2 the pipelines share 5 of 2,360 mints. Any Asimog statement about "the market" is a statement about our collector. Every outcome carries a coverage status, every source writes `system.gap` when it stops, and ledgers report what was excluded and why. Our own measurement on the fixture tape: trades were recorded for 68 of 158 called coins, and on 44 of 53 coins the first recorded trade comes **after** the first callout, because the Chain Reader subscribes only once a coin is called. Pre-call buying is therefore unobserved unless a backfill runs. |

Its lesson about its own correction is also ours: publish corrections in place and keep the old claim visible, never rewrite it.

## 4. Don't You Know, Pump It Up! (Moura, Paoletti, Ferreira, Almeida, arXiv:2609.01176, ICWSM 2027)

| | |
|---|---|
| Question | How do public Telegram channels relate to market activity, and can pump-and-dump attempts be surfaced at scale? |
| Data | One year of public Telegram: 14,499 channels, over 20M messages, aligned with trades for more than 17,000 cryptocurrencies. |
| Unit | Coin-day mention series, then minute-level windows around bursts. |
| Features and labels | A fine-tuned RoBERTa crypto-relevance filter (to resolve polysemous tickers), CA-CFAR burst detection on daily mentions, then RDD and DiD around the burst with Bitcoin and stablecoins as controls. Psycholinguistic profiles. |
| Timing | Bursts precede price moves by seconds; minute bars after daily candidates. |
| Evaluation | Quasi-experimental: 47 events consistent with pump-and-dump, 73 sustained reactions. |
| Limits | Public channels only; private coordination is invisible. "Consistent with" is the strongest claim made. |
| Informs | **Text is weak evidence.** Pump messages were linguistically indistinguishable from organic talk, which matches Meme Coin Factories §8.1 on comment bots. Jev's `promo` and `thesis_quality` judgments stay judgments, labelled as AI output, and are never the sole evidence for an indicator. **Ticker ambiguity** is real (their `$Trump`, `$Jesus`; our 13 colliding tickers in ten minutes): a callout links to a mint, never to a ticker. **Burst detection with a control** is the pattern for a later callout-burst analyzer: compare a coin's callout burst against the whole feed's rate, not against zero. |

## 5. A Midsummer Meme's Dream (Mongardini, Mei, arXiv:2507.01963, USENIX Security 2026)

| | |
|---|---|
| Question | How much of meme-coin growth across chains is artificial, and how does it lead to profit extraction? |
| Data | 34,988 meme coins on Ethereum, BSC, Solana and Base. Three-month longitudinal price tracking. Dune transaction data for flagged days. Dataset released. |
| Unit | Token-day (OHLCV), then maker addresses on flagged days. |
| Features and labels | Wash-trading candidate: daily volume over +500% with absolute price change under 5%; confirmed by **zero-risk position** (a maker buys and sells within 2% of the same amount the same day) or **circular volume** (99% of daily volume from addresses on both sides). **LPI**: small strategic buys into thin pools that move price far. Rug pulls, pump-and-dumps and delistings. |
| Timing | Daily granularity: intraday order is lost. |
| Evaluation | Descriptive. 82.8% of the 707 tokens with returns over 100% showed at least one indicator. 62.9% of profit-extraction cases were preceded by wash trading or LPI. |
| Limits | Thresholds are heuristics. "High-return" selection is outcome-conditioned (survivor view). Daily bars. |
| Informs | **Sequence matters**: artificial growth tends to come before extraction. Our case files show indicators in time order next to the outcome. **Zero-risk position** at callout horizons is a cheap later indicator on our own trade stream. LPI is exactly what our curve-impact math already measures: on a thin curve, a small buy moves price far. A callout on a thin curve is flagged with its impact at our size, not hidden. |

## 6. The Role of Twitter in Cryptocurrency Pump-and-Dumps (Ardia, Bluteau, arXiv:2306.02148, 2023)

| | |
|---|---|
| Question | Does Twitter promotion change abnormal returns and participant behaviour around known pump-and-dump events? |
| Data | Known pump-and-dump events on centralised exchanges, with tweets about the coins. |
| Unit | Event (coin and pump time). |
| Method | Event study: abnormal returns and volume around the event, split by tweet activity. |
| Finding | Twitter attracts attention before the pump. Participants who rely on Twitter sell late and lose more. |
| Limits | Known events only (selection). Centralised exchanges, not launchpads. |
| Informs | **Exits matter more than entries for followers.** This supports posting every exit as a callout update (docs/09) and publishing follower PnL. It also gives the event-study frame for any later "callout as event" analysis: abnormal multiple versus the feed-wide baseline at the same horizon. |

## 7. Identifying and Analyzing Cryptocurrency Manipulations in Social Media (Mirtaheri et al., arXiv:1902.03110, IEEE TCSS 2021)

| | |
|---|---|
| Question | Can pump-and-dumps be detected as they unfold by combining Twitter and Telegram, and can success be predicted? |
| Data | Telegram pump channels' announcements, cryptocurrency tweets, exchange market data. |
| Unit | Pump attempt. |
| Method | Cross-platform detection and a multimodal success classifier; bot analysis of tweets. |
| Finding | A significant bot presence in tweets during pump attempts. |
| Limits | Detection is anchored on known pump channels. |
| Informs | Engagement counts on callouts (`callout.counts`) are not evidence of organic interest. They are recorded and shown, never used as an indicator of demand. |

## 8. Charting the Landscape of Online Cryptocurrency Manipulation (Nizzoli et al., arXiv:2001.10289, IEEE Access 2020)

| | |
|---|---|
| Question | Across Twitter, Telegram and Discord, how prevalent are pump-and-dump and Ponzi channels, and who promotes them? |
| Data | More than 50M messages from almost 7M users over three months. |
| Unit | Channel and account. |
| Method | Bot detection on Twitter accounts sharing invite links; topic modelling of channel messages. |
| Finding | More than 56% of accounts sharing invite links were bots or suspended; 93% of bot-shared links pointed to pump-and-dump channels. |
| Limits | 2019 to 2020 landscape; bot classifiers have their own error. |
| Informs | Links from callouts to Telegram or X are a known funnel. The X Reader (S2.6) records them as observed links with provenance. It never infers a person from an account. |

## Not read (no PDF)

`Decompose Market Manipulation Strategies` (SSRN 5953738), `RED-REJECT-2026-v1` (SSRN 7129798) and `SOLMEMES` (ACM, 10.1145/3789982.3790023). See `docs/literature/README.md`. Nothing in the plan depends on them.

## Decisions this review led to

| Decision | From | Where |
|---|---|---|
| Every outcome carries a coverage status and a methodology version; ledgers count exclusions by reason | 3 | docs/07 scorekeeper, docs/04 |
| Sources write `system.gap` when they stop; outcomes overlapping a gap are marked, never silently computed | 3 | docs/06, docs/07 |
| Peak multiple is never shown without the net multiple at our order size, after fees, slippage and priority fees | 2, Smurfetc dataset ("a peak is not a payout") | docs/07, docs/11 |
| Hunt indicators are lower bounds with named alternative explanations; text alone is never evidence | 1, 4, 5 | docs/07 hunt |
| A callout links to a mint, never to a ticker; ticker collisions are an indicator | 1, 4 | docs/07 hunt |
| Caller features use only outcomes resolved before the time of use | 2 | docs/07, docs/14 checks |
| Case files order evidence in time and separate observed, computed, AI judgment, indicator and outcome | 1, 5 | docs/07 case files, docs/11 Integrity |
| Engagement counts are not demand | 1, 7 | docs/07 |

## Baselines to reproduce on our data

| Baseline | Source | Status |
|---|---|---|
| Mean multiple after a callout at 1, 3, 5 min, net of costs at 0.02 SOL | ours | Computed by the Scorekeeper on every replay (`callout-case-replay`) |
| Breakeven graduation curve `vSol² / 115²` vs. empirical graduation given progress | 2 | Open: needs `coin.graduated` and longer tapes (S3) |
| Share of callouts on coins with `wash_atomic` or `bundle_buy` | 1 | Computed per replay, reported with coverage |
| Peak-multiple distribution of bonding-curve calls (reached 2x, 3x, 10x) vs. the Smurfetc public record | Smurfetc dataset | Open: needs 30-minute-plus horizons and longer tapes |
| Cross-collector overlap: feed callouts vs. trades observed | 3 | Computed per replay (coins called vs. coins with recorded trades) |
