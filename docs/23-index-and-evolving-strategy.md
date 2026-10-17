# 23 · The Index and the evolving strategy

How Asimog learns who to trust and when to buy, from its own data, and keeps changing its mind as the market changes. This doc pulls together the lessons from our tape, the literature (docs/research/literature-review.md) and nine public datasets (docs/research/datasets/README.md).

No number in this doc is a rule. A market cap level, a holder count or a wallet score cut-off is a **parameter of a strategy**. Strategies evolve (docs/08); the parameters move with them.

## 1. What we learned (the evidence)

| # | Lesson | Evidence |
|---|---|---|
| 1 | Buying after a crowd callout loses | Our tape: 54 of 61 measured callouts lost at 5 min after costs |
| 2 | Callers buy before they call, but most caller buys are not followed by a call | Our tape: author buy a median 57 s before the callout; only 2 of 34 known-caller buys led to their callout within 5 min |
| 3 | A static filter ("buy every coin crossing 6K") loses once the fill is realistic | launchtape: 15% wins with a 5 s delay against a 25% break-even; loopholetape: 12%; Corpus: 3.4% up 2x five minutes after the crossing |
| 4 | Speed decides: 91% of crossers cross in under 30 s | launchtape |
| 5 | More distinct wallets goes with success | Corpus: 13.7% of coins with 33+ wallets in the crossing minute graduate, 2.5% with 0 to 2 |
| 6 | Few coins have many holders early; holder counts alone show no edge | launchtape: median 8 holders at 6K; 8 of 60 won with 20+ holders |
| 7 | Bundle signs are real but noisy on small samples | launchtape (2 h) no stable difference; MELT and Plonk list the features worth measuring |
| 8 | Graduation is usually the top, not the start | MELT: 67.5% of graduates fall below 0.3 within the first hour; slow graduations (over ~30 min) fall less (49%) |
| 9 | Peaks flatter every record | Smurfetc: 34% of calls "reached 2x" at the peak; no exits or costs recorded |
| 10 | Many datasets leak the future | pump-gold's label, ian05012's trade table and wallet tags, MELT's graduation-time features |
| 11 | Filters miss winners too | RED-REJECT: 7.1% of rejected coins still doubled before falling 30% |

**The synthesis.** There is no fixed set of coin numbers that wins. What can win is information others act on later: which wallets are reliably early and right, which callers move the crowd, and what we can still copy after our own delay. So the firm needs its own **Index** of wallets, callers and coins, scored the way we would actually have traded them, and a Strategy Pool that keeps re-weighting it.

## 2. The Index (our own dataset)

A rolling 30-day record, rebuilt continuously, owned by us, stored in Postgres (`idx.*`), and computed only from data we saw (point in time).

### 2.1 Sources

| Source | Gives | Cost and limits |
|---|---|---|
| Scout firehose (`unifiedTradeEvent.lite.>`, 232 trades/s) | Every trade of every wallet from today on | Free; aggregated in memory, flushed each minute as rollups (raw trades of unwatched coins are not kept) |
| Feed Reader callout backfill | Callouts back to 30 days | Paged politely (`INDEX_FEED_PAGES_PER_MIN`), resumable; the platform's rate limits always win |
| `GET /pnl-leaderboard?period=daily|weekly|monthly` | Up to 100 wallets per period that pump.fun lists, with positions | Read as a seed list only (below) |
| `GET /mint-positions/{mint}`, `GET /pnl-leaderboard/top-trader-trades/{mint}`, `swap-api …/trades/batch` | Holders, callers and top traders per coin, including PumpSwap after graduation | Per coin, budgeted, only for coins in the Index |
| RPC pool (docs/15, free tiers with fallback) | A bonded coin's curve history (Backfill), the 20 largest holders, wallet funding and age | Only for candidates and indexed coins, inside the hourly budget |
| NATS lifecycle subjects (`coinLifecycle.prod`, `newCoinCreated.prod`) | Launches and graduations from today on | Free |

Not used: `GET /coins` listings behind a Cloudflare challenge. We never bypass bot checks.

### 2.2 Tables

| Table | One row per | Main fields |
|---|---|---|
| `idx.wallet_coin` | wallet × coin | first buy time and market cap, buys, sells, SOL in and out, tokens left, first-slot buy flag, last trade time |
| `idx.wallet` | wallet | the scores in 2.3, archetype, first seen, last refreshed, evidence counts |
| `idx.coin` | coin | creator, launch time, graduation time, peak, bundle and dev features (section 3), top holders snapshot time |
| `idx.caller` | caller wallet | the caller ledger (`cl1`) over 30 days, plus copy results (2.3) |

### 2.3 Scores: "could we have copied it?"

A wallet's own profit is not our profit: a sniper that buys in the creation slot cannot be copied. Every score is therefore a **copy score**: what a 0.02 SOL trade would have made if we bought at the first trade we could see after their buy plus our measured latency (`FILL_LATENCY_MEDIAN_MS`), and sold when they sold (or at a horizon), through the same fill model as the desk (`mind/fill.ts`).

| Score | Meaning |
|---|---|
| `copy_net` | Median net multiple of copied trades over the window |
| `copy_win_lcb` | Lower 95% bound (Wilson) of the copied win rate: rewards evidence, not luck |
| `early_right` | Share of their buys made before the coin's first 2x and held past it |
| `lead_s` | Median seconds between their buy and the first callout on the coin (negative: they buy after) |
| `n_coins` | Distinct coins traded (the denominator) |
| decay | Each trade weighs `0.5^(age / INDEX_HALF_LIFE_DAYS)`, so recent behaviour counts more |

