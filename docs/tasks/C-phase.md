# C phase: strategy layer (kickoff brief for a new session)

Paste everything under "Prompt" into a new session started in `C:\dev\asimov`.

## Prompt

You are implementing PLAN section C (strategy layer, fix plan Phase 4) in the Asimog repo. Work on `main`; B0-B8 are done and pushed (HEAD 885d4ed or later).

### Read first, in this order
1. `AGENTS.md` (rules and boundaries) and `docs/WORKFLOW.md` (modes, task files, subagents).
2. `docs/PLAN.md` section C (rows C1-C12 and their checks).
3. `docs/STRATEGY.md` in full (175 lines): sections 3-7 are the spec for C.
4. `docs/tasks/_template.md`, and one finished B task file (e.g. `docs/tasks/B7.md`) to see the shape.
5. Only then the code a row names. Do not read research, archives or vendor code unless a row needs it.

### Where the code stands today (checked 2026-10-19; re-verify each before you rely on it)
- C1: `mind/evolve.ts:72-77` retires on wall-clock idle (`nowMs - last_trade_ms`) with no floor per niche, so a 3 h quiet gap wipes the pool.
- C2: `packages/contracts` `coin.watched.reason` is `caller_buy | smart_buy | follow | heat | metrics`; STRATEGY section 3 wants decisions tagged `callout | precall | smart_buy | scout`. No in-play reason on decisions yet.
- C3: `mind/dsl.ts:160-162` sizes by Kelly on the raw score (score treated as a probability); `desk.ts:447` uses Kelly whenever stage is `full`. No calibration map exists.
- C4: `mind/kernel.ts:56-61` promotes on halves of one strategy's returns; no family held-out window, no correlated-trade dedupe, no bound raised for family size.
- C5: `evolve.ts:76` retires on the median 60 s markout, not fee-adjusted.
- C6: `dsl.ts:173-178` exit context has mult, held minutes, called seconds; no `trail_from_peak`, no `caller_sold_gte`; check that every exit check gets the coin's Board.
- C7: `desk.ts:455` passes `risk: null` when `risk.state` is absent; check `mind/risk.ts` refuses it when `require_risk_state` is true.
- C8: `mind/fill.ts:27-39` AMM fills are fee only, no price impact.
- C9, C10, C11: no code yet (no creator launches or rug rate, no funder links, no bundler or copier archetype, no `buy_to_call_rate`/`dump_rate`/`creator_share`, no Jev guard or `budget.exhausted`).
- C12: `config/` has no `limits.default.json`; defaults are `DEFAULT_LIMITS` in `mind/risk.ts`, read by `mind/owner.ts`.

### Order and lanes
Shared files force order. Freeze contracts and schema changes before you dispatch any writer.
- **Lane M (mind, one at a time):** C12 -> C7 -> C2 -> C1 -> C4 -> C5 -> C3 -> C6.
  C12 before C7 (the gate reads the file defaults). C2 before C3-C5 (results split by reason). C1, C4, C5 share `evolve.ts`/`kernel.ts`; C3, C6 share `dsl.ts`/`desk.ts`.
- **Lane F:** C8 (`mind/fill.ts`). Independent; it can run beside lane M.
- **Lane R:** C11 (`reflex/`). Independent.
- **Lane I:** C9 -> C10 (`index/`, `analyzers/precall.ts`, memory). C9's check ("mass deployer refused with its reason") needs the gate reason from C7, so finish C7 before you close C9.
You may run lanes F, R and I as subagents with disjoint write lists while you do lane M yourself. Models come from `~/.claude/rules/pstack-models.md`.

### Per row
1. Write `docs/tasks/C<n>.md` from the template: one observable, current behaviour with file:line, a write list, and an acceptance command plus the output line that proves it. Add the task link to its PLAN row.
2. Mode: C7, C12 and anything touching `mind/risk.ts`, contracts or `schema.sql` is **mode C** (failure cases plus an adversarial read of the diff). The rest are mode B.
3. Prove it with the smallest check: a fast suite on synthetic rows or a recorded real slice, on a fresh database. Add the suite to `tests/e2e/suites.ts`. Before you call a check a regression test, run it against the old code and see it fail.
4. Any pump.fun, NATS or RPC data (C9 funder links, creator launches) is recorded first with `scripts/pump-sample.ts`; code against the real fields.
5. `pnpm typecheck`, `npm run lint:changed`, the row's suite, and `npm run docs:gen` plus `npm run docs:check` if topics, tables or settings changed.
6. Update the doc the row changes (STRATEGY, PIPELINE or OPS) in the same commit. Commit per row, staging files by name, with the check in the message. Fill the task file's State.

### Hard rules for this phase
- The Risk Gate stays a pure function; reason codes, limits and the kill switch only get stricter. Limits come from the owner's config, never code.
- Use the Clock, never `Date.now()`, in `mind/`, `analyzers/`, `index/`, `hands/`.
- Jev (C11) gets named buckets, never numbers to compute; every answer is recorded as `jev.answer`.
- No replays, soaks or long tapes: those wait for G0. The PLAN checks that say "run" mean a small fixture or test-clock run.
- The working `asimog` database has the pre-B6 schema. Use fresh test databases; do not drop or reset the working one without the owner's yes.

### Ask the owner before you build (do not guess)
1. C2: how do `coin.watched` reasons map to in-play reasons? Proposed mapping: `caller_buy` -> `precall`, `smart_buy` -> `smart_buy`, `heat`/`metrics` -> `scout`; `follow` is the open question. Either `smart_buy`, or add `follow` as a fifth reason (which changes STRATEGY section 3).
2. C3: the value of `KELLY_CAP` and `CALIB_MIN_PER_BIN`, or confirm they go into `.env.example` with defaults you propose.
Record each answer as a row in `docs/DECISIONS.md`.

### Done means
Every C row in `docs/PLAN.md` is marked done with its suite name and commit, each task file has State filled, and `npm run checks:status` shows the C suites passed on the current commit. Push to `main` only when the owner says so. End with the report `WORKFLOW.md` section 7 asks for: what changed, commands and results, what was not run and why, open risks.
