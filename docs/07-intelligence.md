# 07 · Intelligence: the analyzers

Analyzers read the Tape and Memory and write Signals to the Board. They all run at the same time. None waits for another. Kinds and fields are in `04-contracts.md`.

| Analyzer | Lang | Cost | Cadence | Emits |
|---|---|---|---|---|
| age | TS | cheap | per callout | `age.opportunity` |
| echo | TS | cheap | per callout, ring clustering nightly (Py) | `echo.score`, `echo.ring` |
| hawkes | TS | cheap | per callout | `hawkes.intensity`, `hawkes.branching`, `hawkes.wave_p` |
| regime | Py | cheap | per 1-minute bar | `regime.state`, `regime.tremor` |
| curve | TS | cheap | per trade (throttled 1 s per coin) | `curve.quote`, `curve.progress` |
| shadows | TS eval, Py fit | cheap | per callout and per regime change | `callers.call_p`, `caller.dna` |
| reflex (Jev packs) | TS | reflex | per trigger (docs/17) | `jev.*` (fast twins of synthesis and swarm signals) |
| bettafish | Py | metered (System Two) | feed run on a timer; coin runs on escalation | `synthesis.feed`, `synthesis.coin`, `mood.feed` |
| miroshark | Py | metered (System Two) | escalation only | `swarm.wave_p`, `swarm.impact` |
| hunt | TS | cheap | per callout and per echo ring update | `integrity.finding` |
| baseline | Py | cheap | every 15 min | `baseline.attention` |
| fly | Py | cheap | every minute for watched coins | `fly.action` |

Each section ends with **Ways it fails**, written before the code (AGENTS.md rule).

## age

Opportunity age of a callout: minutes since the first callout on that coin, and the percent price move from the first callout (or from coin creation, if this is the first) to this callout. Also the coin's age.

Ways it fails: missing price at call time (use nearest trade within 30 s, else mark unknown); coin created before our tape starts (use `coins-v2` creation time, mark `estimated`).

## echo

For a callout `c` by caller `a` on coin `m` at time `t`, look at earlier callouts on `m` in the previous 10 minutes (`ECHO_WINDOW_MIN`). For each earlier caller `b`:

```
follow_ab = share of a's past calls that came within 30 min after b called the same coin (shrunk toward the global rate with a Beta prior)
text_sim  = MinHash Jaccard of normalized text (5-character shingles)
edge      = 1 if a reposted or quoted b's callout
echo(c)   = max over b of: 1 − (1 − follow_ab)·(1 − text_sim)·(1 − edge)
```

Nightly (Python): build the same-origin graph from edges above 0.6 and cluster it (Louvain). Clusters with 3 or more callers become `echo.ring` signals.

Ways it fails: a new caller has no history (prior dominates, confidence low); legitimately fast followers look like echoes (hunt requires a ring plus repeated timing, never one event); text templates shared by a whole community (ignore shingles seen in more than 5% of all callouts).

## hawkes

Callout arrivals per coin as a self-exciting process with an exponential kernel:

```
λ(t) = μ + Σ_i  α · q_i · β · e^(−β (t − t_i))
```

- `q_i` is the caller weight (from `caller.dna`, normalized to mean 1).
- `μ, α, β` are fitted nightly by maximum likelihood across all coins (Python, scipy). Per-coin values are shrunk toward the global fit.
- Branching ratio `n = α · mean(q)`. Under 1 the cascade dies out; near or above 1 it explodes.
- `hawkes.wave_p`: 300 Monte Carlo forward paths (Ogata thinning) over `WAVE_HORIZON_MIN` = 5 minutes, P(at least 3 new callouts). Until the nightly fit exists, defaults are μ = 0.01/min, α = 0.6, β = 1/3 per min (a 3 minute memory). Runs in under 5 ms in TS.

