# Decisions

Dated decisions with their reason. The newest are first. Open questions for the owner are at the end. A decision changes only by a new row here.

## 2026-10-19 (owner, C phase)

| Decision | Why |
|---|---|
| The Scout's watch reasons map to in-play reasons: `caller_buy` to `precall`, `smart_buy` and `follow` to `smart_buy`, `heat` and `metrics` to `scout`; no fifth reason | A followed wallet is a wallet we chose to copy, the same idea as the smart set; four reasons keep each family's results large enough to read |
| `KELLY_CAP=0.25` and `CALIB_MIN_PER_BIN=20` are env settings in `.env.example` | Quarter Kelly bounds a wrong calibration; 20 decisions per bin is the least that gives a usable win rate |

## 2026-10-19 (owner, after B1: real data first, small runs, disposable tapes)

| Decision | Why |
|---|---|
| Before coding against pump.fun or RPC, a task records the smallest real slice it needs (HTTP pages, seconds of NATS, a handful of RPC answers) and codes against those shapes and values | B1's chain value was a guess; a live slice showed three chains (`solana`, `base`, `robinhood`) and a Solana-only trade stream |
| Filter numbers are owner settings in `config/filters.json`, tuned by editing the file and restarting; code holds no threshold | They will be tuned often; the Tape records each set as `config.loaded` |
| Read every chain pump.fun carries; store the chains named in config (`solana` first); Robinhood is in `LATER.md` | Ingestion stays general and counts what other chains would add; trading another chain needs its own RPC, fill model and Signer path |
| The hot feed stays a source, but its Cloudflare challenge (403 from Node) is skipped and counted, never worked around | `AGENTS.md`: no bot-check bypasses; one pump.fun account |
| Old tapes are disposable: no compatibility, no migration; the fixtures were deleted and G0 records new ones | Replays of old tapes would only test old shapes; new tapes come from the finished code |
| Long runs (30-minute soak, long tape, replay suites) wait for G0, after B to F are coded; tasks prove themselves with small runs | Hours went to long runs on code that was still changing |
| The working database `asimog` is kept until B6-partitions, which recreates it with the owner's yes | Dropping it cannot be undone, and B6 needs a fresh schema anyway |

## 2026-10-19 (owner, open decisions closed)

