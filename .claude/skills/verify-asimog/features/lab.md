# Lab

The Lab shows the firm's commit and reveal record: counters for commits, reveals and hash mismatches, an arc with one mark per commit and one ray per reveal, and thesis cards that print real commit hashes.

## Sub-features

- `lab-counters` counters equal `/v1/lab`.
- `lab-arc` one `.arc-commit` per item, one `.arc-ray` per revealed item.
- `lab-theses` thesis cards print the first 16 characters of each commit hash.

## How to get to it (user POV)

- Choose `Lab` in the top nav, or open `/lab`.

## Driving it with drive.ts

Preconditions:

- Baseline from the README.

- **Load.** `drive page lab --wait 'document.querySelectorAll(".room-kpis .num").length >= 3 && document.querySelector(".room-kpis .num").textContent !== "·"'`. The step is `true`.
- **Counters.** Add `--eval '[...document.querySelectorAll(".room-kpis .num")].map(e => e.textContent)'`. Then `curl -s localhost:7401/v1/lab`: the values equal `total`, `revealed`, and the count of items whose reveal does not match.
- **Arc.** Add `--eval '({ commits: document.querySelectorAll(".lab-arc .arc-commit").length, rays: document.querySelectorAll(".lab-arc .arc-ray").length })'`. `commits` equals `items.length`; `rays` equals the revealed items.
- **Theses.** Add `--eval '[...document.querySelectorAll(".thesis-plan .mono")].map(e => e.textContent)'`. Each equals the matching thesis commit's `sha.slice(0, 16)`.

## Gotchas

- `·` is the loading placeholder; reading counters before it clears gives a false mismatch.
- Read `tests/e2e/suites/site-lab/suite.ts` for how `bad` and thesis order are computed before claiming a mismatch.
