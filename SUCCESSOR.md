# Successor prompt: Asimog

Paste this whole file to the next agent as its first message. It replaces the chat history. Read it top to bottom before your first change, then read `AGENTS.md`, `CONSTITUTION.md`, `docs/21-first-principles.md`, `docs/22-firm-architecture.md`, `docs/00-goals-and-decisions.md` and `docs/03-system-model.md`.

Written 2026-10-17 at the end of the first build session. Repo: `https://github.com/asimog/asimov` (public). The owner moves to a **Windows** machine next (not WSL). See "Moving to Windows" at the end.

---

## 1. What we are building, in one paragraph

**Asimog** is a near-autonomous AI firm. The owner gave it a Pump.fun coin (already created; the creator wallet is handed over), a small machine and **0.2 SOL**. It starts life inside **Pump.fun callouts**: it reads every callout and every trade, learns which callers move which coins, trades on paper first, then with real money through a Risk Gate, and posts its own callouts with its position disclosed. It grows by **financial milestones** into forecasting (Polymarket and Kalshi on paper first), BTC and ETH, writing its own code (a Builder agent), and building social capital (bounties, X posts). Long-term goal in the owner's words: "the BlackRock of the future that started in the trenches." The owner acts as legal counsel and is the only human in the loop. Every motion on its website is caused by a real event.

The project started as "OCTOPUS" (a crawler/trader creature). The owner dropped all creature naming. Use neutral, functional names only (Feed Reader, Chain Reader, Publisher, Signer, Desk, Strategy Pool, Scorekeeper). If you see octopus, tentacle, ink, Herald, organ or creature words anywhere, they are leftovers: replace them with the GLOSSARY term.

## 2. Callouts are the primitive

