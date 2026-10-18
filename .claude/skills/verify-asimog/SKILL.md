---
name: verify-asimog
description: Drive the Asimog website (Next.js rooms in apps/web, fed by the read-only relay) the way a visitor does, in headless Chrome, and capture proof (screenshots, page text, step results, console errors). Use after any change to apps/web, services/relay or a projection a room shows, or when asked to prove a room works in the real app. Also covers `ctl` for side checks against the database.
---

# Verify Asimog

The primary surface is the website: rooms at `http://localhost:7402` (web, `apps/web`) reading `http://localhost:7401` (relay, `services/relay`), which reads Postgres with a read-only connection. Visitors give no input except moving controls such as the Rewind slider. Secondary surface: `npm run ctl -- <cmd> --json` (docs/03). The full regression suites are `npm run e2e site-*` (docs/14); this skill is for one-off proof, and the owner runs full suites only at milestones.

All commands run from the repo root in Git Bash. The helper is `npx tsx .claude/skills/verify-asimog/drive.ts`, below `drive`.

## Launch

1. Postgres must be up: `docker ps --format '{{.Names}}'` lists `asimog-pg`. If not, `npm run pg:start`.
2. `VERIFY_RUN=<name> drive up`. For each of relay and web: if it already answers, it attaches and prints `already up ... attaching (not ours, never stop it)`; otherwise it starts `npm run relay` or `npm run web`, writes its pid to `artifacts/verify/stack.json`, and waits until ready (relay `/health` 200, web `/` 200; first `next dev` compile takes up to 2 min). Logs go to `artifacts/verify/<run>/<name>.log`.
3. Ready means usable: `drive doctor` passes (below) and the first `drive page` reports `"failed": false`.

Isolation: one relay and one web per checkout (fixed ports 7401/7402; `next dev` holds a lock on `apps/web/.next`). Driving the owner's running servers is safe: the site takes no input, the relay's connection is read-only, and the headless Chrome has its own throwaway profile. Never stop servers you did not start. There is no empty-database mode: rooms show whatever the working database holds. Core (`npm run dev`) is what keeps the tape fresh; this skill never starts or stops core.

## Doctor

`drive doctor` prints one line per check and exits 1 on a FAIL:

- `relay answers /health`, `web answers /`, `mode is paper` (from `/v1/snapshot`), `Chrome or Edge found` (else set `CHROME_PATH`): fatal.
- `tape head is fresh` (head under 10 min old) and `started by verify-asimog`: notes only. A stale head means core is not running; live rooms (Field, Cortex) then show an old hour, which is still a valid render but not proof of live motion.

Run it first, and again whenever anything looks off.

## Drive

`drive page <route> [steps...]` opens `<route>` on desktop (1440x900, or `--phone` for 390x844), waits for `main`, runs the steps in order, then saves a final screenshot and the page text. Routes go without a leading slash (`rewind`, `case/<id>`, `field` for `/`): Git Bash rewrites `/rewind` into a Windows path.

| Step | Does | Fails the run when |
| --- | --- | --- |
| `--wait '<js>'` | polls the expression up to 20 s | it never becomes truthy |
| `--click '<css>'` | clicks the first match | no match |
| `--set '<css>=<value>'` | sets an input's value with the native setter and fires `input` (works with React) | no match |
| `--eval '<js>'` | records the expression's value | it throws |
| `--shot <name>` | screenshot mid-journey | never |

Uncaught page errors also fail the run. Handles are the ones the `tests/e2e/suites/site-*` suites assert on (class names and `data-*` attributes); the rooms have few ARIA names, so prefer `data-*` attributes where they exist. Read `features/README.md` and the matching feature file before driving.

Compare what the page shows with the relay's answer for the same moment: `curl -s localhost:7401/v1/<room>` (snapshot, lab, ledger, integrity, treasury, synthesis, simulations, board?at=, connectome, cards, case/<id>). A number on screen proves nothing until it equals the API.

## Evidence

Everything goes to `artifacts/verify/<VERIFY_RUN>/` (gitignored; default name is today's date): `<page>.png`, `<page>-<shot>.png`, `<page>.txt` (text of `main`), `<page>.json` (url, viewport, each step with its result, console errors, `failed`).

Proof standards:

- Drive the visitor's path (load the route, move the control), never call a relay endpoint in place of the page.
- Capture the action and the result: a `--shot` before the action, the final shot after, and an `--eval` of the changed value.
- Pair every on-screen number with the API or `ctl` value read at the same time; record both in your report.
- Paper and simulated content must be labeled PAPER and SIMULATED on screen; check the text file.
- Report the feature ID and route with each artifact. A route you could not reach is reported with the step that failed, never as verified through another route.

## Cleanup

`drive down` stops only the pids in `artifacts/verify/stack.json` (with their child processes) and deletes that file. With nothing started it says so and does nothing. It never touches `artifacts/verify/<run>/`: the proof stays. Each `drive page` closes its own Chrome and deletes its temp profile. Run `drive down` after every failed attempt too.

## Helpers

- `drive.ts`: `up`, `doctor`, `page`, `down` as above. Reuses the `Browser` class from `tests/e2e/lib/site.ts` (Chrome DevTools protocol, no dependency). `E2E_WEB_URL` and `E2E_RELAY_URL` point it at other ports.
- Database side checks: `npm run ctl -- state --json`, `npm run ctl -- case <callout_id> --json`, `npm run ctl -- why <signal_id>`.