Archetypes, by rule and listed with the evidence: `sniper` (most buys in the first slots), `bundler` (buys in the creation slot alongside wallets with a shared funder), `dev` (created the coin), `caller` (has callouts), `copier` (usually buys within seconds after one other wallet), `smart` (copy_win_lcb above the population and n_coins at or above `INDEX_MIN_COINS`). Snipers, bundlers and devs are never "smart", whatever their profit.

The pnl-leaderboard is one seed list among others. We do not copy its order and never try to reproduce or influence pump.fun's own rankings or Activity Metric (callout terms 7.1(f)); our scores are our own measurement of trades.

**How live and replay stay equal.** Rollups are too big for the Tape, so they live in `idx.*`. Everything a decision reads crosses the Tape: launch features ride on `coin.watched`, holder snapshots on `holders.snapshot`, and each score version's smart wallets on `index.refreshed`. A replay of a recorded tape therefore makes the same decisions with no `idx.*` tables at all.

### 2.4 Refresh and point-in-time

- Rollups stream in every minute; scores are recomputed every `INDEX_REFRESH_MIN` (default 60) and written as a new version, never overwritten in place.
- A strategy at time t reads the latest score version computed from data seen before t. Replays read versions the same way, so no score leaks the future.
- Each refresh writes `index.refreshed` (version, counts, window) to the Tape.

## 3. Rugs and bundles

Measured per coin from its first trades (the Scout sees every trade with its slot), carried on `coin.watched` as launch features, confirmed for candidates by an RPC holder snapshot (`holders.snapshot`), and written as one signal, `risk.state`, with one field per row below.

| Signal | Computed from | Source of the idea |
|---|---|---|
| `bundle_share`, `bundle_wallets` | Wallets (creator excluded) that bought in the creation slot or the next 2, and the share of the whole supply they still hold, measured only for coins seen from birth; how many of those wallets share a funder (RPC, candidates only) | Plonk, MELT |
| `fresh_share` | Share of early buyers our Index has never seen trade, and (RPC) wallets funded in the last 24 h | Pump Guard, MELT |
| `creator_sold` | Creator's share now, creator sells so far, creator's past coins in the Index and how they ended | MELT, Chrisymcsoup (creator history) |
| `top10_share` | Top-10 share of the whole supply excluding the bonding curve and the AMM pool (RPC `getTokenLargestAccounts`) | Big Fish Alert, ours (the curve holds ~80% at launch) |
| `sniper_share` | Share of supply bought by `sniper` wallets | MELT |

Two layers:

1. **Floor (owner's limits).** The Risk Gate refuses buys above the owner's limits: `max_bundle_share`, `max_top10_share`, `dev_sold` and `max_fresh_share`. They live in `mind.limits` with the other limits; code and evolution never change them.
2. **Taste (evolving).** Strategies may be stricter: `risk.state` fields are DSL inputs, and evolution moves their thresholds and weights.

## 4. The evolving strategy

There is no single strategy. The Strategy Pool (docs/08) holds many, each trades its own paper book, and the kernel gives capital only to those whose results after costs clear a skeptical bar in two separate windows. This doc adds what they can see and what may evolve.

- **Every threshold evolves.** Mutation now nudges universe thresholds too (for example `curve.progress.mcap_usd >= 6000` can drift to 4,200 or 11,000), within validator bounds. "6K" is just where the seeds start.
- **New inputs:** `wallets.smart_buying` (smart wallets that bought this coin in the last minutes, weighted by copy score, with their usual lead before callouts), `risk.state`, `flow.state`, `precall.callout_p`, caller signals.
- **New seed family `smart_early`:** universe: no risk floor breached, `wallets.smart_buying` exists; score: smart-wallet weight, flow, low concentration; exits as `pre_call`. It buys what reliable, copyable wallets buy, before the callout wave.
- **Honest scoring stays:** fitness is the lower bound of net results after costs; markouts first; strategies that only win on peaks die.
- **Regime changes:** the Index decays old behaviour (half-life), and strategies are judged on recent windows, so a wallet or a pattern that stops working loses weight within days, not months.

## 5. Callouts: ours and comments on bad ones

- **Our callouts.** Unchanged in principle (docs/09): buy first, disclose, thesis committed before posting. The thesis now cites Index evidence as data ("3 wallets with strong copy records bought in the last 2 min"), never names.
- **Comments on bad callouts are data replies.** AGENTS.md allows replies that state data only, and no post may call out a person. When a callout's coin breaches the risk floor, Publisher drafts a data reply such as: "Data: 41% of supply bought in the first 3 slots. Top 10 hold 63% excluding the curve. Creator sold 30%." Rules from docs/09 apply: an integrity finding at 0.85 confidence or more with 3 or more evidence events, Guard on the text, no handles, wallets or verdict words. Paper until S6.3, like our callouts.
- **Scoring both.** House callouts are scored as the caller `house`. Data replies are scored too: was the flagged coin down 50% or more within 24 h? A reply rule that is often wrong is retired.

## 6. Ways it fails

1. Survivorship: the Index starts from today's firehose and backfills only what sources allow. Coverage is reported (`ctl coverage`), and scores show their denominators.
2. Copy scores flatter wallets whose edge was speed. Latency is part of the copy fill, and snipers are excluded from `smart`.
3. Wallet rotation: a smart trader moves to new wallets. Funder links (RPC) can join wallets; until then the old wallet simply decays.
4. Being copied: if others copy the same wallets, the edge shrinks. Copy scores are measured on recent trades, so this shows as decay.
5. Rate limits and costs: every external read has a budget; the Index degrades to the firehose alone, never to guessing.
6. Bad data replies harm innocent coins or people. Data only, high thresholds, scored afterwards, paper first, owner sees the queue.
7. Lookahead in our own Index: scores are versioned; strategies read only versions computed before their decision; replays check it (`no_lookahead`).