Everything starts from one object: **a callout** (a Pump.fun post where a caller recommends a coin, with mcap at call, thesis text, media, counts, later updates and the caller's position). The plan treats callouts as the firm's first raw material and builds three layers on it:

1. **Callout intelligence (read).** Ingest every callout in real time (poll + NATS push), every trade on called coins, every update and exit. Compute per callout: opportunity age (minutes since the first callout on the coin, price move since), echo (is this a copy of an earlier caller: follow affinity, 5-char shingle text similarity, quote edges), Hawkes self-excitation (does this coin's callout cascade grow or die), the callers' wave (how many new callers will arrive), curve state (progress to graduation, our own impact and slippage at each size), and Jev judgments of the text (fresh call vs hype vs exit notice, thesis quality, promo, countdown, prompt injection, narrative).
2. **Callout tracking (score).** The Scorekeeper watches every callout and measures what actually happened at compressed horizons (1, 3, 5 min): price multiple and new callers. It scores every probability signal with Brier. Caller DNA accumulates per wallet. Integrity patterns (echo rings, timing) become website content and data replies only, never accusations in posts.
3. **Making callouts (write).** The firm buys first, then calls (never front-running followers: it discloses its position in the callout), and posts every exit as a native callout update as it happens. Honest trading code: free market, position disclosed, exits posted, no side wallets, never trade our own coin, never promise returns. Follower PnL is **published, not gated** (the owner rejected a follower-PnL hard gate: "this is a free market... no deception, no side wallets and full disclosure").

The core insight behind all three: **predict the callers, not the price** (a Keynes beauty contest). Price on Pump.fun follows attention; attention follows callers; callers follow each other. Model the crowd, not the chart.

## 3. Unique insights from the discussion (do not lose these)

- **Predict the callers, not the price.** Caller models in three tiers: Tier 1 statistical (live, population model), Tier 2 Jev `callers` pack (one Noul per candidate caller in one request), Tier 3 MiroShark swarm simulation (only when the escalation gate fires).
- **Most callers are new wallets.** On the first tape, 352 distinct wallets made 381 callouts. A model over known callers alone predicts nothing. The live Tier 1 model is therefore a population model: measured callout rate × the coin's share by preferential attachment, with known callers as the part we can name (Poisson-binomial convolved with Poisson for the unnamed).
- **Buying after a callout lost money on the first tape.** Mean price multiple after a callout: 0.98 at 1 min, 0.89 at 3 min, 0.81 at 5 min. 5-minute buy markouts averaged −60%; 17 of 23 paper exits hit stops. This is the base rate every strategy must beat. The kernel correctly gave every strategy zero capital. Do not tune it away; it is the truth the desk must earn against.
- **Hawkes has skill; callers.wave_p does not yet.** Brier 0.155 vs 0.245 baseline (skill 0.37) for Hawkes; 0.418 vs 0.43 base rate for the callers model. Strategies weight both; evolution moves weights.
- **Cost before edge.** At 0.2 SOL, a round trip costs about 2.5% in fees plus slippage, and token-account rent (0.00148844 SOL measured on chain, 7.4% of a 0.02 SOL trade) comes back only if the account is closed after the full exit. The Trader always closes token accounts. The DSL has a cost-floor term: the score read as a win chance must clear round-trip costs given the take-profit and stop geometry.
- **Markouts are the fastest truth.** 1 s, 10 s, 60 s, 5 min markouts on every fill tell you within minutes whether entries are good, long before PnL.
- **One kernel at every level.** The same allocation rule (Thompson sampling over a skeptical posterior, hurdle, caps, LCB promotion in two separate windows) allocates capital to strategies, then later to venues, social campaigns and compute jobs. Every kernel position has a budget, a hurdle and a kill rule.
- **Growth forced by capacity.** Callouts cap out at small size (slippage). Milestones unlock new markets because the old one cannot absorb more capital, not because of ambition.
- **Commit-reveal glass box.** Every decision (and later every hypothesis and forecast) is hashed (sha256 of canonical JSON) and published before the outcome, revealed after. Credibility without asking for trust.
- **Public paper forecasts are free credibility.** Polymarket and Kalshi forecasts on paper, committed and Brier-scored in public, before any money.
- **Social capital is capital.** Followers, engaged accounts and bounty participants are tracked like a balance sheet line and allocated by the same kernel. Bounties double as audience building.
- **System One / System Two.** Jev (TypeSafe) answers fast typed questions (~300 to 600 ms) on every callout; BettaFish (feed synthesis) and MiroShark (swarm simulation) are slow and optional, gated by value of information. Strategies never wait for System Two (`missing: skip`).
- **Jev is for judgments, never math.** Code computes numbers and passes named buckets ("small (10k to 30k)"); Jev answers choices, scores and yes/no with probabilities.
- **Replays are the backbone.** Every Jev answer is recorded on the Tape, so replays make zero model calls and are byte-identical.
- **Exits as native callout updates.** Every partial sell is posted as an update on our own callout ("sold 25% at 2.1x, holding 50%").
- **Connectome Lab.** A fruit-fly connectome (wetware) as a fixed reservoir with a trained readout trades a fixed 1% sleeve. A lab, labeled honestly.
- **Terse voice.** The agent speaks short and exact: no emojis, no em dashes, position disclosed (`agent/skills/voice-terse`).
- **UI: numbers as narrative.** Counters that fill, costs struck through as they are replaced, streaks that grow. The Field shifts temperature amber → crimson under stress and cools back when it recovers. "NO HUMAN IN THE LOOP" shows only when true. Browser session frames (agent-browser) stream live into a strip.

## 4. Decisions made (and the ones rejected)

Full table with reasons: `docs/00-goals-and-decisions.md`. The ones that came from the owner directly:

| Decision | Detail |
|---|---|
| Mandate | Coin + infra + 0.2 SOL. Limits set by owner later; defaults sized for 0.2 SOL (max order 0.02, max position 0.04, 5 open coins, ≥0.1 SOL free, 25% daily loss stop, 300 bps impact). |
| No 4 calls/day limit | Post as many callouts as strategies justify, within platform cooldowns. |
| Buy first, then call | Not front-running: the callout discloses the position. |
| Exits are good | Post every exit as an update. |
| Follower PnL | Published on the Ledger, not a gate. |
| No separate functions | All functionality lives in core. Only legal (owner as counsel) is separate. |
| Domains | cancerhawk.org, polymyths.com, hyperkaon.com are frontends built later by the agent itself. cancerhawk.org already exists; the Builder's first project is rebuilding it from scratch to prove it can. Deferred: hypermyths, hypermythsvr, hyperc3, hypertian, tianezha, hashmyth. Main site asimog.com. |
| Holder payouts and seats | Deferred to M5. Creator-fee payout math was removed ("grossly miscalculated / not necessary"). |
| Milestones | Start → M1 runway 30 days → M2 2 SOL → M3 10 SOL → M4 100 SOL → M5 1,000 SOL. |
| No wallet connection on the site | The only visitor input is a payout wallet address (base58, on curve). No free text. |
| Hunting | Integrity patterns live on the website and in data replies; no callout post ever calls out a person. |
| Removed from the plan | Shadow Duel, Shadow Chat, any chat, pump-fun "agent" token product, 2-hour tapes, long horizons. |
| Horizons | Compressed to minutes: wave 5 min, outcomes 1/3/5 min, holding fast ≤3, medium ≤10, slow ≤30 min, allocation and evolution every 2 min of Tape time. All env. |
| Full implementations | "Don't do minimal thin slice implementations. Do them full." Scaling knobs (calls, API budgets, compute) are env variables, defaults sized for a small VM / consumer hardware. |
| Models | Testing: OpenRouter `deepseek/deepseek-v4.1-flash`. Jev: TypeSafe `jev-1.14.0` with the TypeSafe key. Never hard-code providers, URLs or models. |
| RPC | Helius free tier. |
| Deploy | Railway + Vercel, or Coolify + Cloudflare Tunnel (open decision, docs/16). |
| Legal | The owner confirmed review of the Pump.fun callout terms with Pump.fun. Do not concern yourself with legal complexity; never game the Activity Metric (terms 7.1(f)). |
| Design | "Futuristic, unique, never seen before, ethereal. Not too wordy. It should amaze a person and capture interest first." impeccable wins all design conflicts. Banned list in docs/12 is hard. |

## 5. The plan (stages and milestones)

Engineering stages S0 to S11 (`docs/13-implementation-phases.md`, with a status table at the top):

| Stage | What | State |
|---|---|---|
| S0 Discovery | Find the feed endpoints, NATS servers, record a tape | Done |
| S1 Foundations | Postgres, contracts, Tape, Clock, consumers, `ctl` | Done |
| S2 Senses + memory | Feed Reader (poll + push), Chain Reader (NATS trades), memory projections; X Reader open | Mostly done |
| S3 Fast mind | Board, cheap analyzers, Reflex (Jev), Scorekeeper, no-lookahead. Open: regime HMM (Python), attention + escalation gate, Jev packs `coin`, `callers`, `guard` | Mostly done |
| S4 Paper desk | DSL + validator, 30 seeds, fill model, Risk Gate, kernel, markouts, commit-reveal, evolution | Done |
| S5 Instruments v1 | Relay (SSE), web shell, Field, Cortex, Lab, Ledger, Charter, share cards, deploy | **In progress**: relay done; `apps/web` scaffolded (tokens, live store); Field scene not written |
| S6 Live desk and books | Signer, Executor, Publisher (posting callouts), books, reconciliation | Open; ask the owner for keypairs, RPC and signer setup first |
| S7 Slow mind | BettaFish + MiroShark forks with a Pump.fun module, LangGraph thinking agents | Open (MiroShark needs Neo4j) |
| S8 Forecasting desk | Polymarket/Kalshi on paper, commit-reveal, Brier vs market | Open |
| S9 Social capital | X posting, bounties, social snapshot | Open |
| S10 Builder | Sandbox, PRs, suites; first project: rebuild cancerhawk.org | Open |
| S11 Milestones + labs | Ladder checks, Connectome Lab | Open |

## 6. What exists in the repo now

```
packages/contracts/src/index.ts   zod schemas for every topic (TOPICS), IDs, canonical() for commit hashes
services/core/src/
  main.ts, runtime.ts             boots everything; buildConsumers() is the one consumer list (live and replay)
  lib/  env.ts (layered env, redact), clock.ts (live/replay, seeded RNG, prefixed ULIDs), db.ts, log.ts
  sql/schema.sql                  tape.*, mem.*, board.*, mind.*, ops.*
  tape/ tape.ts (buffered serialized writer + emitIn inside consumer tx), consumer.ts (offsets, drain, runLive, startAtHead)
  senses/ pump-http.ts, nats.ts, feed-reader.ts, chain-reader.ts
  memory/projections.ts           coins, callers, callouts, 1-minute bars
  board/board.ts                  putSignal, liveFor (time-travel reads)
  analyzers/ cheap.ts (age, echo, hawkes, callers, curve), curve-math.ts
  reflex/reflex.ts                Jev callout pack, budget, queue; jev.answer -> jev.* signals
  scorekeeper/scorekeeper.ts      outcomes at 1/3/5 min, Brier
  mind/ dsl.ts, seeds.ts, risk.ts, fill.ts, kernel.ts, evolve.ts, desk.ts
  cli/ctl.ts                      state, why <id>, tail, doctor, migrate, rebuild, export
services/relay/src/main.ts        public SSE fan-out + /v1/snapshot (read-only DB)
apps/web/                         Next.js 16 + R3F scaffold: app/globals.css (tokens), lib/live.ts (store + SSE)
tests/e2e/                        run.ts, lib/ (replay driver, checks, artifacts), suites/ (6 suites), fixtures/tapes/discovery-10m.ndjson.gz
docs/                             00 to 22, GLOSSARY, inspiration/ (4 GIFs + sheets), research/
```

All 6 E2E suites pass on the fixture (27 s): `riskgate-refuses`, `analyzers-replay`, `strategies-replay`, `commit-reveal`, `evolution-replay`, `replay-determinism` (two fresh databases, identical hash over 1,044 derived events and 8,707 signals).

Key architecture rules learned while building (docs/03):

- Senses and Reflex write through the buffered Tape writer (one flush at a time; concurrent flushes deadlocked on `tape.dedupe`, fixed by serializing and sorting keys). Deciders (desk, scorekeeper) write with `emitIn` in their own transaction. A derived event is stamped at least 1 ms after its cause (exactly 1 ms in replay).
- A consumer reads topics from one writer only.
- Inputs vs derived topics: replays load inputs (including recorded `jev.answer`) and re-derive everything else.
- `ctl rebuild` clears only pure projections; deciders are rebuilt by replay into a fresh database.
- Deciders start at the Tape head in live mode (`startAtHead`), so they never decide on old history.
- Replay databases `asimog_e2e_*` are kept after runs; deleting them is the owner's call (AGENTS.md: never delete a database without asking).

## 7. Next actions, in order

1. Finish S5 Field (`apps/web`): `app/layout.tsx` (Plex Mono, Sans, Sans Condensed via `next/font`), `app/page.tsx`, a GPU particle Field (one `Points` draw: per-coin clouds shaped in the shader from a per-mint seed, density = attention, breathing, flare on `callout.created`, shimmer on `jev.answer`, Core cloud at center, filaments to open paper positions, callouts falling in from above as comets, `uTemperature` amber → crimson from real markout stress), DOM labels projected on the top clouds, click a cloud for its dossier, HUD (MODE PAPER, MANDATE 0.2 SOL, FLOOR −25%, MILESTONE START, POOL, PAPER NET, COUNSEL 0, VIEWERS), a strip of 7 panels (Tape, Positions, Markouts, Equity, Pool, Scores, Rates), footer pages. Label paper trades PAPER. Then Lab (the commit arc: we already have real commits and reveals) and Cortex.
2. Write `e2e/site-field` with agent-browser screenshots at 1440×900 and 390×844, and the truth check (HUD numbers = API values).
3. Jev packs `coin`, `callers`, `guard`; attention + escalation gate; regime HMM in `services/analyzers-py` (uv + hmmlearn).
4. Record longer tapes (30 min, busy hours) so commit-reveal reaches 100 reveals and evolution has evidence.
5. S6: ask the owner for W_trade, W_creator, W_agent keypairs, RPC and signer placement before writing any money code.
6. Update `docs/02-architecture-and-stack.md` with rows for relay (hono, postgres) and web (next, react, three, @react-three/fiber, zustand), and note the relay reads Postgres read-only instead of connecting to core.

## 8. Upstream repos and how they link

`.upstream/` holds read-only copies of prior art (gitignored, never imported, never installed). Search it on purpose with `rg --no-ignore --hidden <pattern> .upstream/`. Its index `.upstream/UPSTREAM.md` is not in git, so the list is copied here. Clone with `git clone --depth 1 https://github.com/<owner>/<repo> .upstream/repos/<owner>__<repo>`.

| Repo | Verdict | How it links to Asimog |
|---|---|---|
| 666ghj/BettaFish | RUN (fork) | System Two feed synthesis: InsightEngine reads our callout tables, ForumEngine debates. docs/07 |
| MiroShark/MiroShark | RUN (fork) | System Two swarm simulation of callers and followers; new `simulations/pumpfun` module on its polymarket pattern. Needs Neo4j. docs/07 |
| 666ghj/MiroFish | PATTERN | MiroShark's upstream: OASIS scale-out, god's-eye injection |
| vercel-labs/agent-browser | DEP + SKILL | Browser sessions, snapshots, HAR, WebSocket frames; how we found the feed; session frames for the UI strip. docs/06 |
| pump-fun/pump-fun-skills | SKILL | swap, coin-fees, create-coin, tokenized-agents; program IDs. docs/09, 10 |
| solana-foundation/solana-dev-skill | SKILL | Solana playbook for builders |
| nirholas/XActions | DEP + SKILL | Read X posts and profiles of callers (read only for now). docs/06 |
| xerj-org/xerj | SKILL | Local search index over dossiers and `.upstream/` |
| unclecode/crawl4ai | PATTERN | Crawl patterns (dedupe, adaptive crawl) |
| morluto/rea | SKILL | Reverse-engineer client endpoints when HAR is not enough |
| NationalSecurityAgency/ghidra | ASSESS | Only if an endpoint exists solely in the mobile binary |
| nirholas/kol-quest | PATTERN | KOL wallet sources (KolScan, GMGN) to link callers to wallets |
| nirholas/pump-fun-workers | PATTERN | Pump.fun frontend API read endpoints |
| chainstacklabs/fomo-solana-rh-listeners | PATTERN | Listener structure for on-chain trade flow |
| chainstacklabs/pumpfun-cli, pumpclaw | ASSESS, SKILL | Operator manual trades and dry runs only |
| chainstacklabs/web3-ai-trading-agent | PATTERN | Synthetic data, distillation, RL ideas for later strategy training |
| chainstacklabs/chainplot | PATTERN | Hash-joined proven ranges: pattern for treasury proofs |
| greengod63/PumpFun-Bonding_Curve | PATTERN | Graduation progress alerts |
| nirholas/visualize-web3-realtime | PATTERN | GPU instanced force graph in one draw call: Integrity caller graph |
| Roxx0x/wetware | RUN (lab) | Fruit-fly connectome reservoir: Connectome Lab, 1% sleeve |
| cobanov/fly-connectome-template | PATTERN | Fly anatomy viewer (attribution required) |
| marketcalls/openfly | PATTERN | Precedent: fly CNS wired to a market, paper first, honest results |
| google-research/timesfm | SKILL | Baseline forecaster for attention series (2.5 Apache-2.0; 3.0 non-commercial) |
| QuantConnect/Lean | PATTERN | One fill model for backtest, paper and live: basis of `mind/fill.ts` |
| Conway-Research/automaton | PATTERN | Constitution + SOUL.md, survival tiers, policy engine, protected files: basis of docs/22 and CONSTITUTION.md |
| TauricResearch/TradingAgents | PATTERN | Multi-agent firm roles for thinking-agent prompts, never for live decisions |
| virattt/ai-hedge-fund | PATTERN | Investor-persona agents (educational) |
| freqtrade/freqtrade | PATTERN | Strategy interface, dry run, hyperopt |
| hummingbot/hummingbot | PATTERN | Exchange connectors, market making |
| nautechsystems/nautilus_trader | PATTERN | Event-driven engine with backtest/live parity |
| microsoft/qlib | PATTERN | Factor research, walk-forward evaluation |
| ccxt/ccxt | DEP later | CEX spot and perps adapters at M4 |
| DavidHDev/react-bits | DEP (components) | Counters, split-flap, decrypted text, threads, gauges (MIT + Commons Clause: use, never resell) |
| pbakaus/impeccable | SKILL | Design authority, wins every conflict |
| leonxlnx/taste-skill | SKILL | Second opinion on public pages |
| emilkowalski/skills | SKILL | Animation decisions |
| Jakubantalik/transitions.dev | SKILL | CSS transitions, motion tokens |
| enzed/r3f-skills, emalorenzo/three-agent-skills | SKILL | React Three Fiber |
| mirukullacode/tweenly, swamimalode07/rare-ui | DEP (shadcn registry) | Animated number pop-ins, charts |
| piskelapp/piskel | ASSESS | Not needed now |
| JuliusBrussee/caveman | SKILL | Source of the terse voice |
| typesafe-ai/skills | SKILL | `typesafe-ai` skill for Jev |
| DietrichGebert/ponytail | SKILL | Code style: laziest solution that works |
| ayghri/i-have-adhd | SKILL | Reporting style to the owner |
| freshtechbro/claudedesignskills | ASSESS | Overlaps the R3F skills |

Also in `.upstream/`: `npm/` (unpacked @pump-fun/pump-sdk 4.1.0, pump-swap-sdk 2.1.0, shared-contracts 0.2.2, agent-payments-sdk 3.0.3) and `sites/` (Pump.fun callout terms page saved 2026-10-16, Pump.fun web bundles, good-css.com, the full docs.typesafe.ai mirror with 20 cookbooks, crawlnet motion reference). `sites/` cannot be re-downloaded identically: copy it.

## 9. Platform facts (verified 2026-10-17)

Full catalog: `docs/research/pumpfun-endpoints.md`.

- Feed: `GET https://frontend-api-v3.pump.fun/home-feed/new?pageSize=50&chain=all&platform=WEB[&pageToken=]` (public, needs Origin/Referer pump.fun). Items carry `position.callout` (calloutId, calledOutAtMcap, calloutPrice, thesis, mediaUrl, calloutTimestamp, multiple, maxMultiplier, updates[], counts, quotedCalloutId). Also `/home-feed/new/count?since=<headToken>`.
- Realtime NATS over WebSocket, user `subscriber`, a different static web-client password per server (in `.env.local`, never commit): `wss://unified-prod.nats.realtime.pump.fun` (trades: `unifiedTradeEvent.processed.{mint}`, `.lite.>`), `wss://prod-v2.nats.realtime.pump.fun` (`followingFeed.user.{id}`: callouts pushed per follower, so dedupe by calloutId; about 190 msgs/s fan-out).
- Rates: about 0.5 to 0.6 callouts/s; about 25 trades/s on watched coins.
- Chain: fee config creator 30 bps + protocol 95 bps (125 bps per side); creator fee configurable up to 300 bps; token-account rent 0.00148844 SOL; curve virtual reserves 30 SOL / 1.073B tokens, 793.1M real tokens. SOL about $104.
- Jev: about 300 ms warm, 400 to 600 ms p95 from the dev machine (target 200 ms not met), ~500 input tokens for a 6-question pack.

## 10. Rules you must not break

Read `AGENTS.md` Boundaries in full. The ones most likely to bite:

- Never read, print, commit or hard-code keys. `.env.local` holds them (gitignored). The repo is public: scan staged files for secret values before every commit.
- Never place an order except through the Risk Gate. Never change limits or `ASIMOG_MODE` in code.
- Never `UPDATE` or `DELETE` `tape.*`. Never drop, truncate or reset any table or database without the owner's yes in the same conversation.
- Never `Date.now()` in analyzers, mind or hands: use the Clock.
- Docs first, then a failing E2E test, then the smallest implementation, then clean up. No unit tests after code.
- Every new topic or signal kind goes in `docs/04-contracts.md` and `packages/contracts` in the same change.
- No emojis, no em dashes in UI copy and posts. Every UI motion is caused by a real event. Simulated content is labeled SIMULATED; paper trades are labeled PAPER.

## 11. Moving to Windows

The owner will clone from GitHub into Windows (not WSL). Things that change:

1. **pnpm:** on Windows the native `pnpm` works; the `npx -y pnpm@10.29.3` workaround in AGENTS.md was only for WSL. Update that line in AGENTS.md after the move.
2. **Postgres:** the dev cluster lived in `data/pg` (gitignored, Linux binaries) and does not move. Install PostgreSQL 18 for Windows (or Docker Desktop), create user `asimog` and database `asimog` on port 54329 (or change `DATABASE_URL` in `.env.local`), then `npm run ctl migrate`. The `pg:start`/`pg:stop` scripts in `package.json` point at `/usr/lib/postgresql/18/bin/pg_ctl`; replace them with the Windows path or drop them. Old local data is not needed: the fixture tape in the repo is enough to replay.
3. **`.env.local`** is not in git. Recreate it from `.env.example` with the Helius, OpenRouter, TypeSafe keys, `ONCOJEV_TESTING=1` and the two NATS passwords (copy the file across by hand, never through git).
4. **agent-browser:** `npx agent-browser install` downloads Chrome for Windows.
5. **ffmpeg** for the `video-frames` skill: install a Windows build and put it on PATH.
6. **Python services** (later): `uv` works on Windows.
7. **Line endings:** `.gitattributes` forces LF (`* text=auto eol=lf`) and marks the tape and images binary.
8. **Fixture tape** (`tests/e2e/fixtures/tapes/discovery-10m.ndjson.gz`) is binary; Git keeps it as is.
9. Run `npm run e2e` first: all 6 suites must pass on Windows before any new work.
