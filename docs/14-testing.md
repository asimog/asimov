# 14 · Testing

## Rules (from AGENTS.md)

- Never write unit tests after writing code.
- E2E tests are the main and preferred way to test. They prove complex features work.
- Every E2E test ends with a verifiable, repeatable artifact.
- If a part must be tested in isolation, first write every way it could fail (in its doc's "Ways it fails" list), then write the code, then the isolated test for those failures.

## Why replays are the backbone

The whole system is driven by the Tape. A recorded tape plus the Clock in `replay` mode reruns real history through all analyzers, the Strategy Pool, the Risk Gate and simulated hands. Same tape, same code, same report hash. So most E2E tests are replays, and they cost nothing to rerun.

## Suite layout

```
tests/e2e/
  fixtures/tapes/        small recorded tapes (≤ 20 MB each, gzipped NDJSON), committed
  fixtures/har/          redacted HAR samples for adapter tests
  suites/<name>/         one folder per suite: run script, expectations, README with what it proves
  lib/                   replay driver, artifact writer, site checker (agent-browser)
artifacts/e2e/<suite>/<run-id>/   gitignored outputs
```

Large tapes live in object storage and are fetched by hash.

## How to run

```
npm run e2e                       # every suite
npm run e2e strategies-replay     # one suite
E2E_TAPE=path/to/tape.ndjson.gz npm run e2e
```

The runner (`tests/e2e/run.ts`) replays the tape once per run and shares it between replay suites. The replay driver (`tests/e2e/lib/replay.ts`):

1. Creates a fresh database `asimog_e2e_<tag>_<id>` next to the working one and migrates it. The working database is never touched. Replay databases are kept after the run (the runner prints their names); removing them is the owner's call.
2. Loads the tape's input events (derived topics are skipped and re-derived, docs/03).
3. Cuts the network: `fetch` throws and is counted. Reflex never calls Jev in replay; it reads the recorded `jev.answer` events.
4. Steps every consumer from `buildConsumers` (the same list `core` runs live) in 1 s windows of Tape time, in order: memory, analyzers (cheap, flow and pre-call), reflex, desk, publisher, scorekeeper.

Suites today:

| Suite | Proves |
|---|---|
| `riskgate-refuses` | 20 cases: every one of the 14 reason codes fires on its bad intent; clean intents pass |
| `analyzers-replay` | All 15 signal kinds appear; one Jev signal set per recorded answer; outcomes at 1, 3, 5 min; Brier scores |
| `strategies-replay` | 30 seeds load; every intent is gated, filled or pending; positions close with rent refunded; markouts; allocation rounds |
| `commit-reveal` | Every reveal recomputes to its committed hash and came after it (at least `E2E_MIN_REVEALS`, 20 for the 10 min tape) |
| `evolution-replay` | Offspring are born from parents with trades, all valid, no near-duplicates, lineage recorded |
| `replay-determinism` | Two replays in two fresh databases hash identically over derived events and signals |
| `callout-case-replay` | Callout tracking v2 (docs/07). Every outcome is `ov2` with a coverage status. The caller ledger's denominators add up and losing calls are in it. The worst `ok` call's case file (`case.md`, `case.json` in the artifact) has the six evidence sections, fences the callout text, and rebuilds byte-identical. An injected `trades` gap, reported late, marks overlapping outcomes `gap` by supersede and keeps the originals. A consumer restart halfway gives the same derived hash as an uninterrupted replay. Duplicate trades sent through the Tape writer with sense dedupe keys are written once. `E2E_RESTART_AT` (default 0.5) moves the restart point; 0.23, 0.5 and 0.81 were checked on 2026-10-17 |

Fixture: `tests/e2e/fixtures/tapes/discovery-10m.ndjson.gz` (10 min of live feed, pushes and trades, recorded by the real readers on 2026-10-17; 18,062 events, 381 callouts each with a recorded Jev answer, 3.1 MB).

## Artifact format

Every suite writes:

| File | Content |
|---|---|
| `report.json` | Inputs (tape hash, code commit, config hash), checks with pass or fail, metrics |
| `report.html` | The same, readable, with charts when useful |
| `sha256.txt` | Hash of `report.json` without the run timestamp |
| other files | Suites may write named files (for example `case.md`); their sha256 values are listed in `report.json`, so they are covered by `sha256.txt` |
| `screens/` | Screenshots for site suites (desktop 1440×900, phone 390×844) |

Repeatable means: same tape hash + same commit + same config hash → same `sha256.txt`. `e2e/replay-determinism` checks this on every change to `services/core`.

## Kinds of suites

| Kind | How | Example |
|---|---|---|
| Replay | Tape through the full system | `analyzers-replay`, `strategies-replay`, `distribution-replay` |
| Live capture | Run live for a window, export the tape, replay, compare | `live-capture-30m` |
| Chaos | Kill or block a part during a run, check recovery | `gap-heal`, `session-crash` |
| Site | agent-browser drives the website, screenshots, checks shown data against the database | `site-field`, `site-labs` |
| Money | Tiny real transactions (0.01 SOL), compared to the chain | `live-roundtrip`, `sweep` |
| Refusal | A list of things that must be refused | `signer-refuses`, `riskgate-refuses` |
| Golden | Outputs compared to a reference implementation | `amm-golden` (Python curve vs pump-sdk) |

## Checks that run on every replay

1. No lookahead: every signal's inputs have `seen_time` ≤ `produced_at`. `caller.dna` lists the outcome events it used as inputs, so this check covers caller features too.
2. Why-chains complete: every intent, order and post reaches at least one observation.
3. No orphan effects: every `order.filled` has an `order.created`, every `post.published` has a `post.queued`.
4. Budgets respected: no analyzer spends over its cap.
5. Risk Gate: no order exceeds the limits version it cites.
6. No live model calls: replays read `jev.answer` and recorded LLM outputs from the tape. Any network call to Jev, OpenRouter or an RPC during a replay fails the suite (what-if replays use the keyed cache and say so in the report).
7. Lanes respected: no event was written by a source outside its capability (docs/18).

## Before saying done

- Run the relevant suites and read the output yourself.
- Report which suites ran, their artifact paths, and any you did not run.
