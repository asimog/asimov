# 03 · System model

This doc defines how Asimog is shaped so that an agent (human or LLM) can understand the whole system from a few commands and change one part without breaking the others. Read it before writing any code. docs/25 names the nouns, their lifecycles and the rules that must hold, with a status word on each; where this doc states a target the code does not meet yet, it says so.

## The design question

> If I were the agent driving this system, what would let me see the true situation fast, act with the least wasted money and tokens, and improve it safely?

Answers, each one a rule below:

1. One place to look for what happened (the **Tape**).
2. One place to look for what is believed now (the **Board**).
3. One gate every action passes (the **Risk Gate**).
4. Every object has a typed ID and links to its causes (**why-chains**).
5. Every belief is scored later against what happened (**Scorecards**).
6. Every cost is metered (**Budgets**).
7. One command surface does everything (the **`core` CLI**, mirrored as MCP tools).
8. The same code runs live, paper and replay (the **Clock**).

## The tower

Each layer only reads from the layer below and only writes to its own outputs. Arrows go up.

```
L7  Skin      website rooms, frame relay, public SSE          reads: L2-L6 projections
L6  Hands     Executor, Publisher, Treasury                       reads: Orders, Posts      writes: Effects (events)
L5  Mind      Strategy Pool (strategies), Allocator, Risk Gate            reads: Board              writes: Intents, Orders
L4  Analyzers    System One: Hawkes, Regime, Curve, Echo, Age,    reads: Tape, Memory       writes: Signals (Board)
              Caller models, Reflex (Jev packs), Fly
              System Two: Synthesis (BettaFish), Swarm (MiroShark)
L3  Memory    entities, bars, graph projections                reads: Tape               writes: projections
L2  Tape      append-only typed events                         reads: Senses, Hands      writes: Events
L1  Senses    Feed Reader, Sessions S1-S8, Chain Reader, X Reader       reads: the world          writes: Observations → Events
L0  World     pump.fun web + APIs, Solana, X
```

Cross-cutting: **Clock** (live / paper / replay), **Budget Ledger**, **Attention**, **Kill Switch**, **Scorecards**.

## The noun chain

Every thing in the system is one of these nouns. Each links to the nouns that caused it.

```
Observation → Event → Projection → Signal → Intent → Order → Effect → Outcome → Score
```

| Noun | Is | Made by | Mutable? | ID prefix |
|---|---|---|---|---|
| Observation | Raw thing a sense saw, with provenance (URL, request id, frame seq, tx sig) | Senses | No | `ob_` |
| Event | Normalized fact on the Tape | Senses, Hands | No | `ev_` |
| Projection | Current view built from events (a caller, a coin, a bar) | Memory | Rebuilt, never edited by hand | `cl_` caller, `cn_` coin, `co_` callout, `wl_` wallet |
| Signal | A belief about a subject with value, confidence and expiry | Analyzers | No (new signal supersedes old) | `sg_` |
| Intent | A strategy wants to act | Strategy Pool | No | `in_` |
| Order | An intent that passed the Risk Gate | Risk Gate | No | `or_` |
| Effect | What the hands did: a fill, a post, a sweep, a payout | Hands | No | `ef_` |
| Outcome | What happened afterwards, at a horizon | Scorekeeper | No | `oc_` |
| Score | How good a signal, strategy or analyzer was | Scorekeeper | No | `sc_` |

Other IDs: `sr_` strategy, `ps_` position, `tn_` session task, `sw_` swarm run, `sy_` synthesis run, `bt_` budget entry, `st_` seat, `dp_` deposit order, `ds_` distribution, `sp_` fee sweep.

IDs are ULIDs with the prefix (`sg_01JA...`). Sortable by time, and the prefix tells any reader what the object is.

## The Tape

- A single Postgres table `events`, append-only. No `UPDATE`, no `DELETE`. Today this is a rule every writer follows; no role or trigger enforces it yet (docs/25 I1).
- Every event has `event_time` (when it happened in the world) and `seen_time` (when Asimog learned it). Replays order by `seen_time`. Analyzers must never read an event whose `seen_time` is after the clock's `now`.
- Every event has a `topic` (for example `callout.created`, `trade.curve`, `session.read`, `order.filled`) and a JSON `body` that matches a zod schema in `packages/contracts` (validated on write).
- Consumers keep their own offset `(seen_time, id)` in `tape.consumer_offsets`. `NOTIFY tape` wakes them; a poll is the safety net. The handler and the offset update share one transaction, so a crash never applies a batch twice. A consumer that restarts resumes from its offset.
- **Two ways to write.** Senses and Reflex emit through the Tape writer: buffered (`TAPE_BATCH_MS`), flushed one batch at a time, so commit order equals `seen_time` order. Deciders (desk, scorekeeper) write with `emitIn` inside their consumer transaction, so a decision and the offset commit together. A derived event's `seen_time` is at least 1 ms after its cause (exactly 1 ms in replay).
- **One writer per consumer.** A consumer reads topics from a single writer (the Tape writer, or one decider). Mixing writers could let a late commit land behind an offset and be skipped.
- **Inputs and derived topics.** Inputs are what the world told us: observations, coins, callouts, callers, trades, sessions, and recorded `jev.answer`. Derived topics are our own decisions: `intent.*`, `order.*`, `position.*`, `markout.*`, `commit.*`, `strategy.*`, `kernel.*`, `outcome.*`, `score.*`. A replay loads inputs and re-derives the rest.
- **Rebuild.** `ctl rebuild` clears pure projections (`mem.*`, `board.signals`) and their offsets; they refill from the Tape. Deciders are never re-run over old Tape (they would write their decisions twice). Their exact rebuild is a replay into a fresh database.
- Recorded tapes are exported as gzipped NDJSON files (`tape-<from>-<to>.ndjson.gz`) to object storage. Small ones become E2E fixtures.

