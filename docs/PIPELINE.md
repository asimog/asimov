# Pipeline

How the world becomes events, and events become signals: the senses, the filters at the door, the Index, the System One analyzers, Jev and the Scorekeeper. Target design; gaps are rows in `PLAN.md`. Every analyzer section ends with its ways it fails, written before its code.

## 1. Filter at the door

Reading is cheap; writing is what costs space. Every sense reads everything it can see in memory and writes to the Tape only what passes the owner's filters. Rejected items are counted, and `FILTER_SAMPLE_PCT` (default 1%) of them are written as `filter.sampled` so a bad filter is visible. Filters live in `config/feeds.json` and `config/filters.json`; each load writes `config.loaded` with the file hash, so a replay knows which filters were active.

| Filter set | Fields (all configurable) |
|---|---|
| Feed | sources (`recent`, `hot`, `follow`; `trending` and `top_traders` only after we record their endpoints), every chain read and the stored chains chosen in config (`solana` now; `base`, `robinhood`, `ethereum` and `hyperevm` also seen, `docs/research/pumpfun-endpoints.md`), a callout with no chain decided by `unknown_chain`, minimum position in USD (default 10), market cap at call range |
| Launch | dev buy range, block-0 sniper share, bundle share, blocklists (`blocked_creators`, `blocked_wallets`, `blocked_mints`), and `on_unknown` per watch reason |
| Watch | `WATCH_MAX_COINS`, `WATCH_HOURS`, the Scout floors |

## 2. Senses

All senses write the Tape and nothing else. None decides anything.

### Feed Reader

Reads the callout feed JSON the web client reads, for each configured source. `recent` is `/home-feed/new`; `hot` is the ranked `/home-feed`; `follow` is the NATS `followingFeed` push, kept to the wallets on the owner's `follow_wallets` list. A list load notifies `lists` and the reader reloads it in place. Each HTTP source keeps its own cursor in `tape.feed_cursors` (`recent`, `hot`), so a restart resumes that source: the startup walk stops at the newest callout already read, and the history walk resumes from its saved page or stays done. The door runs before any write; a refused callout is counted by reason and chain and a hash sample is written as `filter.sampled`. A bot challenge (403) or a 429 skips that source for that poll, is counted with its status, and is tried again on the next poll; nothing gets around the check.
- Dedupe by callout and update id. Changed counts write `callout.counts` with a dedupe key.
- When page 1 is all new, it walks older pages until it meets a known callout; if it runs out, it writes `system.gap` (source `feed`).
- One honest user agent naming the firm. Backoff per path prefix; `Retry-After` honoured, including date values.
- Callouts from the 30-day history backfill arrive with `via: history`: they feed the Index and are never traded.
- A callout first seen on the push channel carries no handle; the ledger and case files show the newest handle that wallet has had.

Ways it fails: the endpoint changes shape (schema check, `system.schema_drift`, adapter stops); a bot challenge (stop, alert, never bypass); silent cursor skips (gap walk); duplicate floods after reconnect (dedupe); clock skew (store both times, never sort by platform time across sources); deleted callouts (marked, never removed).

### Reply Reader and media cache

Reads the reply thread of each watched callout and caches callout media and coin images (no redirects followed). Replies feed the rug feed, the `slow.*` views and Jev `reply` and `exit` packs. We never reply under a coin we do not hold.

### Chain Reader

Records every trade of watched coins from pump.fun NATS as `trade.curve` or `trade.amm`, one dedupe key per trade for every sense. The flow analyzer writes `coin.graduated` on a coin's first AMM trade after curve trades the chain reported, so every replay re-derives it; a coin first seen on the AMM graduated before we watched and gets none. Money paths read our RPC and confirmed transactions only; NATS feeds signals only.

Ways it fails: NATS disconnects (`system.gap` on reconnect; Backfill re-reads); NATS and RPC disagree (RPC wins, `system.source_disagree`); reorgs (fills count at `confirmed`, books at `finalized`).

### Scout

