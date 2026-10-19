# D phase: slow mind behind a real gate (kickoff brief)

The brief for the session that builds PLAN section D. Each row has its own detailed task file (`docs/tasks/D1.md` to `D7.md`): current behaviour with file:line, required behaviour, write list and acceptance lines. Read the task file before each row; this page covers only order, rules and open questions.

## What the D phase fixes, in one line each
- D1: the escalation gate does not exist. Nothing emits `attention.grant` or `jev.escalated`, so no coin run ever starts.
- D2: nothing stops spend. Cost is recorded only after a run, and MiroShark reports `usd: 0.0`.
- D3: synthesis text skips the prose check, and a real callout id from outside the window passes as a citation.
- D4: the workers accept any request: no token, no schema check, and a duplicate id overwrites a running job.
- D5: escalations wait behind long runs and are dropped when the quota is spent; empty swarms count as success.
- D6: core takes the swarm and mood numbers from the engines instead of computing them.
- D7: two earlier fixes (5.5 and 5.14) were pushed without a test; 5.14 may not exist in code.

## Order
Shared files force order; freeze contract and schema changes before writing.
- **Core lane:** D1 → D3 → D6 (contracts, `toolbox.ts`).
- **Bridge and worker lane:** D5 → D2 → D4 (`bridge.ts`, both `asimog_worker.py`). D5 needs D1's grants to test against, so start it after D1 is committed.
- **Last:** D7, after D2, D4 and D6 (it tests the worker code they change).
Lane B may run as one subagent with its own write lists while you do lane A (`docs/WORKFLOW.md` section 3; models from `~/.claude/rules/pstack-models.md`).

## Rules for this phase
- Read `AGENTS.md`, `docs/WORKFLOW.md` and `docs/SLOW-MIND.md` first.
- Vendor code: open each engine's `VENDOR.md` before editing a worker; add every new patch there.
- Every number is computed in code; engines and Jev only propose. Use the Clock in core, never `Date.now()`.
- Tests use fake model endpoints inside the suite, never a real key; real engine runs and soaks wait for G0. A check that needs a key and has none is reported as not run.
- Fresh test databases only; the working database is not touched without the owner's yes.
- Per row: `pnpm typecheck`, `npm run lint:changed`, the row's suite, `npm run docs:gen` plus `docs:check` when topics or settings change. Run each new check against the old code to see it fail. Update the doc, fill the task file's State, and make one commit per row, staging files by name. Do not push until the owner says so.

## Ask the owner before you build (do not guess)
1. **D1 and D2, the money numbers: decided by the owner on 2026-10-19 as low test limits while the phase is built.** `SLOW_STAGE1_USD_PER_RUN=0.005`, `SLOW_STAGE2_USD_PER_RUN=0.03`, `SLOW_STAGE3_USD_PER_RUN=0.10`, `SLOW_USD_PER_DAY=0.50`, `ESC_P_LOW=0.35`, `ESC_P_HIGH=0.65`, `ESC_DISAGREE=0.3`, `HOT_SET_SIZE=5`, `HOT_SET_EVERY_S=90`. Put these in `.env.example` and record the decision in `docs/DECISIONS.md`; no need to ask again.
2. **D6:** compute mood in core from callout counts, or remove `mood.feed` entirely?
Record each answer as a row in `docs/DECISIONS.md`.

## Done means
Every D row in `docs/PLAN.md` is marked done with its suite and commit, each task file's State is filled, and `npm run checks:status` shows the D suites passed on the current commit. End with the report in `docs/WORKFLOW.md` section 7.
