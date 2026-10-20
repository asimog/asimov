# E7b: A rug report worded differently from the rug words still reaches the rug feed and the `exit` pack

Mode: B · Writer: top agent · Depends on: E5 · PLAN row: E7b (split from E7)

## Current behavior
- Observed: the rug feed picks reports by regex only, `RUG_WORDS` (`services/relay/src/rug-feed.ts:10`), over the last 24 h of `callout.reply` (`rug-feed.ts:18-25`). A report like "team cashed out, chart is dead" is missed.
- Observed: replies are embedded as `kind = 'reply'` in `agents.memory` (`services/agents/src/memory.ts:53`), and recalled for rug reports only by the Wiki writer (`services/agents/src/graphs.ts:208-210`).
- Observed: the Jev `exit` pack judges `exit_notice` from the callout text alone (`services/core/src/reflex/reflex.ts:33`); it never sees replies on the coin.

## Required behavior
1. The Librarian scores each stored reply against a fixed set of rug exemplar texts (`config/rug-exemplars.json`, owner-editable) and emits `reply.rug_like { reply_id, mint, similarity, model, method }` when the best similarity ≥ `RUG_SIMILARITY` (env, default 0.8). `seen_time` = the reply's `seen_at`. Exemplars embed once per model.
2. The rug feed shows a reply if it matches `RUG_WORDS` **or** has a `reply.rug_like` event. Each shown report says which (`words` or `similar`, with the similarity). Still Observed class; still masked; never a finding.
3. The `exit` pack gets, as a named bucket, the count of rug-like replies on the coin seen at or before the callout (`none`, `one`, `several`), computed in code.
4. No embedder or budget refused → no `reply.rug_like`; the feed falls back to words only; the bucket is `unknown`.

## Invariants
Tape append-only; replay determinism (events depend only on rows seen at or before their `seen_time`); evidence classes never mix; no person named; Jev gets buckets, not raw numbers; no new dependency; no model or URL in code.

## Write list
`services/agents/src/memory.ts`, `services/agents/src/runtime.ts`, `services/agents/src/rugs.ts` (new), `config/rug-exemplars.json` (new), `services/relay/src/rug-feed.ts`, `services/core/src/reflex/reflex.ts`, `services/core/src/mcp/toolbox.ts`, `packages/contracts/src/index.ts`, `tests/e2e/suites/memory-rugs/suite.ts` (new), `tests/e2e/suites.ts`, `.env.example`, `docs/PIPELINE.md`, `docs/UI.md`, `docs/PLAN.md`, this file. Run `npm run docs:gen`.

## Read first
`services/relay/src/rug-feed.ts`, `services/agents/src/memory.ts`, `services/core/src/reflex/reflex.ts:20-70`, `tests/e2e/suites/site-rugfeed/suite.ts`, `docs/tasks/E7.md` (the `callout.copy` emit path; reuse it)

## Forbidden
`services/core/src/runtime.ts`, `services/core/src/sql/schema.sql`, `tests/e2e/main.ts`.

## Acceptance
`npm run e2e -- memory-rugs` →
- `ok a rug report without rug words reaches the rug feed`
- `ok the exit pack sees rug-like replies seen before the callout only`
- `ok no rug_like event without an embedder`

The first two fail on the commit before the change. `site-rugfeed` and `memory-asof` stay green. Fake embedding endpoint only.

## Out of scope
Search (E7c), clusters and copies (E7), E8.

## State
Written 2026-10-20. Not started.
- 2026-10-20, done here, from the test on branch `e7b-suite`. Changes from this file: the event is `reply.rug_score` for every scored reply (so the bucket can say `unknown` when a coin's replies were not scored yet), written at core's now rather than the reply's time, and the bucket counts scores seen by the callout's time. There is no `exit` pack: the callout pack (`callout@2`) carries `rug_like_replies` and asks `holders_leaving`. `services/agents/src/lanes.ts` was edited to give the Librarian the two new tools. Suite `memory-rugs` passed 3 of 3. Done.
