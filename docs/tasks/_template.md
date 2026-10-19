# <ID>: <one observable result, no "and">

Mode: A | B | C · Writer: top agent | subagent (model from `~/.claude/rules/pstack-models.md`) · Depends on: <ids or none> · PLAN row: <id>

## Current behavior
What happens now, with `file:line` or a report path. Mark each line observed or suspected.

## Required behavior
What must happen after the change, including the failure cases.

## Invariants
What must stay true (Tape append-only, replay determinism, Risk Gate authority, no new dependency, public contracts).

## Write list
The only files this task may edit.

## Read first
A short list of files to read before editing. Not "the docs".

## Forbidden
Shared files owned by the top agent unless listed above: `services/core/src/runtime.ts`, `packages/contracts/`, `services/core/src/sql/schema.sql`, `tests/e2e/main.ts`, `tests/e2e/suites.ts`, `docs/PLAN.md`, `docs/DECISIONS.md`. Need one changed? Return the exact change as a request.

## Acceptance
The exact command(s) and the output line that proves it.

## Out of scope
Tempting neighbors not to touch.

## Return
`git diff --stat`; each command run with its result; what was not run and why; open questions. Echo the write list before starting; stop if you need a file outside it.

## State
Filled in as the task moves: started, blocked, result, commit.
