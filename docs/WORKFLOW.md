# Workflow

How agents work on this repo. `AGENTS.md` holds the rules that never bend; test tiers and commands are in `OPS.md` section 9. This file is the only home for everything below.

## 1. Pick a mode first

Run `npm run preflight`. It reads your diff (or the paths you name) and prints the mode and the checks.

| Mode | When | Read | Checks |
|---|---|---|---|
| A, fast edit | One module, local behaviour, UI, docs | `AGENTS.md`, the target file, its direct callers | `npm run lint:changed`, `pnpm typecheck`, the one fast suite that covers it |
| B, subsystem | New analyzer, consumer, strategy behaviour, several files | Plus the one doc the subsystem lives in | Plus the slow suite that covers it, run by name |
| C, protected | Tape, Signer, Risk Gate, books, kill switch, `packages/contracts/`, `schema.sql`, money paths | Plus `docs/DECISIONS.md` rows that touch it | Plus failure cases (retry, crash, duplicate) and an adversarial read of the diff |

A small diff in a protected path is still mode C. Mode A never starts Docker, inspects databases, reads research or runs a replay unless the change needs it.

## 2. One task, one file, one session

- Every unit of work is a row in `docs/PLAN.md` that links a task file in `docs/tasks/` (template: `docs/tasks/_template.md`).
- One row per session. The session ends when that row's acceptance command has run and the result is in the row. Commit per row, with the check in the message.
- A task file has one observable. If its objective needs "and", it is two tasks.
- The current-behaviour field names a file and line. The acceptance field is a command and the line that proves it, never "verify it works".

## 3. Subagents

- No task file, no subagent. Paste or point to the file; never brief from memory.
- Roles: investigator (read-only, returns findings with file:line), writer (edits only its write list), verifier (runs the acceptance command, reports raw results).
- The writer echoes its write list before starting and stops if it needs any other file. It returns `git diff --stat`, the commands it ran with results, and what it did not run.
- One writer per file at a time. Fan out only over disjoint write lists.
- The top agent owns the shared files: `services/core/src/runtime.ts`, `packages/contracts/`, `services/core/src/sql/schema.sql`, `tests/e2e/main.ts`, `docs/PLAN.md`, `docs/DECISIONS.md`. A subagent that needs one changed returns the exact change as a request.
- Freeze shared interfaces (contracts, schema, runtime wiring) before dispatching writers.
- A retry is a fresh agent with the consolidated brief. Never resume an agent that went outside its write list.
- Models come from `~/.claude/rules/pstack-models.md`.

## 4. Context

- State lives on disk: the task file and the PLAN row. A resumed session reads those and the files they name, not the old chat.
- Checkpoint at 50% context or 90% of the plan limit, whichever comes first: write the row's state, commit, stop starting new work.
- Long runs (replays, smokes, servers) go to the background with output in a file. Read the tail once when it ends; never poll inside a turn.
- Keep `AGENTS.md` and `docs/WORKFLOW.md` unchanged during a session (prompt caching). Batch edits to them for the end.
- Read only the parts of a file a task needs; search first-party code first.

## 5. Vendor code

- The BettaFish and MiroShark engines are outside code. Lint and default search skip them, except our adapters.
- Open `services/<engine>/engine/VENDOR.md` first. It lists the adapter files we own, our patches, and the command to search upstream on purpose.
- Never edit upstream files outside the patches listed there. `.upstreamref/` is read-only prior art (see `AGENTS.md`).

## 6. Tests while prototyping

- Bare `npm run e2e` runs the fast tier only. Slow, soak and milestone suites run by name, when the task's mode calls for them.
- One test run at a time: the runner holds a lock. A timing taken beside another run is not a timing.
- A check that did not run is reported as not run, with the reason. Never report a skipped suite as passed.

## 7. Reporting

End every task with: what changed (observable), files with `git diff --stat`, commands run and results, what was not run and why, open risks. Use plain words; the owner is learning.
