# Asimog verification map

The maintained source for verifying what a visitor sees on the Asimog site. Read this index, then use the matching feature file as the recipe. `drive` means `npx tsx .claude/skills/verify-asimog/drive.ts`.

## Baseline preconditions

- `drive up` then `drive doctor` with no FAIL line.
- Note the tape head age from doctor; quote it in the report when it is over 10 min.
- Set `VERIFY_RUN=<feature-id>-<short-tag>` so artifacts of different runs do not mix.

## Driving conventions

- Routes without a leading slash; `field` means `/`.
- Use the `data-*` attributes and class names listed in each file; they are the ones the `site-*` E2E suites assert on.
- Rooms load data after first paint. Always `--wait` for the room's ready expression before `--eval`.
- Read the relay endpoint right after the page; the snapshot is cached for 2 s and refreshes, so a value may legitimately match the read before or after.

## Proof and skip reporting

- Proof is the step JSON, the screenshots, the page text, and the API value it was compared with.
- A failed `--wait` is a failure of the journey; report it with its expression. Never relax the expression to pass.
- Do not report a room verified from the API alone.

## Feature entry contract

Each feature file has an H1, one paragraph, then `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.ts` (starting with `Preconditions:`), and `Gotchas`.

## Features

- [Shell](./shell.md): every room loads dark on desktop and phone; nav, footer, stream state.
- [Field](./field.md): the home room's HUD numbers equal the relay snapshot.
- [Rewind](./rewind.md): the slider shows the Board as it was at a past time.
- [Integrity and case pages](./integrity.md): caller ledger and the six-section case file.
- [Lab](./lab.md): commit and reveal counters, the arc, thesis hashes.

Not mapped yet: Cortex, Ledger, Treasury, Synthesis, Simulations, Connectome, Charter, share cards (`/cards/<id>`). Their E2E suites (`site-cortex`, `site-treasury`, `slow-rooms`, `site-cards`) hold the handles to start from.