Ways it fails: very few callouts per coin (use the global fit, low confidence); a coordinated burst looks like excitation (echo-weighted counts are used for the wave count: echoes count 0.2); fit drifts as the platform changes rules (nightly refit, scorer watches Brier score).

## regime

A 6-state Gaussian HMM (hmmlearn) on standardized 1-minute bar features: callouts, distinct callers, quality-weighted calls, echo ratio, net SOL flow, unique buyers, top-10 share change, curve progress, return.

- Fit nightly on the last 14 days of watched coins.
- States get names by fixed rules on their mean features (for example the state with the highest callouts and positive flow is `wave`; the state with negative flow and high early-wallet selling is `distribution`). The rule table lives with the code, so names stay stable across refits.
- Online: forward filter each minute; emit the posterior.
- **Tremor**: Bayesian online change-point detection (BOCPD) on net flow and price runs next to the HMM. A change point with probability ≥ 0.8 emits `regime.tremor`. Stops in strategies use it.
- Later: move to a hidden semi-Markov model if state durations matter in scores.

Ways it fails: label switching after refit (the naming rules fix this; a refit that cannot assign all 6 names is rejected and the old model stays); a coin with too few bars (posterior stays near the prior, low confidence); feature scaling drift (scalers are fitted with the model and versioned together).

## curve

Uses `@pump-fun/pump-sdk` directly: `getBuyTokenAmountFromSolAmount`, `getSellSolAmountFromTokenAmount`, `bondingCurveMarketCap`, `computeFeesBps` on live `curve.state`. After graduation it uses `@pump-fun/pump-swap-sdk` pool math. Quotes are made at sizes 0.1, 0.5, 1, 2 and 5 SOL, and for the full position on sells.

This analyzer also turns a predicted inflow into a price: "if the wave brings X SOL of net buys, our tokens are worth Y". That links forecasts to money.

