# 03 · System model

This doc defines how OCTOPUS is shaped so that an agent (human or LLM) can understand the whole system from a few commands and change one part without breaking the others. Read it before writing any code.

## The design question

> If I were the agent driving this system, what would let me see the true situation fast, act with the least wasted money and tokens, and improve it safely?

Answers, each one a rule below:

1. One place to look for what happened (the **Tape**).
2. One place to look for what is believed now (the **Board**).
3. One gate every action passes (the **Risk Gate**).
4. Every object has a typed ID and links to its causes (**why-chains**).
5. Every belief is scored later against what happened (**Scorecards**).
6. Every cost is metered (**Budgets**).
7. One command surface does everything (the **`octo` CLI**, mirrored as MCP tools).
8. The same code runs live, paper and replay (the **Clock**).

## The tower

Each layer only reads from the layer below and only writes to its own outputs. Arrows go up.

```
L7  Skin      website rooms, frame relay, public SSE          reads: L2-L6 projections
L6  Hands     Executor, Herald, Treasury                       reads: Orders, Posts      writes: Effects (events)
L5  Mind      Brood (genomes), Allocator, Risk Gate            reads: Board              writes: Intents, Orders
L4  Organs    System One: Hawkes, Regime, Curve, Echo, Age,    reads: Tape, Memory       writes: Signals (Board)
              Shadows, Reflex (Jev packs), Fly
              System Two: Synthesis (BettaFish), Swarm (MiroShark)
L3  Memory    entities, bars, graph projections                reads: Tape               writes: projections
L2  Tape      append-only typed events                         reads: Senses, Hands      writes: Events
L1  Senses    Feed Tap, Tentacles T1-T8, Chain Ear, X Eye       reads: the world          writes: Observations → Events
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
| Signal | A belief about a subject with value, confidence and expiry | Organs | No (new signal supersedes old) | `sg_` |
| Intent | A genome wants to act | Brood | No | `in_` |
| Order | An intent that passed the Risk Gate | Risk Gate | No | `or_` |
| Effect | What the hands did: a fill, a post, a sweep, a payout | Hands | No | `ef_` |
| Outcome | What happened afterwards, at a horizon | Scorekeeper | No | `oc_` |
| Score | How good a signal, genome or organ was | Scorekeeper | No | `sc_` |

Other IDs: `gn_` genome, `ps_` position, `tn_` tentacle task, `sw_` swarm run, `sy_` synthesis run, `bt_` budget entry, `st_` seat, `dp_` deposit order, `ds_` distribution, `sp_` fee sweep.

IDs are ULIDs with the prefix (`sg_01JA...`). Sortable by time, and the prefix tells any reader what the object is.

## The Tape

- A single Postgres table `events`, append-only. No `UPDATE`, no `DELETE`. A database role without those rights writes it.
- Every event has `event_time` (when it happened in the world) and `seen_time` (when OCTOPUS learned it). Replays order by `seen_time`. Organs must never read an event whose `seen_time` is after the clock's `now`.
- Every event has a `topic` (for example `callout.created`, `trade.curve`, `tentacle.read`, `order.filled`) and a JSON `body` that matches a schema in `packages/contracts`.
- Consumers keep their own offset in `consumer_offsets`. Postgres `NOTIFY events_<topic>` wakes them. A consumer that restarts resumes from its offset. Consumers are idempotent by event id.
- Recorded tapes are exported as gzipped NDJSON files (`tape-<from>-<to>.ndjson.gz`) to object storage. Small ones become E2E fixtures.

## The Board

- A table `signals` (append-only history) plus a view `board` with the latest live signal per `(kind, subject)`.
- A signal has `kind` (for example `hawkes.branching`, `regime.state`, `echo.score`, `swarm.wave_p`), `subject` (an ID such as `cn_...` or `cl_...`), `value` (number or small JSON), `confidence` 0..1, `produced_at`, `valid_until`, `inputs` (event and signal IDs), and `organ@version`.
- **A signal past `valid_until` is absent.** Decisions treat absent as unknown and must still work. This is what makes the beats simultaneous: nothing waits for a slow organ. When MiroShark finishes in 4 minutes, its signal appears on the Board and the next Brood tick uses it.
- The Board keeps an in-memory mirror in the `octo` process, updated from the `signals.created` notification.

## Organs

An organ is an always-on module that subscribes to topics and emits signals. Organs never call each other. They only meet on the Tape and the Board.

Each organ ships a manifest:

```yaml
organ: hawkes
version: 3
lang: ts            # ts | py
subscribes: [callout.created, callout.update.created]
emits: [hawkes.intensity, hawkes.branching, hawkes.wave_p]
cadence: event      # event | every:<duration> | on-demand
cost: cheap         # cheap | reflex | metered
budget: null        # for metered organs: tokens/hour, usd/hour, runs/hour
scorer: wave_p_brier_2h
failure_modes: docs/07-intelligence.md#hawkes
```

Rules:

- `cheap` organs run on everything. `reflex` organs (Jev packs) run on their triggers within their token budget. `metered` organs (BettaFish, MiroShark, X Eye, deep tentacle reads) run only when **Attention** grants them a job.
- Every organ has a scorer. An organ whose signals do not improve genome results over 14 days gets flagged for removal (`octo organs --useless`).
- Adding an organ means adding a manifest, a module and a "Ways it fails" list in its doc section, written before the code. Nothing else changes.

## Two speeds

| | System One | System Two |
|---|---|---|
| Organs | math organs, Reflex (Jev packs), Guard | BettaFish, MiroShark |
| Speed | ms to 150 ms | 30 s to minutes |
| Runs | on every relevant event | only when the escalation gate fires (docs/17) |
| Used by | all genomes, including `fast` horizon ones | `medium` and `slow` genomes, through `missing: skip` |

The escalation gate decides when System Two runs. Attention then ranks the escalations by value of information. Fast trades never wait for System Two.

## Attention (what to spend on)

Attention decides where the expensive things go: tentacle tasks, BettaFish deep runs, MiroShark swarms, X Eye lookups.

For each candidate job it estimates **value of information**:

```
VOI = P(decision changes | new info) × |expected PnL difference| − cost
```

In v1 the estimate is simple and explicit (see `07-intelligence.md`): coins in Stirring or Ignition with a live intent near threshold get the most VOI. Attention writes `attention.grant` events, so its choices are on the Tape and visible in the Tank.

## The Mind

- **Brood:** a population of genomes. Every Brood tick (each new Board change for a coin, plus every 5 s) each genome evaluates its rules and may emit an Intent. Every intent is ghost-traded (paper) for scoring, whether it gets capital or not.
- **Allocator:** decides which intents get real capital. Thompson sampling over each genome's posterior of net return per trade.
- **Risk Gate:** pure function `(intent, portfolio, limits, board) → order | rejection(reason)`. No network, no LLM. Every rejection is an event with a reason code.

Details: `08-mind-strategy-evolution.md`.

## Hands

Hands consume orders and posts, act on the world, and write Effects as events. They are the only parts that touch money or speak in public. Each hand is idempotent by order id. A restart never double-buys or double-posts.

## Clock and modes

| Mode | Senses | Hands | Clock |
|---|---|---|---|
| `replay` | Tape file | Simulated (fills from curve math) | Virtual, as fast as possible |
| `paper` | Live | Simulated | Wall clock |
| `live` | Live | Real | Wall clock |

All code reads time from the Clock, never from `Date.now()` or `time.time()`. The mode is set at process start by the human (`OCTO_MODE`). Code never switches mode.

## Budgets

Every metered call writes a `budget.spent` event: organ, units (tokens, USD, RPC credits, sim runs), and the job it served. Each organ has an hourly cap in config. Hitting a cap emits `budget.exhausted` and the organ sleeps until the next hour. `octo budget` shows spend vs value per organ.

## Scorecards

The Scorekeeper resolves outcomes at fixed horizons (5 m, 30 m, 2 h, 6 h) and writes scores:

- Signal scores: Brier score for probabilities, error for values.
- Genome scores: net return per trade, follower PnL, drawdown, hit rate.
- Organ scores: lift in genome results when the organ's signals are used.
- Tentacle scores: how often a tentacle read changed a decision.

Scores feed the Allocator, the Brood's selection and the "useless organ" flag.

## The `octo` CLI (and MCP mirror)

One binary for humans and agents. The LangGraph agents use the same commands as MCP tools. Every command takes `--json`. Same names as MCP tools.

| Command | Does |
|---|---|
| `octo state` | The octopus's mind in about 2k tokens: mode, health, capital, open positions, top coins with key signals, active swarms, budgets. Built for an LLM context window. |
| `octo tail [topic...]` | Stream events. |
| `octo why <id>` | Walk the noun chain back to the observations. Prints a tree. |
| `octo board [subject]` | Live signals for a coin, caller or all. |
| `octo coin <mint\|cn_id>` / `octo caller <id>` | Projection plus recent events. |
| `octo organs` | Organ list, status, last signal, score, budget. `--useless` flags low-value organs. |
| `octo jev <pack> <subject> [--dry]` | Show the state Reflex would send and the last answers; `--dry` prints without calling Jev. |
| `octo tentacles` | 8 sessions: current task, URL, frame rate, health. |
| `octo brood [ls\|show\|diff\|lineage]` | Genomes, scores, capital. |
| `octo propose <genome.json>` | Submit a genome. It enters as a ghost. It never gets capital directly. |
| `octo replay <tape> [--report]` | Run a tape through the full system. Writes the report artifact. |
| `octo budget` | Spend vs value. |
| `octo doctor` | Health checks with fix hints. |
| `octo pause <organ\|hands\|all>` / `octo resume` | Stop parts safely. |
| `octo kill` | Kill switch: cancel orders, stop hands, keep senses recording. |

`pause` on hands and `kill` work for any caller. `resume` after `kill` and any change to limits need the human (a separate admin token).

## What the thinking agents plug into

The thinking agents run on LangGraph JS in the `agents` process (docs/18). Each agent loads only its own tools from the octo MCP server:

- Read: `octo state`, `why`, `board`, `tail`, `organs`, `brood`, `budget`, `doctor`.
- Write, by capability: `octo propose` (genomes enter as ghosts), Jev question proposals (enter in shadow), `octo pause`, `octo kill`, publishing the daily Tide Report and Hunt prose.
- What none of them can ever do: place orders, change limits, change mode, sign anything, post outside Herald's queue.

## Why this shape is cheap

- Cheap math and Jev run everywhere, and expensive minds run only when the escalation gate fires and Attention says it pays.
- Every Jev and LLM answer is on the Tape, so no answer is ever paid for twice in a replay.
- No organ re-derives what another already wrote on the Board.
- `octo state` is designed so an LLM reads one page instead of crawling tables.
- Replays let you test any idea against real history without paying for live data again.
