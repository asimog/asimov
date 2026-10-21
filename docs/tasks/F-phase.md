# F phase: hardening and truth (kickoff brief)

The brief for the session that builds PLAN section F. Findings, line citations and my verification are in `docs/audit/REVIEW_AND_FIX_PLAN_2026-10-20.md`; the full evidence for each ID is in `docs/audit/LINE_BY_LINE_AUDIT_2026-10-20.md`. Write a task file from `_template.md` for each row before building it.

## What the F phase fixes, in one line each
- F0: a test can pass while a consumer throws, with no checks, or with the wrong Signer key.
- F7: a Tape row stamped earlier but committed later is skipped by every consumer, forever.
- F8: the paper record is biased: wrong launch facts on busy coins, lost take-profits, free exits on graduated coins, inflated copy scores.
- F1: `truncate tape.events` passes the append-only guard; roles are not split.
- F2: one slow viewer freezes the relay; anonymous search spends the agents' budget; the relay cache grows on user input.
- F3: the Signer signs any transaction of the right shape; the sweep split comes from the caller.
- F9: an unknown send can be sent twice; a transient signer or RPC error loses the order; a pending buy blocks the exit.
- F10: a missing kill row reads as running; one stuck order switches reconciliation off.
- F11: a hung BettaFish run holds a slot forever; reports cite parents from the future; engine text can overwrite run ids.
- F12: nothing is evaluated in a quiet period, and replay cannot reproduce timer work.
- F13: the P2 and P3 sweep.

## Order
F0 first: until tests can fail, nothing below can be proven. Expect red suites; fix the code, not the harness.
- **Record lane:** F0 → F7 → F8 → F12 (`tape/`, `mind/`, `index/`, `senses/`).
- **Money lane:** F3 → F9 → F10 (`services/signer`, `hands/`, `treasury/`). F9 needs F3's request shape.
- **Edge lane:** F2 and F11 (`services/relay`, `services/slow-bridge`, workers). Independent of the other lanes after F0.
- **Then:** F1 (needs every writer's role known), F4, F5, F6, F13.
Lanes may run as subagents with disjoint write lists (`docs/WORKFLOW.md` section 3). `schema.sql`, contracts and `runtime.ts` stay with the top agent.

## Rules for this phase
- Read `AGENTS.md`, `docs/WORKFLOW.md`, and the doc for the area (`SYSTEM.md` for the Tape, `EXECUTION.md` for the Signer and Trader).
- Write each new check first and run it against the old code to see it fail. Record that in the task file's State.
- The kill switch, the Signer allowlist and the reason codes only get stricter. No change loosens a refusal.
- Use the Clock in core, never `Date.now()`. Fresh test databases only.
- Fix EXECUTION.md:25 and the Trader together (F9): docs and code agree in one change.
- Per row: `pnpm typecheck`, `npm run lint:changed`, the row's suite, `npm run docs:gen` and `docs:check` when topics or settings change. One commit per row, files staged by name. Do not push until the owner says so.

## Ask the owner before you build (do not guess)
1. **F3:** Signer option A (it reads the order row, read-only, from the database) or option B (core signs an intent the Signer verifies, so the Signer stays stateless)? See `FIRST_PRINCIPLES_2026-10-20.md` section 4.2.
2. **F7:** the commit watermark slack (proposed `TAPE_COMMIT_SLACK_MS=2000`), or a single `seen_time` stamper instead?
3. **F2:** public search behind a token, or open with its own small persisted budget?
4. **Privacy:** the audit files name attack paths and the repo is public. Move `docs/audit/` to `docs/.archive/` (private) before any commit?
Record each answer as a row in `docs/DECISIONS.md`.

## Done means
Every F row in `docs/PLAN.md` is marked done with its suite and commit, each task file's State is filled, and `npm run checks:status` shows the F suites passed on one commit. End with the report in `docs/WORKFLOW.md` section 7.
