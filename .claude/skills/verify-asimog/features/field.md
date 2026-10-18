# Field

The Field is the home room: a 3D scene of coins called out in the last hour, a HUD of firm numbers (mode, mandate, milestone, strategies and more), region captions counting coins on the curve and graduated, a caller-link count, and a strip of plain tape lines. Every motion is caused by a real tape event.

## Sub-features

- `field-hud` HUD values equal `/v1/snapshot`.
- `field-regions` region captions count the snapshot's coins.
- `field-links` the `Caller links` legend equals the snapshot's edge count.
- `field-strip` strip lines are lines the relay served.
- `field-canvas` a canvas is drawn, or the no-WebGL line is shown.

## How to get to it (user POV)

- Open `/`, or choose `Field` in the top nav.

## Driving it with drive.ts

Preconditions:

- Baseline from the README. For live motion the tape head must be fresh (doctor note absent).

- **Load.** `drive page field --wait 'document.querySelectorAll(".hud .kpi").length > 0 && document.querySelectorAll(".hud .kpi[data-loading]").length === 0'`. The step is `true`.
- **HUD.** Add `--eval 'Object.fromEntries([...document.querySelectorAll(".hud .kpi")].map(k => [k.querySelector("dt").textContent, k.querySelector("dd").textContent]))'`. Then `curl -s localhost:7401/v1/snapshot`: `Mode` equals `mode` upper-cased (`PAPER`), `Mandate` equals `<mandate_sol> SOL`, `Milestone` equals `milestone`, `Strategies` equals `pool.alive`.
- **Regions and links.** Add `--eval '[...document.querySelectorAll(".field-region")].map(e => e.textContent)' --eval '[...document.querySelectorAll(".field-legend div")].find(d => d.textContent.startsWith("Caller links"))?.querySelector("dd").textContent'`. The link count equals `edges.length`; a region says `<n> coins` for the coins not in `graduated` and another for those in it.
- **Strip.** Add `--eval '[...document.querySelectorAll(".strip .tape-text")].map(e => e.textContent)'`. Each line appears in the snapshot's `tape[].text`.
- **Canvas.** Add `--eval '!!document.querySelector(".field canvas") || !!document.querySelector(".field-fallback")'`. `true`.
- **Motion cues.** Add `--eval 'window.__asimogCueLog ?? []'`. Each cue's `event` is an id in the snapshot's `tape` or on the stream; an empty log on a quiet stream is not a failure, say so.

## Gotchas

- The snapshot is cached 2 s and the page refreshes it; read the API twice around the page read and accept a match with either.
- A stale tape head shows an old hour of coins; the HUD still must equal the API.
- `Mandate` prints the number as JS formats it (`0.2 SOL`), not fixed decimals.