Reads the whole trade firehose (about 232 trades/s) in memory. The firehose does not say which program a trade ran on, so the trigger trade the Scout writes has `program: null` and an unknown phase; readers that depend on the phase (graduation, the fill model) require a program. It folds every trade into Index rollups and promotes a coin into the watched set (`coin.watched` with a reason) when:

| Reason | Rule |
|---|---|
| `caller_buy` | A known caller wallet (or one on `caller_wallets`) buys a coin not yet watched |
| `smart_buy` | A wallet in the current Index smart set buys |
| `follow` | A wallet on `follow_wallets` buys; a load of the list applies at once through the `lists` notify. A followed wallet the Index marks sniper, bundler or dev keeps the role and its `coin.watched` carries a note, so the owner can prune the list. Until the Index has its own trades the wallet has no score |
| `heat` | At least `SCOUT_HEAT_BUYERS` unique buyers and `SCOUT_HEAT_NET_SOL` net SOL in 60 s |
| `metrics` | The launch passes the launch filters and the scan floor (`SCOUT_MIN_MCAP_USD`, `SCOUT_MIN_BUYERS`) |

The floors only decide what we record in full. Strategies keep and evolve their own thresholds. Each promotion carries the coin's launch features. Memory stays bounded: callers and smart wallets are persisted in `idx.scout_wallet`, memory keeps at most `SCOUT_HOT_WALLETS` of them (least recently used out, reloaded from the table on start and on each refresh), a wallet not in memory is looked up in the table in small batches, and idle coin windows are dropped.

Before `coin.watched`, the launch facts are checked: dev buy, block-0 sniper share, bundle share, and the creator, mint and trigger wallet against the owner lists. NATS answers first; the RPC pool answers what NATS does not carry (the creation transaction on the curve PDA), and the pump.fun coin lookup is the last resort. A fact no source answered is `unknown`, and `config/filters.json` `launch.on_unknown` decides it per watch reason. A refused launch is counted and sampled as `filter.sampled`. After promotion, Backfill's own read of the first transactions is compared with the NATS facts; a disagreement writes `system.source_disagree`, RPC wins, the filter runs again, and a coin that now fails leaves the watched set with `coin.unwatched` and a `system.note`.

Ways it fails: the firehose drops (`system.note`, kind `scout_gap`); a caller buys from a second wallet (missed until `caller_wallets` or funder links join it); heat floods the watched set (cap, oldest leave with `system.gap`).

### Backfill

When a coin enters the watched set, reads its past trades from RPC. It first checks our own rollups so data we have is never fetched twice, then fans requests out across every healthy provider in parallel, each inside its own rate and monthly budget, with fallback when one fails. Backfilled trades carry `event_time` from the chain; their `seen_time` is when we fetched them.

Ways it fails: rate limits (rest that provider, keep the queue; over budget, `system.gap` source `rpc`); null transaction (retry once, then skip); truncated logs (counted, never guessed).

### X Reader

Read-only lookups of posts linked from callouts, as metered jobs. Never posts.

## 3. The Index

Asimog's own dataset of who to trust: a rolling 30-day record with a 7-day half-life, computed only from data we saw, stored in `idx.*`.

| Layer | One row per | Refresh |
|---|---|---|
| Rollups | wallet x coin x hour (buys, sells, SOL in and out, first buy time and market cap, first-slot flag) | Every minute, from the Scout |
| Wallet scores | wallet | Hourly, versioned |
| Coin and creator records | coin, creator | Hourly |
| Leaderboards | top wallets, top traders, top callers, top callouts, top creators | Hourly |
| Light rebuild | scores and leaderboards recomputed from rollups | Every 12 h |
| Full rebuild | every score from compacted rollups, archives if needed | Every 48 h |
| Deeper refresh | 30-day callout backfill, leaderboard seed lists, owner lists and owner updates | Weekly; every weekly version kept |

The Index reads only its rollups, never raw trades, so it survives Tape pruning. The copy price and the horizon mark are set by the first trade after their due time, even when a flush came between; `idx.coin` counters add deltas, and a restart restores the live coins' creator and what the creator sold. A full rebuild can replay archive files.

