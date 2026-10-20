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
Written 2026-10-20. Done 2026-10-20.
- Before the change `npm run e2e -- site-search` failed all six named checks (no `services/relay/src/search.ts`; bridge runs had no hits). After: PASS, 7 of 7 (4 acceptance lines, plus kinds and `@mention` masking, bad input refused, time budget). `memory-asof` PASS 7 of 7. Fast tier: 46 of 50 pass; the 4 that fail (slow-bridge one check, bettafish-stance, fence-parity, amm-golden) need the engines' Python venvs, absent in this sandbox, and fail the same way without this change.
- Shared query: `packages/lane/src/recall.ts` (`recall`, option `unique` = one row per kind and ref); `services/agents/src/memory.ts` re-exports it, its copy deleted.
- Relay: `GET /v1/search` (`services/relay/src/search.ts`); reads `agents.memory` and the EMBED spend on a read-only connection (`AGENTS_DATABASE_URL` if set, else the relay's own); its own embedding spend is counted in memory on top of the agents' spend, never written.
- Bridge: `memory_hits` on coin and swarm run requests when `BridgeDeps.memory` is given; the coin's symbol and name come from core's `coin_dossier` (the Bridge reads no core table, `agent-lanes` holds).
- Screenshots (desktop 1440x900, phone 390x844, dark, hits match `/v1/search`): `artifacts/verify/e7c/wiki.png`, `wiki-phone.png` (gitignored).
- Open: `services/slow-bridge/src/main.ts` (not in the write list) must pass `memory: { sql, embedder }` for production runs to carry hits; the engines' workers (`asimog_worker.py` in both engines) do not read `memory_hits` yet.
