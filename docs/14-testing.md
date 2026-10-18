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
| `signer-refuses` | Real transactions built with test keypairs: each forbidden shape (drain transfer, wrong signer, foreign program, token transfer, over-cap buy, bad token, wrong capability, public bind, kill file) is refused and logged; the allowed shapes sign; the audit chain verifies |
| `books-reconcile` | A scripted day on a mocked chain (deposit, buys, sells, rent, sweeps) in a fresh database: ledger balances equal chain balances to the lamport; an injected 1-lamport difference fails the hour and trips the kill; FIFO PnL and NAV match hand-computed values; the ledger rebuilds identically from the Tape; proofs chain and verify |
| `sweep` | Three sweeps (one empty) on the mocked chain: the split matches chain amounts, base capital is not profit, a half-landed split is resumed without paying twice |
| `kill` | Trading roundtrip works, then each trigger (owner, daily loss, three signer refusals, feed gap, failed reconciliation) stops new orders; senses keep writing; resume needs the admin token |
| `live-roundtrip` (`live-*`) | Skipped unless `LIVE_TEST=1` and the owner has set keys. 0.01 SOL buy, sell, account closed, rent back, books reconcile |
| `analyzers-replay` | All 15 signal kinds appear; one Jev signal set per recorded answer; outcomes at 1, 3, 5 min; Brier scores |
| `strategies-replay` | 30 seeds load; every intent is gated, filled or pending; positions close with rent refunded; markouts; allocation rounds |
| `commit-reveal` | Every reveal recomputes to its committed hash and came after it (at least `E2E_MIN_REVEALS`, 20 for the 10 min tape) |
| `evolution-replay` | Offspring are born from parents with trades, all valid, no near-duplicates, lineage recorded |
| `replay-determinism` | Two replays in two fresh databases hash identically over derived events and signals |
| `callout-case-replay` | Callout tracking v2 (docs/07). Every outcome is `ov2` with a coverage status. The caller ledger's denominators add up and losing calls are in it. The worst `ok` call's case file (`case.md`, `case.json` in the artifact) has the six evidence sections, fences the callout text, and rebuilds byte-identical. An injected `trades` gap, reported late, marks overlapping outcomes `gap` by supersede and keeps the originals. A consumer restart halfway gives the same derived hash as an uninterrupted replay. Duplicate trades sent through the Tape writer with sense dedupe keys are written once. `E2E_RESTART_AT` (default 0.5) moves the restart point; 0.23, 0.5 and 0.81 were checked on 2026-10-17 |
| `site-shell` | Nine rooms load on desktop (1440 x 900) and phone (390 x 844): dark, no uncaught error, no sideways scroll; nav lists every room; footer says paper trading |
| `site-field`, `site-cortex`, `site-lab` | HUD numbers, region captions, caller links, tape lines, lane counters, Lab counters, arc marks and thesis hashes equal the relay API |
| `site-integrity` | Ledger rows equal the API; a case page prints every fact of `ctl case`, six sections in order, none mixing classes, callout text fenced |
| `site-treasury` | Balance, net, closed and reconciliation equal `/v1/treasury`; the proof chain recomputes from the Tape in the suite's own code; the page verifies every link |
| `site-rewind` | The Board at three times T equals an independent query and core's `liveFor`; nothing from after T; the slider shows the same counts |
| `site-cards` | 20 sample calls render 1200 x 630 PNG cards that differ; no caller named; PAPER position line |

Site suites drive headless Chrome through `tests/e2e/lib/site.ts` (DevTools protocol, no dependency; agent-browser hung on the owner's machine). They read the running relay (7401), web app (7402) and the working database, and write screenshots to `artifacts/e2e/<suite>/screens/` and card PNGs to `artifacts/e2e/site-cards/cards/`.

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
| Golden | Outputs compared to a reference implementation | `amm-golden` (TypeScript curve port vs pump-sdk) |

### Slow-mind suites (S7)

These need a fresh database but no tape. The LLM is a stub (`StubChat`, scripted per lane), so they run offline in seconds. Real model runs are separate, one short run per lane (`npm run agents:smoke`), and only when the lane's key is in `.env.local`.

| Suite | Proves |
|---|---|
| `bettafish-insight`, `bettafish-full` | The vendored BettaFish engines over our `slow.*` views with an offline stub model: the full plan, search, summary and reflection loop; Query and Media adapters; the forum host feeding back; cited claims kept and invented ids dropped by core (docs/24) |
| `amm-golden` | 1,000 buy and 1,000 sell quotes from the TS port equal `@pump-fun/pump-sdk` to the lamport |
| `miroshark-pumpfun` | The vendored MiroShark Wonderwall engine with the Pump.fun module and camel agents on a stub model: the holding rule, branches A and B, beliefs, swarm results and the SIMULATED report through the Slow Bridge (docs/24) |
| `slow-views`, `slow-bridge` | The read-only slow surface and the Bridge: shapes, role limits, `as_of`; one escalation feeds both engines, reports flow both ways, a dead engine fails cleanly |
| `agent-lanes` | The MCP tool list differs per token; out-of-lane calls and unknown tokens are refused; a no-op agent runs on schedule; the five graphs write only their own topics; a lane over its spend limit is refused; Guard checks refuse a person's name |
| `soul-update` | Valid updates make versions on a hash chain; protected parts, bad shapes and a tampered chain are refused |

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
