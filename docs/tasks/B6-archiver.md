# B6-archiver: A closed hot partition is archived, verified, dropped, and replays from its file

Mode: C · Writer: top agent · Depends on: B1, B6-partitions · PLAN row: B6

## Current behavior
Observed: `ctl` can export a tape window as gzipped NDJSON (`services/core/src/cli/ctl.ts:55`), by hand only. No archiver, no `tape.archived`; nothing is ever dropped.

## Required behavior
`services/core/src/tape/archiver.ts`, on the `schedules.json` timer: for each closed `inputs_hot` partition older than the `retention.json` hot window (4 h while testing), export to `tape-<class>-<hour>.ndjson.gz` in the local archive folder, re-read it and compare row count and sha256, write `tape.archived` (file, rows, sha256), check every offset in `tape.consumer_offsets` is past the partition, then drop it. Any failed step keeps the partition and writes `ops.alert`.

## Invariants
Never drop a partition whose file did not verify or that a consumer has not read. The replay harness can read archive files as a tape.

## Write list
`services/core/src/tape/archiver.ts` (new), `services/core/src/cli/ctl.ts` (share the export code), `services/core/src/runtime.ts` (one line), `packages/contracts/` (`tape.archived`), `tests/e2e/lib/replay.ts` (read an archive file), slow suite `tests/e2e/suites/tape-archive/`, `tests/e2e/suites.ts`, `docs/OPS.md` section 2.

## Read first
`ctl.ts:55-90`, `services/core/src/tape/consumer.ts` (offsets), `tests/e2e/lib/replay.ts`.

## Forbidden
Shared files owned by the top agent unless listed above (see `_template.md`).

## Acceptance
`npm run e2e -- tape-archive` with a 1-minute hot window on a test clock prints `ok   one partition archived and dropped`, `ok   a lagging consumer blocks the drop`, `ok   replay from the file gives the same derived hash`.

## Out of scope
Remote targets (B6b).

## Return
`git diff --stat`; each command run with its result; what was not run and why.

## State
Open.