**Copy scores.** A wallet's profit is not ours. Every score asks what a `OUTCOME_REF_SOL` trade would have made if we bought at the first trade after their buy plus our latency and sold when they sold, through the desk's fill model.

| Score | Means |
|---|---|
| `copy_net` | Weighted geometric mean of the net multiple of copied trades. Value is marked at a fixed horizon (`INDEX_MIN_AGE_MIN` after their first buy), not at the coin's last trade |
| `copy_win_lcb` | Lower 95% Wilson bound of the copied win rate |
| `early_right` | Share of their buys made before the coin's first 2x, using only the peak after their first buy, never an earlier one |
| `lead_s` | Median seconds from their buy to the first callout |
| `hold_med_s` | Median hold time |
| `n_coins` | Distinct coins traded |

Archetypes by rule: `sniper`, `bundler`, `dev`, `caller`, `copier`, `smart`. Snipers, bundlers and devs are never smart. Each refresh writes `index.refreshed` with its version and the smart set, so replays decide the same way without `idx.*` tables.

The pump.fun leaderboard is one seed list. We never copy its order and never model or game pump.fun's rankings or Activity Metric.

Ways it fails: survivorship (coverage reported, denominators shown); speed edges (latency in the copy fill, snipers excluded); wallet rotation (funder links, decay); being copied (recent windows); lookahead (versioned scores).

## 4. Rugs and bundles

One signal, `risk.state`, recomputed on every holder snapshot. The snapshot carries the Index's launch features as of that moment, so the bundle, fresh and sniper shares move with it instead of freezing at promotion.

| Field | From |
|---|---|
| `bundle_share`, `bundle_wallets` | Wallets buying in the creation slot or the next two, and the supply they still hold (coins seen from birth); shared funders |
| `creator_sold` | Creator's share sold, creator's past coins and how they ended |
| `top10_share` | Top-10 share excluding the curve and the AMM pool |
| `sniper_share` | Supply bought by `sniper` wallets |
| `creator_launches_7d` | Coins the creator launched in 7 days (mass deployer) |

Two layers: the owner's floor in limits (the Risk Gate refuses), and each strategy's own stricter taste (evolves). A coin with no `risk.state` is refused.

## 5. System One analyzers

All run at once; none waits for another. Signal kinds and fields are in `docs/generated/signals.md`.

| Analyzer | Emits | Idea |
|---|---|---|
| age | `age.opportunity` | Minutes since the first callout and the price move since |
| echo | `echo.score` | How much a callout is explained by an earlier one (follow habit, text similarity, reposts) |
| hawkes | `hawkes.*` | Callout arrivals as a self-exciting process; wave chance in the next minutes |
| callers | `callers.wave_p`, `caller.dna` | Population model of who calls next; each caller's measured record, from outcomes seen by now |
| curve | `curve.progress`, quotes | Curve math from the protocol SDK; the price of a predicted inflow |
| flow | `flow.state` | 60-second buys, sells, buyers, net SOL, acceleration, top-buyer share, heat |
| precall | `precall.callout_p`, `precall.detected` | Chance a caller who bought will call, from their own record (Beta posterior shrunk to the population) |
| index | `risk.state`, `wallets.smart_buying` | From the Index |
| regime | `regime.state`, `regime.tremor` | HMM regimes and change points (Python, PLANNED) |
| hunt | indicators | `wash_atomic`, `bundle_buy`, `author_trades`, `ticker_collision`, `thin_curve`, each with other explanations |

Engagement counts are never evidence of demand; they are the cheapest numbers to fake.

Ways they fail, in short: thin samples (fall back to population rates, low confidence); coordinated bursts (echo-weighted counts); refits drifting (versioned models, scored by Brier); lookahead (inputs must have `seen_time` before `produced_at`, checked on every replay).

## 6. Jev, the reflex

