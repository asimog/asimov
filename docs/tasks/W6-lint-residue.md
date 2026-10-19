# W6-lint-residue: `npm run lint` reports no errors

Mode: A · Writer: subagent (sonnet, medium) · Depends on: none · PLAN row: workflow cleanup (W6)

## Current behavior
Observed: `npx biome check .` lists about 45 findings after the safe fixes in commit 2aa0da3. By file: `apps/web/**` (`noArrayIndexKey` 23, `noDescendingSpecificity` 6 in `instruments.css` and `rooms.css`, `noImportantStyles` 2 in `globals.css`, `useAriaPropsSupportedByRole` in `app/page.tsx`, `noSvgWithoutTitle` in `app/icon.svg`, `noUnusedFunctionParameters` in `components/hud/Panels.tsx`, `noExplicitAny` in `app/case/[id]/page.tsx`); `services/relay/src/{main,rooms}.ts` (`noExplicitAny`); `services/agents/src/graphs.ts` (unused parameter); `services/core/src/mind/dsl.ts` and `services/core/src/mcp/toolbox.ts` (`useIterableCallbackReturn`); `tests/e2e/lib/site.ts` (`noExplicitAny`); `tests/e2e/suites/{site-treasury,miroshark-pumpfun,agent-lanes}/suite.ts`; `agent/skills/pump-coin-fees/scripts/*.mjs` (unused imports and variables).

## Required behavior
`npx biome check .` prints no errors. Each fix keeps behavior: a list key uses a stable id from the item when one exists (index only when the list never reorders, then with a `biome-ignore` comment naming why); an `any` becomes the real type or `unknown` with a narrow; a callback that should not return a value uses a block body; CSS specificity is fixed by reordering rules, not by `!important`.

## Invariants
No visual change to the site; no behavior change; no new dependency; no rule turned off in `biome.json`.

## Write list
`apps/web/**`, `services/relay/src/main.ts`, `services/relay/src/rooms.ts`, `services/agents/src/graphs.ts`, `services/core/src/mind/dsl.ts`, `services/core/src/mcp/toolbox.ts`, `tests/e2e/lib/site.ts`, `tests/e2e/suites/site-treasury/suite.ts`, `tests/e2e/suites/miroshark-pumpfun/suite.ts`, `tests/e2e/suites/agent-lanes/suite.ts`, `agent/skills/pump-coin-fees/scripts/*.mjs`.

## Read first
`biome.json`; the output of `npx biome check . --max-diagnostics=200`; each file before editing it.

## Forbidden
`biome.json`, `package.json`, `scripts/**`, `docs/**`, `tests/e2e/main.ts`, `tests/e2e/lib/suite.ts`, and the shared files in `docs/tasks/_template.md`.

## Acceptance
`npx biome check . 2>&1 | grep -E "^Found [0-9]+ errors"` prints nothing (no errors), and `pnpm typecheck` prints no errors.

## Out of scope
Warnings and infos; refactors; any e2e run (do not run `npm run e2e`).

## Return
`git diff --stat`; the two acceptance commands with their output; any finding left with a `biome-ignore` and why. Do not commit.

## State
Done 2026-10-19: 0 lint errors; 21 index keys kept with a biome-ignore naming why; agent-lanes regex escapes restored.