## The Board

- A table `signals` (append-only history) plus a view `board` with the latest live signal per `(kind, subject)`.
- A signal has `kind` (for example `hawkes.branching`, `regime.state`, `echo.score`, `swarm.wave_p`), `subject` (an ID such as `cn_...` or `cl_...`), `value` (number or small JSON), `confidence` 0..1, `produced_at`, `valid_until`, `inputs` (event and signal IDs), and `analyzer@version`.
- **A signal past `valid_until` is absent.** Decisions treat absent as unknown and must still work. This is what makes the beats simultaneous: nothing waits for a slow analyzer. When MiroShark finishes in 4 minutes, its signal appears on the Board and the next Strategy Pool tick uses it.
- Every Board read is a SQL query on `board.signals` (`board/board.ts`). There is no in-memory mirror.

## Analyzers

An analyzer is an always-on module that subscribes to topics and emits signals. Analyzers never call each other. They only meet on the Tape and the Board.

Each analyzer ships a manifest:

```yaml
analyzer: hawkes
version: 3
lang: ts            # ts | py
subscribes: [callout.created, callout.update.created]
emits: [hawkes.intensity, hawkes.branching, hawkes.wave_p]
cadence: event      # event | every:<duration> | on-demand
cost: cheap         # cheap | reflex | metered
budget: null        # for metered analyzers: tokens/hour, usd/hour, runs/hour
scorer: wave_p_brier_2h
failure_modes: docs/07-intelligence.md#hawkes
```

Rules:

- `cheap` analyzers run on everything. `reflex` analyzers (Jev packs) run on their triggers within their token budget. `metered` analyzers (BettaFish, MiroShark, X Reader, deep session reads) run only when **Attention** grants them a job.
- Every analyzer has a scorer. An analyzer whose signals do not improve strategy results over 14 days gets flagged for removal (`ctl analyzers --useless`).
- Adding an analyzer means adding a manifest, a module and a "Ways it fails" list in its doc section, written before the code. Nothing else changes.

## Two speeds

| | System One | System Two |
|---|---|---|
| Analyzers | math analyzers, Reflex (Jev packs), Guard | BettaFish, MiroShark |
| Speed | ms to 150 ms | 30 s to minutes |
| Runs | on every relevant event | only when the escalation gate fires (docs/17) |
| Used by | all strategies, including `fast` horizon ones | `medium` and `slow` strategies, through `missing: skip` |

The escalation gate decides when System Two runs. Attention then ranks the escalations by value of information. Fast trades never wait for System Two.

## Attention (what to spend on)

Attention decides where the expensive things go: session tasks, BettaFish deep runs, MiroShark swarms, X Reader lookups.

For each candidate job it estimates **value of information**:

```
VOI = P(decision changes | new info) × |expected PnL difference| − cost
```

In v1 the estimate is simple and explicit (see `07-intelligence.md`): coins in Stirring or Ignition with a live intent near threshold get the most VOI. Attention writes `attention.grant` events, so its choices are on the Tape and visible in the Field.

## The Mind

- **Strategy Pool:** a population of strategies. Every Strategy Pool tick (each new Board change for a coin, plus every 5 s) each strategy evaluates its rules and may emit an Intent. Every intent is ghost-traded (paper) for scoring, whether it gets capital or not.
- **Allocator:** decides which intents get real capital. Thompson sampling over each strategy's posterior of net return per trade.
- **Risk Gate:** pure function `(intent, book, limits, quote, flags) → ok | rejection(reason)` (`mind/risk.ts`). No network, no LLM. Every rejection is an event with a reason code. The limits come from `mind.limits`, which nothing writes yet, so the defaults in code are the live set until the admin path exists (docs/25 I5).

Details: `08-mind-strategy-evolution.md`.

## Hands

Hands consume orders and posts, act on the world, and write Effects as events. They are the only parts that touch money or speak in public. Each hand must be idempotent by order id, so a restart never double-buys or double-posts. Today the Trader can send twice after a confirm timeout, and the live side follows paper intents rather than paper positions; docs/25 sections 5.2 and 5.3 give the target and the gaps.

## Clock and modes

| Mode | Senses | Hands | Clock |
|---|---|---|---|
| `replay` | Tape file | Simulated (fills from curve math) | Virtual, as fast as possible |
| `paper` | Live | Simulated | Wall clock |
| `live` | Live | Real | Wall clock |