Jev answers typed questions about a small state in about 150 ms with calibrated probabilities and a separate confidence. Numbers are computed in code and passed as named buckets. Untrusted text sits in a named field. Every request and answer is recorded as `jev.answer`, so replays never call Jev.

| Pack | Trigger | Asks |
|---|---|---|
| `callout` | Each callout | Which mint is called, call kind, thesis quality, promotion language, injection attempt |
| `coin` | Board change on a watched coin | Narrative, clone of a recent coin, organic or coordinated, mood |
| `callers` | Coin heating up | One yes/no per likely caller: will they call within the horizon |
| `exit`, `reply` | New replies on a held coin | Rug or dev-dump reports, narrative cooling |
| `guard` | Every text entering an LLM and every outbound post | Injection, names a person, promises returns, missing disclosure |
| `verify` | Each slow-mind claim | Does the cited text support it |

Routing: confidence at or above 0.7 counts fully, 0.5 to 0.7 at half weight, below 0.5 is `uncertain` and may escalate. Big orders ask twice with options shuffled. Budget `JEV_*`; on cap, packs fall back to math signals.

## 7. Scorekeeper

Every callout and every house callout opens a watch. At each horizon in `OUTCOME_HORIZONS_MIN` (1, 3, 5) it writes `outcome.measured` (method `ov2`) from trades on the Tape, after the horizon has passed:

- entry: the last trade at or before `t0` (within `ENTRY_STALE_S`), else the first after.
- `net_multiple` through the desk's fill model at `OUTCOME_REF_SOL`. The peak is a ceiling, never shown without the net.
- `coverage`: `ok`, `no_entry`, `no_trades` or `gap`. Gap outcomes are not scored.
- A late gap writes a new outcome that supersedes the old one; the old stays on the Tape.

Probability signals are scored with Brier and skill against the base rate, in day buckets (`mind.score_days`) over a trailing `SCORE_WINDOW_DAYS`; every reader sums the window as of its own now (`scoresAsOf`). The pre-call score takes one sample per coin and buying caller, from `precall.detected`, and counts a hit only when that same caller calls the coin within the horizon.

## 8. Caller ledger, case files, coverage

- **Caller ledger** (`ctl callers [--h 5] [--at <iso>]`, method `cl1`): one row per caller plus an all-callers baseline, every number with its denominator, losing calls always in, exclusions counted by reason (`repeat`, `quote`, `history`, coverage). Callers are listed, never ranked.
- **Case file** (`ctl case <id>`): everything known about one callout in six sections that never mix: observed, statistics, AI judgments, indicators, unresolved, outcomes and corrections. Byte-identical from the same Tape. Never says "scam".
- **Coverage** (`ctl coverage`): gaps per source, coins called against coins with trades, outcomes per coverage status, callouts announced by the author's buy.

## 9. The wiki

A public, cited page per caller, wallet, creator, coin and narrative: style, strategies, hold times, records, and summaries of pruned windows. Code writes every number from the Index and the ledger; the Wiki writer agent writes the prose, labelled AI judgment and passed through the public-text check. Pages are versioned rows in Postgres with a markdown export, read as of now. A page never feeds an order. Pages are exported to the configured wiki target (a bucket or a GitHub docs repository).

## 10. Embeddings

The agent runtime turns text into vectors with an OpenRouter embedding model (`EMBEDDING_MODEL`, key `EMBEDDING_API_KEY`), so agents can find similar text without reading everything. Vectors live in the same Postgres with the pgvector extension, each row tagged with its model and `seen_at`, and searched as of now.

| Text | Used for |
|---|---|
| Callout text | Copies and echoes across callers; narrative clusters for the `coin` pack and BettaFish |
| Scraped replies | Rug and dev-dump reports for the rug feed and the `exit` pack |
| Wiki pages, slow reports | Retrieval for BettaFish, MiroShark and the thinking agents; search on the site |

Numbers are never embedded; they stay in SQL. A similarity is evidence with a confidence, never an order. Embedding spend is metered per lane like any model call. Changing the model means re-embedding, so the model id is stored with every vector.
