# B6-partitions: Tape rows land in hour-and-class partitions and row edits are refused

Mode: C (`schema.sql`, the Tape) · Writer: top agent · Depends on: none · PLAN row: B6

## Current behavior
Observed: `tape.events` is range-partitioned on `seen_time` but has only `tape.events_default` (`services/core/src/sql/schema.sql:25-26`). Nothing in the database refuses `UPDATE` or `DELETE`; append-only is a code rule only.

## Required behavior
Each row has a class (`inputs_hot`, `inputs_kept`, `derived`) taken from its topic in `TOPICS`. Partitions are per hour, then per class, created ahead by the Tape (the next 2 hours) so no insert falls into the default. A trigger refuses row `UPDATE` and `DELETE` on `tape.events`; dropping a whole partition stays possible, for the archiver only.

## Invariants
Event ids, dedupe and replay order unchanged. Fresh database only (no migration, per `AGENTS.md`). The working database `asimog` (1.7 GB of the old Tape, kept by the owner on 2026-10-19) is recreated empty at the end of this task, after the owner says yes in that session; test databases are always fresh.

## Write list
`services/core/src/sql/schema.sql`, `services/core/src/tape/tape.ts`, `packages/contracts/` (class per topic), fast suite `tests/e2e/suites/tape-partitions/`, `tests/e2e/suites.ts`, `docs/OPS.md` section 2.

## Read first
`schema.sql:1-60`, `tape.ts` (`flush`), the Tape rows in `docs/DECISIONS.md`.

## Forbidden
Shared files owned by the top agent unless listed above (see `_template.md`).

## Acceptance
`npm run e2e -- tape-partitions` prints `ok   an insert lands in its hour and class partition`, `ok   UPDATE on tape.events is refused`, `ok   DELETE on tape.events is refused`; then `npm run e2e -- tape-durable` still passes.

## Out of scope
The archiver (`B6-archiver.md`), database roles (F1).

## Return
`git diff --stat`; each command run with its result; what was not run and why.

## State
Open.