All code reads time from the Clock, never from `Date.now()` or `time.time()`. The mode is set at process start by the human (`ASIMOG_MODE`). Code never switches mode.

## Budgets

Every metered call writes a `budget.spent` event: analyzer, units (tokens, USD, RPC credits, sim runs), and the job it served. Each analyzer has an hourly cap in config. Hitting a cap emits `budget.exhausted` and the analyzer sleeps until the next hour. `ctl budget` shows spend vs value per analyzer.

## Scorecards

The Scorekeeper resolves outcomes at the compressed horizons in `OUTCOME_HORIZONS_MIN` (1, 3, 5 min by default; docs/07) and writes scores:

- Signal scores: Brier score for probabilities, error for values.
- Strategy scores: net return per trade, follower PnL, drawdown, hit rate.
- Analyzer scores: lift in strategy results when the analyzer's signals are used.
- Session scores: how often a session read changed a decision.

Scores feed the Allocator, the Strategy Pool's selection and the "useless analyzer" flag.

## Evidence classes

Everything the agent says publicly belongs to exactly one class, and pages, case files and data replies keep the classes apart:

| Class | Is | Example | May be stated as |
|---|---|---|---|
| Observed | An input event as a sense recorded it, with its source and times | a callout, a trade, a gap | fact about what we saw |
| Computed | A deterministic number from observed events, with a methodology version | `outcome.measured`, ledgers, indicators | fact, with its denominator and coverage |
| AI judgment | A recorded model answer (Jev, System Two) | `jev.callout.promo` | "the model judged ..." |
| Hypothesis | A claim committed before its outcome (commit-reveal) | a forecast | "we expect ...", revealed later |
| Outcome | What happened to a claim or a callout afterwards | a reveal, a resolved outcome | fact, with corrections kept |

Rules: an AI judgment never becomes a computed fact; an indicator is never called proof; a temporal association is never called a cause; an account's wallet is never called a person.

## The `core` CLI (and MCP mirror)

One binary for humans and agents. The LangGraph agents use the same commands as MCP tools. Every command takes `--json`. Same names as MCP tools.

| Command | Does |
|---|---|
| `ctl state` | The agent's mind in about 2k tokens: mode, health, capital, open positions, top coins with key signals, active swarms, budgets. Built for an LLM context window. |
| `ctl tail [topic...]` | Stream events. |
| `ctl why <id>` | Walk the noun chain back to the observations. Prints a tree. |
| `ctl board [subject]` | Live signals for a coin, caller or all. |
| `ctl coin <mint\|cn_id>` / `ctl caller <id>` | Projection plus recent events. |
| `ctl case <callout_id> [--md]` | The case file for one callout (docs/07). |
| `ctl callers [--h 5]` | The caller ledger, methodology `cl1` (docs/07). |
| `ctl coverage` | Gaps per source, coins called vs. coins with trades, outcomes per coverage status, trades per collector and their overlap, callouts announced by the author's buy. |
| `ctl house [--h 5] [--n 20]` | The house's ledger row next to the crowd baseline, and its latest paper posts (docs/09). |
| `ctl analyzers` | Analyzer list, status, last signal, score, budget. `--useless` flags low-value analyzers. |
| `ctl jev <pack> <subject> [--dry]` | Show the state Reflex would send and the last answers; `--dry` prints without calling Jev. |
| `ctl sessions` | 8 sessions: current task, URL, frame rate, health. |
| `ctl strategies [ls\|show\|diff\|lineage]` | Strategies, scores, capital. |
| `ctl propose <strategy.json>` | Submit a strategy. It enters as a ghost. It never gets capital directly. |
| `ctl replay <tape> [--report]` | Run a tape through the full system. Writes the report artifact. |
| `ctl budget` | Spend vs value. |
| `ctl doctor` | Health checks with fix hints. |
| `ctl pause <analyzer\|hands\|all>` / `ctl resume` | Stop parts safely. |
| `ctl kill` | Kill switch: cancel orders, stop hands, keep senses recording. |

`pause` on hands and `kill` work for any caller. `resume` after `kill` and any change to limits need the human (a separate admin token).

## What the thinking agents plug into

The thinking agents run on LangGraph JS in the `agents` process (docs/18). Each agent loads only its own tools from the core MCP server:

- Read: `ctl state`, `why`, `board`, `tail`, `analyzers`, `strategy pool`, `budget`, `doctor`.
- Write, by capability: `ctl propose` (strategies enter as ghosts), Jev question proposals (enter in shadow), `ctl pause`, `ctl kill`, publishing the daily Daily Report and Integrity prose.
- What none of them can ever do: place orders, change limits, change mode, sign anything, post outside Publisher's queue.

## Why this shape is cheap

- Cheap math and Jev run everywhere, and expensive minds run only when the escalation gate fires and Attention says it pays.
- Every Jev and LLM answer is on the Tape, so no answer is ever paid for twice in a replay.
- No analyzer re-derives what another already wrote on the Board.
- `ctl state` is designed so an LLM reads one page instead of crawling tables.
- Replays let you test any idea against real history without paying for live data again.
