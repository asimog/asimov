# A1-restart: A replay with every consumer restarted halfway derives the same hash as one without

Mode: C · Writer: top agent · Depends on: none

## Current behavior
Observed: the restart check failed once (precall-replay run of 2026-10-19, hash 7c7abfbe vs 16fa2b42) because a rebuild re-forked each consumer's random stream. Fixed in 2cf6401: `Clock.fork` remembers its forks (`services/core/src/lib/clock.ts`). The check now lives in `tests/e2e/suites/replay-determinism/suite.ts` and has not run since.

## Required behavior
The restart hash equals the main hash on `discovery-2m`.

## Invariants
Replay determinism; no change to consumer logic to make the hash match.

## Write list
None unless the check fails; then the cause's file, after saying why it fails.

## Read first
`services/core/src/lib/clock.ts`, `tests/e2e/lib/replay.ts`, `tests/e2e/suites/replay-determinism/suite.ts`.

## Forbidden
Shared files owned by the top agent (see `_template.md`).

## Acceptance
`npm run e2e -- replay-determinism` prints `ok   a restart halfway gives the same derived hash`.

## Out of scope
The live-leg checks in the same suite (task A13).

## Return
`git diff --stat`; commands run with results; what was not run and why.

## State
Done 2026-10-19: `npm run e2e -- replay-determinism` printed `ok   a restart halfway gives the same derived hash: 1f5ae2a7a28bb9f5 vs 1f5ae2a7a28bb9f5`. No code change. The live-leg fill check failed (`ledger.entry:1`); that is A13.

Its tape was deleted with the other old tapes on 2026-10-19 (owner). Re-run in G0 on the new 2-minute tape.
