# E7c: A search on the site returns wiki pages and reports by meaning, as of a time

Mode: B · Writer: top agent · Depends on: E5, E3 · PLAN row: E7c (split from E7)

## Current behavior
- Observed: wiki pages and reports are embedded (`kind` `wiki` and `report`, `services/agents/src/memory.ts:54-56`) and recalled only inside agent graphs (Reporter `services/agents/src/graphs.ts:167`, Wiki writer `graphs.ts:209`).
- Observed: the relay serves `/v1/wiki` and `/v1/wiki/:slug` as lists and pages (`services/relay/src/main.ts:259-260`); no search route. The site `/wiki` room (`apps/web/app/wiki/`) has no search box.
- Observed: the slow engines (BettaFish, MiroShark through `services/slow-bridge/src/bridge.ts`) get no wiki or report context.

## Required behavior
1. Relay `GET /v1/search?q=&as_of=&kinds=wiki,report&k=` embeds `q` through `packages/lane` on lane `EMBED` (spend checked first; refused → 503 with a reason) and returns the nearest rows via the same as-of, model-scoped query as `recall`. Each hit: kind, ref, slug or report id, snippet (masked, 280 chars), similarity, seen_at. `q` capped at 200 chars; `k` ≤ 20; results cached per (q, as_of, kinds) a few seconds.
2. The shared query lives in one place: move `recall`'s SQL into `packages/lane` (or a small shared module) so agents and relay call the same code; delete the copy.
3. The `/wiki` room gets a search box that calls the route and links each hit. Dark, follows `docs/UI.md`; a refused budget shows "search paused".
4. The Slow Bridge adds the top 3 wiki/report hits for the coin's symbol and name, as of the run's slot, to the BettaFish and MiroShark inputs, fenced as untrusted text.
5. The relay reads `agents.memory` with a read-only role.

## Invariants
Read-only relay; as-of never returns a row seen after `as_of`; model-scoped; spend metered on `EMBED`; untrusted text fenced; no new dependency; no model or URL in code; banned list in `docs/UI.md` holds.

## Write list
`services/agents/src/memory.ts`, `packages/lane/src/` (shared recall), `services/relay/src/main.ts`, `services/relay/src/search.ts` (new), `apps/web/app/wiki/`, `services/slow-bridge/src/bridge.ts`, `tests/e2e/suites/site-search/suite.ts` (new), `tests/e2e/suites.ts`, `docs/UI.md`, `docs/SLOW-MIND.md`, `docs/PLAN.md`, this file.

## Read first
`services/agents/src/memory.ts:36-44`, `services/relay/src/main.ts:150-280`, `apps/web/app/wiki/`, `services/slow-bridge/src/bridge.ts`, `tests/e2e/suites/memory-asof/suite.ts`

## Forbidden
`services/core/src/runtime.ts`, `services/core/src/sql/schema.sql`, `tests/e2e/main.ts`, `packages/contracts/` unless a bridge input schema needs a field (then the top agent changes it).

## Acceptance
`npm run e2e -- site-search` →
- `ok a search returns the matching wiki page first`
- `ok a search as of a past time returns nothing seen after it`
- `ok search spend is metered on the EMBED lane`
- `ok the slow bridge input carries wiki hits as of its slot`

The first and last fail before the change. `memory-asof` stays green. Fake embedding endpoint only. Desktop and phone screenshots of `/wiki` with a search, dark.

## Out of scope
Rug similarity (E7b), copies and clusters (E7), E6 wallet pages, E8.

## State
Written 2026-10-20. Not started.
