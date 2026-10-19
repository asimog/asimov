# A8-heap: Core's heap stays flat over a 30-minute paper smoke

Mode: B · Writer: subagent (sonnet) for the diagnosis, top agent for the fix · Depends on: none

## Current behavior
Observed: heap 124 to 305 MB, RSS 283 to 515 MB in 30 min; rollup coins in memory 4,306 (`artifacts/smoke/a8b/core.log`). The Scout hot set and `Rollup.known` are bounded already.

## Required behavior
Find what grows (heap snapshot at 5 and 25 min, `node --heapsnapshot-signal`), bound it, and show heap within 20% between minute 10 and minute 30.

## Invariants
No behaviour change in the Index numbers.

## Write list
Diagnosis: none (return the top retainers with sizes). Fix: the file that holds the growing structure.

## Read first
`services/core/src/index/rollup.ts` (`coins`, `after`, `wc`), `services/core/src/senses/scout.ts`, `services/core/src/runtime.ts` stats.

## Forbidden
Shared files owned by the top agent (see `_template.md`).

## Acceptance
A 30-minute smoke (`STATS_EVERY_MS=60000 timeout 1800 npx tsx services/core/src/main.ts > artifacts/smoke/a8c/core.log`) whose `mem_mb.heap` at minute 30 is within 20% of minute 10. Soak tier: run alone.

## Out of scope
RSS tuning, GC flags.

## Return
`git diff --stat`; commands run with results; what was not run and why.

## State
Open.
