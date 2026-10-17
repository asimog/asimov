# 14 · Testing

## Rules (from AGENTS.md)

- Never write unit tests after writing code.
- E2E tests are the main and preferred way to test. They prove complex features work.
- Every E2E test ends with a verifiable, repeatable artifact.
- If a part must be tested in isolation, first write every way it could fail (in its doc's "Ways it fails" list), then write the code, then the isolated test for those failures.

## Why replays are the backbone

The whole system is driven by the Tape. A recorded tape plus the Clock in `replay` mode reruns real history through all organs, the Brood, the Risk Gate and simulated hands. Same tape, same code, same report hash. So most E2E tests are replays, and they cost nothing to rerun.

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

## Artifact format

Every suite writes:

| File | Content |
|---|---|
| `report.json` | Inputs (tape hash, code commit, config hash), checks with pass or fail, metrics |
| `report.html` | The same, readable, with charts when useful |
| `sha256.txt` | Hash of `report.json` without the run timestamp |
| `screens/` | Screenshots for site suites (desktop 1440×900, phone 390×844) |

Repeatable means: same tape hash + same commit + same config hash → same `sha256.txt`. `e2e/replay-determinism` checks this on every change to `services/octo`.

## Kinds of suites

| Kind | How | Example |
|---|---|---|
| Replay | Tape through the full system | `organs-replay`, `brood-replay`, `distribution-replay` |
| Live capture | Run live for a window, export the tape, replay, compare | `live-capture-30m` |
| Chaos | Kill or block a part during a run, check recovery | `gap-heal`, `tentacle-crash` |
| Site | agent-browser drives the website, screenshots, checks shown data against the database | `site-tank`, `site-labs` |
| Money | Tiny real transactions with pre-coin limits, compared to the chain | `live-roundtrip`, `sweep` |
| Refusal | A list of things that must be refused | `signer-refuses`, `riskgate-refuses` |
| Golden | Outputs compared to a reference implementation | `amm-golden` (Python curve vs pump-sdk) |

## Checks that run on every replay

1. No lookahead: every signal's inputs have `seen_time` ≤ `produced_at`.
2. Why-chains complete: every intent, order and post reaches at least one observation.
3. No orphan effects: every `order.filled` has an `order.created`, every `post.published` has a `post.queued`.
4. Budgets respected: no organ spends over its cap.
5. Risk Gate: no order exceeds the limits version it cites.
6. No live model calls: replays read `jev.answer` and recorded LLM outputs from the tape. Any network call to Jev, OpenRouter or an RPC during a replay fails the suite (what-if replays use the keyed cache and say so in the report).
7. Lanes respected: no event was written by a source outside its capability (docs/18).

## Before saying done

- Run the relevant suites and read the output yourself.
- Report which suites ran, their artifact paths, and any you did not run.
