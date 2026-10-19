# B6b: One partition lands in two archive targets with matching checksums

Mode: B · Writer: subagent (sonnet) · Depends on: B6-archiver · PLAN row: B6b

## Current behavior
Expected after B6-archiver: one local folder only (`services/core/src/tape/archiver.ts`).

## Required behavior
An `ArchiveTarget` interface (`put(file)`, `verify(name, sha256)`) with three kinds chosen in `config/retention.json`: local folder, S3-compatible bucket (SigV4 signed with `node:crypto`, no SDK), git repository (commit and push on a schedule). The archiver drops a partition only after every configured target verified.

## Invariants
Keys and URLs only in `.env.local`. No new dependency without a row in `docs/DECISIONS.md`.

## Write list
`services/core/src/tape/targets.ts` (new), `services/core/src/tape/archiver.ts`, slow suite `tests/e2e/suites/archive-targets/` (local folder plus a local bare git repo), `docs/OPS.md` section 2. Request: the suite line.

## Read first
`archiver.ts`, `docs/OPS.md` section 2 (tier 5).

## Forbidden
Shared files owned by the top agent unless listed above (see `_template.md`).

## Acceptance
`npm run e2e -- archive-targets` prints `ok   both targets hold the file with the same sha256` and `ok   a failing target blocks the drop`. The S3 kind is reported not run unless a test bucket is set in `.env.local`.

## Out of scope
Pruning old archive files.

## Return
`git diff --stat`; each command run with its result; what was not run and why. Echo the write list first; stop if you need a file outside it.

## State
Passed 2026-10-19. `npm run e2e -- archive-targets` passed: local, S3 (signed PUT against a local endpoint) and git targets all hold the same bytes; a failing target leaves the partition in place and reports the error. `pnpm typecheck` clean. The S3 endpoint and keys stay in env; config only names the bucket, region and prefix.