| Decision | Why |
|---|---|
| Process has one home, `docs/WORKFLOW.md`: modes, one PLAN row and task file per session, one writer per file, shared files owned by the top agent | The Section A run spread work across one long session; subagents edited files outside their lists and a merge lost a change |
| Tests are tiered (fast, slow, soak, milestone) with budgets; bare `npm run e2e` runs the fast tier only; one test run at a time | Hours went to tests running on top of each other and to suites that did not need to run for the change |
| Lint checks lint rules and import order, not formatting; comma expressions and assignments inside expressions are allowed; `pnpm typecheck` covers core, web, Signer and relay | The code was never formatter-formatted (long one-line SQL is the house style), so formatting findings were noise; the two style rules flagged the house idiom; web and Signer were outside the typecheck |
| The BettaFish and MiroShark engines stay in git but are fenced: lint and default search skip them except our adapters, and each has a `VENDOR.md` | About 58k vendor files crowded search and lint; untracking would add a setup step |
| While prototyping, no large databases are preserved and no data migrations are written: schema changes happen in place and are tested on a new database or the smallest slice of data. Replay and test databases are disposable and the e2e runner drops its own | Building speed; there is no data worth keeping yet |
| Tape pruning: hot raw trades 4 h while testing, raw feed pages 1 h, Board history 48 h; callouts, decisions and books kept; archive every hour. The append-only rule now reads: no row is ever edited or deleted, and only the archiver drops whole hours after their archive file is checked | Keep Postgres small without losing replays; tune the window after measuring |
| The Index builds only from its own summaries. Leaderboards update hourly, a light rebuild runs every 12 h, a full rebuild every 48 h, and a deeper refresh (backfill, seed lists, owner updates) weekly | Raw trades are not needed once summarized; top lists stay always available |
| Filter before storing, and keep a 1% sample of rejected items | A bad filter must be visible |
| No known-wallet memory: the 500k "seen before" set and the `fresh_share` rug signal (Risk Gate reason `fresh_wallets`, `max_fresh_share`) are removed. The Scout tracks 500 to 5000 curated wallets (callers, KOLs, smart, `follow_wallets`) and an owner deny list (`blocked_wallets`, `blocked_creators`). Coins with an open position of ours are never dropped from the rollup. A fresh-wallet check for coins we are about to trade may return later as an on-demand lookup | The set cost about 180 MB of heap in 30 minutes for one rug signal; curated lists are what the reference repos keep (`.upstreamref/repos/yksanjo__kol-tracker`, freqtrade's blacklist). Removing a Risk Gate reason code is a loosening, so the owner decided it on 2026-10-19 |
| The data tiers in `OPS.md` are accepted, with a 5 to 10 GB budget for hot storage; older data goes to archive targets (a bucket or a git repository updated on a schedule); the wiki exports to a bucket or a GitHub docs repository. Targets stay pluggable | Fast hot storage, cheap long storage, options kept open |
| Default trading limits move from code to `config/limits.default.json` | Policy belongs where the owner can read it |
| Replies under another caller's callout only when we bought that coin; our callouts are bull posts made after we buy; detected rugs and scams feed the rug feed room | Platform rules and honesty |
| The agent runtime uses OpenRouter embedding models (`EMBEDDING_API_KEY` in `.env.local`), stored with pgvector in the same Postgres | Text similarity and retrieval without a new database |

## 2026-10-19 (owner, Blueprint pass)

| Decision | Why |
|---|---|
| Live trading is the last step; it never gates code. Every strategy and feature is built and tested on paper first; the first 0.01 SOL `live-*` test comes after the paper side is complete, fix 1.16 is done and `live-roundtrip` passes on a mock chain | Real money only after everything else is proven |
| Docs take a middle path: about ten hand-written docs plus catalogs generated from code; old docs move to a gitignored archive agents do not read | 27 docs drifted from code and from each other |
| Protocol constants stay with the protocol, in code, as the SDK defines them | They are facts, not knobs |
| Tests on every change: typecheck, lint, `docs:check`, replays under 60 s. Full suites only when the owner asks | Long suites slowed development |
| Order of work: docs, then the rest of the as-of fixes, then strategy, then the slow-mind gate, then hardening | Agents work from the docs |
| Far-off scope moves to `LATER.md` | Active docs describe only the firm being built |
| A public wiki catalogs top traders, their styles, strategies and hold times; summaries of pruned data go there | A user feature and compact agent memory |
| Filter at the door: read everything in memory, store only what passes owner filters | Most of the storage problem goes away before it is written |
| We speak only under coins we hold; scraped comments feed a public rug feed | Pump.fun allows replies only from holders, and we never buy bad launches |
| Feeds and filters are configurable (sources hot, trending, follow, top traders; chain; minimum position 10 USD; mcap at call; launch filters) | The raw global feed is too much to ingest |
| Backfill uses several RPC providers in parallel, after checking our own data | Faster history, fewer calls |
| Models per agent type in config, with OpenRouter free models as the last fallback on a separate key | No hard-coded model; service keeps running |
| Slow-mind spend while phase D is built uses low test limits: `SLOW_STAGE1_USD_PER_RUN=0.005`, `SLOW_STAGE2_USD_PER_RUN=0.03`, `SLOW_STAGE3_USD_PER_RUN=0.10`, `SLOW_USD_PER_DAY=0.50`; gate `ESC_P_LOW=0.35`, `ESC_P_HIGH=0.65`, `ESC_DISAGREE=0.3`; hot set `HOT_SET_SIZE=5` every `HOT_SET_EVERY_S=90`. The gate turns USD into SOL with an owner-set `SOL_USD` (150), not a price feed | A wrong cap costs little while the gate and caps are new; raise them after spend is measured |
| After the D review (owner, 2026-10-19): the Bridge alone owns room (hourly quota and day cap; the gate no longer marks grants `deferred`); the day cap counts today's spend (UTC, by when runs finished) so a day-capped job runs once a new day has budget; the hot set skips a coin granted within `ESC_RECHECK_MIN` (10); a coin run reads `SLOW_COIN_WINDOW_MIN` (10) of callouts; quotas and every Bridge setting come from env only; `attention.grant` is removed (nothing emitted it) | One owner per rule; no grant pile-up; a capped job is not lost at midnight |
| Feed mood (`mood.feed`) is computed in core from the bullish and bearish callout stances in each `synthesis.feed`, not taken from the engine (D6) | Every number reaching the Board comes from code |

## 2026-10-18

| Decision | Why |
|---|---|
| BettaFish and MiroShark are built inside this repo, not forked; licences checked by the owner, credits later | They are integral parts |
| Neo4j and Postgres run in one data stack; the engine workers in one persistent container | One machine, simple operations |
| The 6K market cap is a strategy parameter that evolves, not a rule | Datasets show no fixed coin filter wins |
| The firm builds its own 30-day Index of wallets, callers, coins and creators, scored by what we could have copied | Others' profits are not ours |
| One fix plan for the three audits | One coherent order of work |

## 2026-10-17 and earlier

| Decision | Why |
|---|---|
| Name Asimog, home asimog.com | The Asimov lineage plus "mog" |
| Constitution (protected) plus soul (agent-owned) | Laws it cannot rewrite; a self it can grow |
| Callouts are the centrepiece; the edge is on the buy side, before the callout | Callers buy before they call; buying after a callout lost money |
| Jev as System One; BettaFish and MiroShark as System Two, on escalation only | Fast, calibrated, cheap decisions on every event |
| Strategies as data in an evolving pool; one kernel with a hurdle; markouts first | Strategies must keep changing; truth about edge comes fastest from markouts |
| Deterministic Risk Gate; models propose, code decides | No model places an order |
| Honest trading: disclose positions, post every exit, no side wallets, never trade our own coin | A free market owes followers the truth |
| Close token accounts after every exit | Recovers about 0.0015 SOL rent, which matters at 0.2 SOL |
| Starting size 0.02 SOL, at most 5 open positions | Keeps 0.1 SOL free for fees and rent |
| Outcomes net of costs at our size, with coverage, by a versioned method | A peak is not a payout |
| Evidence classes kept apart; indicators, never accusations; corrections append | Claims are worth something only when anyone can see what was seen and inferred |
| Outside datasets and papers are baselines to reproduce, never facts about us | Different units, windows and collectors |
| Providers, URLs and models come from env | Swap any provider without code |
| One agent, one job, one key; LangGraph JS for thinking agents | A fooled agent damages only its own lane |
| Visitors watch, no chat | No injection surface |
| One dark world for every room | Owner, 2026-10-17 |
| TypeScript and Python only | Two languages are enough |

## Accepted risks

| Risk | Why accepted |
|---|---|
| The callout edge may not beat a 3% cost floor | Measured on paper first; if markouts stay negative, the desk stays a data source and storefront |
| Free RPC tiers may be too slow for the fast lane | Upgrade by config when measured |
| One account on one platform | Platform rules are hard boundaries in `AGENTS.md` |
| Fixture tapes may not represent busy hours | Record more tapes; one long fixture at milestones |

## Open for the owner

None right now.