Ways it fails: stale curve state (`valid_until` 30 s; the Risk Gate rejects orders on stale quotes); fee schedule changes (fees come from the SDK's fee functions, never hard-coded); quote-mint variants (the SDK handles non-SOL quote curves; v1 trades SOL-quoted coins only).

## flow

`flow.state` (subject: coin), on every batch of trades on a watched coin, from the Tape only (`seen_time` at or before now):

| Field | Meaning |
|---|---|
| `buys_60s`, `sells_60s` | Trades in the last 60 s |
| `buyers_60s` | Unique buying wallets in the last 60 s |
| `net_sol_60s` | SOL bought minus SOL sold in the last 60 s |
| `accel` | Trades in the last 60 s / (trades in the 60 s before + 1) |
| `top_share` | The largest single buyer's share of buy SOL in the last 60 s (concentration) |
| `callers_buying` | Known caller wallets that bought in the last `PRECALL_HORIZON_MIN` |
| `heat` | [0, 1]: `min(1, buyers_60s / 20) × min(1, max(0, net_sol_60s) / 5)` |

Ways it fails: a coin with one large buyer looks hot (read `top_share`); trades from a gap are missing (coverage applies); a bot cluster inflates `buyers_60s` (hunt `bundle_buy` in case files).

## precall

The callout is a scheduled event that the caller announces with their own buy (docs/research/pre-call-evidence.md). `precall.callout_p` (subject: coin) is written when a known caller buys a coin they have not called in the last `PRECALL_HORIZON_MIN` (default 5):

- **Per caller.** From our own record, seen before now: `buys` = the caller's buys on watched coins, `called` = how many of those were followed by their callout within the horizon (only buys whose horizon has passed count). Posterior mean of Beta(`a0 + called`, `b0 + buys − called`), where the prior is the population rate over all known callers with strength `PRECALL_PRIOR_N` (default 4), and `a0`, `b0` come from that rate.
- **Over callers.** `p` = 1 − Π(1 − p_i) over the known callers who bought in the window and have not called it: the chance that at least one of them calls within the horizon.
- Also carries `caller` (the most likely one), `buy_sol`, `lag_med_s` (their median buy-to-callout lag), `med_peak` (median `peak_multiple` at 3 min of their resolved callouts with coverage `ok`, or null), `p_peak` (share of those peaks at or above 1.2), `n_buys`, `n_called`, `pop_rate`, `callers_buying`.
- Valid for the horizon. Written again on every new known-caller buy on the coin.

The Scorekeeper scores `precall.callout_p` with Brier: hit = any `callout.created` on the coin within the horizon after the signal.

Ways it fails:

1. A caller buys many coins and calls few. Their Beta posterior falls toward their own rate; with no record it is the population rate, never a guess.
2. The caller already called the coin before our watch began. The signal skips callers with a callout on the coin in `mem.callouts`; earlier calls outside memory are missed.
3. The callout is from a different caller than the buyer. Still a hit for `p` (any callout), not for the named `caller`.
4. Lookahead. `called` counts only buys whose horizon ended before now, and callouts seen before now.

## shadows

Three tiers.

**Tier 1, statistical Caller model (`callers.wave_p`, live in `analyzers/cheap.ts`).** P(at least `WAVE_N` = 3 new callers on coin `m` within `WAVE_HORIZON_MIN` = 5 min):

- **Population first.** On the first tape, 352 distinct wallets made 381 callouts: most callers are new, so a model over known callers alone predicts nothing. Callouts arrive at the measured rate λ (last 30 min, all coins). Coin `m` gets a share by preferential attachment: (its callouts in the last hour + 1) / Σ over recent coins of (callouts + 1). Expected new callouts μ = λ × H × share.
- **Known callers** (up to `CALLERS_ACTIVE_MAX`): each gets p = 1 − exp(−rate × H × share) × affinity (1 + how often they followed callers already on `m`). Their Poisson-binomial is convolved with Poisson(μ − Σp) for the callers we cannot name.
- `caller.dna` per wallet: calls seen, median opportunity age and pre-move, average max multiple, hit rate at 2×, followers.
- Later (nightly Python fit): logistic regression per caller shrunk to a global model, with regime, mcap band, coin age, hour, echo ring and cooldown features.
- First Scorekeeper result (10 min tape, 172 callouts): Brier 0.418 against base rate 0.43, so no skill yet. Hawkes on the same tape: Brier 0.155, skill 0.37. Strategies weight both; evolution moves the weights.

**Tier 2, Jev Caller model.** The `callers` pack asks one Noul per candidate caller (top 40) in a single 150 ms request, with each caller's DNA written in words. Code combines it with Tier 1 into `jev.wave_p` (docs/17).

**Tier 3, swarm Caller model (MiroShark).** Only when the escalation gate fires. See below.

`caller.dna` per caller: median lead time vs other callers, median opportunity age, hit rate (price up at 2 h), follower PnL (a follower buying 30 s after the call, selling at the caller's own exit or at 6 h), call frequency, sample size.

Ways it fails: tracked-caller list too small (start with all callers seen in 48 h of backfill, then keep anyone with 5 or more calls); survivorship (callers who stop posting stay in the dataset); leakage (features use only events with `seen_time` before the prediction time; replay tests check this).

## bettafish: synthesis of the callout feed

**Built (2026-10-18, docs/24).** The full BettaFish engine is vendored in `services/bettafish/engine` and runs through `asimog_worker.py`, driven by the Slow Bridge. The patch set below is applied as adapters (PumpfunDB, AsimogNewsAgency, AsimogMediaSearch, the forum host, report templates, voice rules); docs/24 section 7 lists each patch with its test.

BettaFish runs as-is, with a patch set on our fork (`services/bettafish`, branch `agent`). It does not crawl: the agent is its crawler.

### Patch set

| # | File | Change |
|---|---|---|
| 1 | `InsightEngine/tools/search.py` | Add `pumpfun_callout` and `pumpfun_callout_comment` to the platform table list with a hotness formula: `likes·W_LIKE + replies·W_COMMENT + reposts·W_SHARE + quotes·W_SHARE + quality·W_QUALITY`, time column `create_time`. Use the Postgres dialect paths. |
| 2 | `config.py`, `.env` | DB = our Postgres, schema `bettafish` (views over `mem`, docs/05). LLM base URL = our gateway. |
| 3 | `MediaEngine` | Point it at callout media and coin images (our object storage URLs). |
| 4 | `QueryEngine` | Searches X and web for tickers, contract addresses and narratives from the current feed. |
| 5 | `ReportEngine/report_template/` | New template "Callout Feed Synthesis". Its JSON IR has fixed sections: narratives, coin stances, mood, suspicious patterns, each claim with cited callout ids. |
| 6 | Forum mirror (new file) | Tail `logs/forum.log`; emit each line as `synthesis.forum_line` (agent, text, cited ids) so `/synthesis` shows the live debate. |
| 7 | `SentimentAnalysisModel` | Run the multilingual sentiment model on callout text and replies; feeds `mood.feed`. |

### Runs

- **Feed run** on a timer (`BETTAFISH_FEED_EVERY_MIN`, default 30): Insight + host over the last window of callouts. Output `synthesis.feed` and `mood.feed`.
- **Coin run** on escalation (docs/17): engines and forum rounds per the preset. Output `synthesis.coin`.
- Between runs, the Jev `coin` pack gives the fast twins (narrative, stance, mood) on every Board change.
- The IR is parsed by `core` into signals. Every claim goes through the Jev `verify` pack against its cited callout; unsupported claims are dropped.

### BettaFish knobs (env, all live-tunable)

| Variable | nano | lite (default) | full |
|---|---|---|---|
| `BETTAFISH_PRESET` | nano | lite | full |
| `BETTAFISH_ENGINES` | insight | insight,query | insight,query,media |
| `BETTAFISH_FORUM_ROUNDS` | 0 | 2 | 4 |
| `BETTAFISH_HOST_EVERY_N` (agent speeches per host speech) | off | 5 | 5 |
| `BETTAFISH_REPORT` | signals only (no HTML report) | short template | full template |
| `BETTAFISH_FEED_EVERY_MIN` | 60 | 30 | 15 |
| `BETTAFISH_MODEL` | from `LLM_MODEL_CHEAP` | `LLM_MODEL_CHEAP` | `LLM_MODEL_CHEAP`, host on `LLM_MODEL_SMART` |
| Approx cost per coin run (DeepSeek v4.1 Flash) | under $0.005 | about $0.02 | about $0.08 |

Ways it fails: LLM invents a callout (dropped by the citation check); forum log format changes upstream (the mirror validates line shape and alerts); run takes longer than its slot (the next run is skipped, never queued twice); a non-English feed (the sentiment model is multilingual; the host prompt asks for English output).

## miroshark: swarm simulation

**Built (2026-10-18, docs/24).** The full MiroShark engine is vendored in `services/miroshark/engine`; the module below exists as `backend/wonderwall/simulations/pumpfun/`, run by `backend/asimog_worker.py` through the Slow Bridge. Graph memory, the report agent and the Twitter co-platform are still open (docs/24 P6).

New module in our fork: `backend/wonderwall/simulations/pumpfun/`, built on the same base classes as `simulations/polymarket` (`BasePlatform`, `BaseAction`, `BaseEnvironment`, `BasePromptBuilder`).

| File | Content |
|---|---|
| `platform.py` | `PumpfunPlatform`: tables for coins, curve state, callouts, updates, replies, follows, trades, positions. |
| `actions.py` | `browse_callout_feed`, `view_coin`, `post_callout` (requires holding), `update_callout`, `reply`, `buy`, `sell`, `follow_caller`, `do_nothing`. |
| `amm.py` | Pump bonding-curve math, ported from `@pump-fun/pump-sdk`. A golden test compares 1,000 quotes against the TS SDK. |
| `environment.py` | `to_text_prompt`: the feed and coin page as the agent sees them. |
| `prompts.py` | Personas. Callers from `caller.dna` plus samples of their real callout text (style). Followers from archetypes: sniper, bundler, degen follower, diamond hand, paper hand, exit farmer. |

### A swarm run

1. Seed: the coin dossier (curve state, recent callouts, `synthesis.coin`, top Caller models' `callers.call_p`).
2. Agents: the top `SWARM_CALLER_AGENTS` Caller model callers likely to touch this coin (ranked by Tier 1 and the Jev `callers` pack), plus `SWARM_FOLLOWER_AGENTS` followers by archetype mix from wallet stats.
3. Rounds: `SWARM_ROUNDS` rounds of `SWARM_ROUND_MINUTES` simulated minutes (about 2 h in every preset).
4. Branch A: no agent. Branch B (when `SWARM_BRANCHES` includes B): Director Mode injects "Asimog posts a callout now" with our thesis text and size.
5. Output: `swarm.wave_p` (share of runs reaching 5 or more distinct tracked callers), `swarm.impact` (B minus A expected callers and net SOL inflow), and every simulated post as a `swarm.post` event, labeled simulated, for `/simulations`.

Budget: escalations only, ranked by Attention, within `SWARM_RUNS_PER_HOUR`. Results are valid for 30 minutes.

### MiroShark knobs (env, all live-tunable)

The service stays fully deployed. Presets and every step count are variables, so cost can be turned down to almost nothing without code changes.

| Variable | nano | lite (default) | full |
|---|---|---|---|
| `SWARM_PRESET` | nano | lite | full |
| `SWARM_CALLER_AGENTS` | 12 | 30 | 40 |
| `SWARM_FOLLOWER_AGENTS` | 12 | 30 | 150 |
| `SWARM_ROUNDS` | 4 | 6 | 12 |
| `SWARM_ROUND_MINUTES` (simulated) | 30 | 20 | 10 |
| `SWARM_BRANCHES` | A | A,B | A,B |
| `SWARM_MAX_TOKENS_PER_TURN` | 120 | 160 | 240 |
| `SWARM_GRAPH_FEATURES` (MiroShark graph-memory flags) | off | minimal | all |
| `SWARM_RUNS_PER_HOUR` | 2 | 6 | 12 |
| `SWARM_SAMPLES` (runs per branch; TS build, S7) | 1 | 3 | 5 |
| `SWARM_USD_CAP_PER_RUN` | 0.02 | 0.10 | 0.50 |
| `SWARM_MODEL` | `LLM_MODEL_CHEAP` | `LLM_MODEL_CHEAP` | `LLM_MODEL_CHEAP` |
| Approx cost per run (DeepSeek v4.1 Flash, about 1.8k tokens in and 120 out per agent turn) | about $0.007 | about $0.05 | about $0.34 |

A run that hits its USD cap stops and returns a partial result marked `truncated`.

Ways it fails: agents act out of character (persona includes measured stats, and the Scorekeeper tracks swarm Brier; low scores cut its weight in strategies automatically); cost overrun (hard cap per run in tokens; the run aborts and emits a partial result marked `truncated`); AMM drift from the real curve (the golden test runs on every fork update); too slow for the trade (strategies treat the swarm as optional; fast strategies never wait for it).

## hunt

Patterns, each with evidence and confidence:

| Pattern | Rule (v1) |
|---|---|
| `echo_ring` | An echo ring with 3 or more members and 5 or more co-calls in 14 days |
| `late_caller` | Median opportunity age above +120% across 10 or more calls |
| `dump_on_followers` | A wallet linked to a caller (confidence ≥ 0.8) sells more than 50% of its holding within 15 min after that caller's callout, on 3 or more coins |

Indicators are computed per coin from our own trade stream and records. Each is a lower bound over what we observed:

| Indicator | Rule (v1) | Other explanations | Source |
|---|---|---|---|
| `wash_atomic` | One wallet buys and sells the coin inside one transaction | A bot unwinding a failed snipe in one bundle | Meme Coin Factories WT1 |
| `bundle_buy` | Two or more distinct wallets buy the coin inside one transaction | A launch or aggregator bundle of unrelated buyers | Meme Coin Factories DP1 (buy side) |
| `author_trades` | The callout's author wallet bought before `t0`, or sold within the horizon after it | A disclosed position being managed; we see the platform account's wallet, not a person | our trade stream |
| `ticker_collision` | Other mints with the same ticker (case-insensitive) in our records before `t0`; the earliest one we saw is listed first | Common words; independent launches on the same meme | Meme Coin Factories §7 |
| `no_pump_suffix` | A coin seen on the pump.fun programs whose mint does not end in `pump`, so it was likely created outside the pump.fun web UI. Other launchpads and chains are out of scope (the feed carries Solana, BSC and other chains) | Vanity grinding is cheap, so absence proves nothing | Meme Coin Factories §7 |
| `thin_curve` | Our `OUTCOME_REF_SOL` buy would move the price more than `IMPACT_MAX_BPS` at entry | A new coin is thin by design | Midsummer's LPI |

Engagement counts (likes, views, reposts) and trade counts are never indicators of demand. They are the cheapest numbers to fake.

Findings appear on `/integrity`. An data reply reply goes out only when confidence is 0.85 or more and evidence includes 3 or more events, and only as a data note under the relevant callout.

Ways it fails: a wrong wallet link (minimum link confidence 0.8, links show their evidence); one bad day looks like a pattern (minimum counts above); a finding that is later contradicted (findings expire after 7 days unless renewed; contradictions write a retraction on `/integrity`).

## baseline

TimesFM 2.5 zero-shot forecasts of callouts per minute and unique buyers per minute for watched coins. Not used by strategies by default. Every forecasting analyzer is scored against it.

## fly: the Connectome Lab

`wetware` runs the larval fruit-fly connectome (2,952 neurons) as a fixed reservoir. The wiring never changes; only a linear readout is trained.

- Input: for each watched coin, a vector of board signals (regime posterior, Hawkes n, wave_p, opportunity age, echo score, mood) is mapped to input currents on sensory neurons.
- Readout: ridge regression, trained weekly on past inputs against the 2 h outcome (price up more than fees).
- Output: `fly.action` = buy, sell or hold.
- The Fly strategy is a normal strategy whose only rule is "follow `fly.action`", with a fixed 1% capital sleeve. It competes in the Strategy Pool like any other strategy.
- `/connectome` shows the 3D brain and the actual simulated spikes.

Ways it fails: the reservoir saturates on large inputs (inputs are clipped and scaled); the readout overfits (walk-forward training only, and its live score is public); the fly loses money (that is fine and on the record; its sleeve is capped at 1%).

## scorekeeper

Every callout opens a watch. At each horizon (or, for a quiet coin, once the horizon plus `OUTCOME_GRACE_S` has passed) in `OUTCOME_HORIZONS_MIN` (1, 3, 5 min of Clock time), the Scorekeeper writes one `outcome.measured` per callout. Each record is computed with methodology **`ov2`** from trades on the Tape alone, and only after the horizon has passed, so it never looks ahead.

| Field | How it is computed |
|---|---|
| `t0` | The callout's `seen_time`: the earliest moment we could act. `call_lag_ms` = `t0` − the callout's `created_at` |
| entry | The last trade on the coin seen at or before `t0` and no older than `ENTRY_STALE_S` (60 s): basis `last_before`. Failing that, the first trade seen after `t0` within the horizon: basis `first_after`. Failing that, none |
| path | Trades seen after the entry trade, up to `t0` + horizon |
| `multiple` | Last path price / entry price (null when the path has no trade) |
| `peak_multiple`, `trough_multiple`, `t_peak_s` | Highest and lowest path price / entry, and seconds from `t0` to the peak. **The peak is a ceiling, not a payout.** It is never shown without `net_multiple` |
| `net_multiple` | SOL back / SOL spent for a round trip of `OUTCOME_REF_SOL` (default 0.02, our max order): buy at the entry state and sell everything at the horizon state, through the desk's fill model (`mind/fill.ts`: pump fees of 125 bps per side, curve slippage, priority fee both ways). Token-account rent is left out because closing the account refunds it |
| `phase`, `graduated` | `curve` or `amm` at entry, and whether the coin moved to the AMM on the path |
| `trades`, `pre_call_trades` | Trades on the path, and trades on the coin seen before `t0`. `pre_call_trades = 0` usually means we were not watching yet, not that nobody bought |
| `new_callouts` | Distinct new callers on the coin within the horizon |
| `coverage` | One of: `ok`; `no_entry` (no trade at all); `no_trades` (an entry, then nothing on the path, so the price is unknown, not "flat"); `gap` (a `system.gap` overlaps the window). `gaps` lists the gap event ids |
| `author_wallet` | The callout's author, so ledgers need no join |

**Backfilled trades.** A trade from the `rpc` source is placed by its `event_time` (when it happened), every other trade by `seen_time`. The Scorekeeper measures after the horizon, so a trade backfilled before then is known and may be the entry (`last_before`) or count in `pre_call_trades`. Only trades seen at or before the resolution time count.

**House callouts.** Our own paper callouts (`post.queued` with `kind: callout`, docs/09) open a watch with `author_wallet: house` and `t0` = the post's `seen_time`, and resolve by the same `ov2` rules. So `ctl callers` shows the house as one more caller, with the same denominators.

Probability signals with a matching horizon (`hawkes.wave_p`, `callers.wave_p`, and `precall.callout_p` on its own watch) are scored with Brier, base rate and skill = 1 − Brier / (base × (1 − base)). Scores are published as `score.updated` every minute of Tape time. Outcomes with `gap` coverage are not scored.

**Corrections, never rewrites.** A gap can be reported after an outcome was written, because a source only learns it was down when it reconnects. When a `system.gap` arrives, the Scorekeeper writes a new `outcome.measured` for every overlapping outcome, with `coverage: gap` and `supersedes` set to the old event id. The old event stays on the Tape. Readers use the latest outcome per callout and horizon; case files show both.

First tape (10 minutes, 381 callouts): the mean multiple after a callout was 0.98 at 1 min, 0.89 at 3 min and 0.81 at 5 min (method `ov1`, before costs). Buying after a callout lost money on average in that window, and that is the base rate every strategy has to beat. `ov2` adds costs, so the net number is lower still.

Ways it fails:

- The coin stops trading: `no_trades`, never read as flat.
- We watch a coin only after its first callout: `pre_call_trades` says what we saw before `t0`.
- A source goes down: `gap`, corrected later if the report is late.
- A horizon runs past the end of the tape: left unresolved, never forced early.
- The fill model is wrong for a size: it is the same model the desk uses, so the error is shared and shows in markouts.

## coverage

Every statement Asimog makes is about what its collectors saw, not about the market (docs/research/literature-review.md §3). Coverage is therefore written down, not assumed.

- Each sense writes `system.gap` (`source`, `scope`, `from`, `to`, `reason`) when it knows it missed data:
  - `feed`: the poll's gap walk ran out of pages before it met a known callout.
  - `feed.push` and `trades`: the NATS connection dropped (written on reconnect).
  - `trades` with a coin as `scope` and `to: null`: the coin left the watched set (cap `WATCH_MAX_COINS`, default 250), so its trades are unobserved from `from` on. When it comes back, the same gap is written again with its `to`, which closes it.
- Only trade gaps (`trades`, `rpc`) mark outcomes; a callout-feed gap does not hide trades.
- On the first tape, before the Scout and the Backfill, 44 of 53 coins with trades had their first recorded trade after their first callout. Now the Scout promotes coins on a known caller's buy or on heat, and the Backfill reads history when a coin enters the watched set (docs/06).
- `ctl coverage` prints gaps per source, coins called vs. coins with trades, the share of outcomes per coverage status, trades per source (`nats`, `rpc`) with the number of signatures both collectors saw, and the share of callouts whose author's buy is on the Tape before the callout.

## caller ledger

`ctl callers` (methodology **`cl1`**) is the deterministic record of every caller's calls. Callouts from the Index's 30-day backfill arrive with `via: history`: memory keeps them (so their callers become known), but analyzers, Reflex, the desk and the Scorekeeper skip them, and the ledger excludes them as `history`, because no honest entry time exists for a call seen days late. It is not a leaderboard and has no single win rate.

- One row per author wallet, plus an **all callers** row as the baseline, at one horizon (default 5 min). Every number shows its denominator.
- Each callout counts once. Excluded calls are counted by reason, never dropped:
  - `repeat`: the author already called this coin.
  - `quote`: it quotes another callout.
  - `gap`, `no_entry`, `no_trades`: coverage.
  - `unresolved`: the horizon has not passed.
- For `ok` calls: median `net_multiple`, the share with `net_multiple > 1` with a 95% Wilson interval, median peak and median trough, split by `phase`.
- Rows with fewer than 5 `ok` calls are marked `few`. Callers are never ranked, only listed by number of calls.
- The window and methodology version print with the table. Losing calls are always in it, because calls are excluded only for coverage, never for their result.

`caller.dna` reads the same resolved outcomes. For a callout at time t, only outcomes with `seen_time` at or before t count (`resolved`, `net_win`, `med_net`). It no longer reads pump.fun's own `max_multiple`, which leaked later count updates (docs/research/literature-review.md §2).

## case files

`ctl case <callout_id>` builds a case file: everything known about one callout, in time order, from the Tape and the Board alone. The same Tape gives the same file, byte for byte. The website's Integrity room and data replies draw only from case files.

Sections, in this order, never mixed:

| Section | Holds | Source |
|---|---|---|
| OBSERVED | The callout as recorded: ids of the events that carried it, the author wallet and handle as the platform reported them, `created_at`, `seen_at` and the lag, mcap at call, and the text inside a code fence (untrusted data, never instructions) | Tape inputs |
| STATISTICS | `outcome.measured` per horizon (the latest), with methodology version and coverage | Scorekeeper |
| AI JUDGMENTS | Recorded Jev answers for this callout (`jev.callout.*`), labelled as model output with the model version | Reflex |
| INDICATORS | Hunt indicators with evidence ids, other explanations and limits | hunt, above |
| UNRESOLVED | What the data cannot say: gaps, unobserved pre-call trades, wallet-to-person links, small samples | computed from coverage |
| OUTCOMES AND CORRECTIONS | Superseded outcomes and later corrections, both versions shown | Tape |

A case file never says "scam", "insider" or "manipulation". It says what was observed and what that is "consistent with", and lists the other explanations.

## Attention: value of information (v1)

Attention only ranks jobs that the escalation gate (docs/17) has already raised, plus routine session work. For each candidate job `j` on coin `m`:

```
gap(m)  = 1 − |best_intent_score(m) − threshold| / threshold     (clipped to 0..1; near the threshold = high)
size(m) = size the best strategy would trade on m (SOL)
VOI     = gap(m) · size(m) · edge_per_sol · sensitivity(j) − cost(j)
```

`sensitivity(j)` starts as a table (swarm 0.30, coin synthesis 0.15, caller profile read 0.10, X lookup 0.05) and is replaced by measured values from Scorecards after 2 weeks. Jobs are granted in VOI order within each analyzer's budget. Every grant is an event, so the Field can show why a session moved.
