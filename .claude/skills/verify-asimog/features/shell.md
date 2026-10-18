# Shell

The shell is what every room shares: a top nav linking every room, a live-stream state written in words, a footer that says the firm is paper trading, and a dark page with no sideways scroll on desktop and phone.

## Sub-features

- `shell-rooms` each room route loads without an uncaught error.
- `shell-phone` no sideways scroll at 390 px wide.
- `shell-nav` the nav lists every room.
- `shell-stream` the nav shows the stream state in words.
- `shell-paper` the footer says paper trading.

## How to get to it (user POV)

- Open any room: `/`, `/cortex`, `/lab`, `/ledger`, `/integrity`, `/synthesis`, `/simulations`, `/treasury`, `/rewind`, `/connectome`, `/charter`.
- Choose a room in the top nav.

## Driving it with drive.ts

Preconditions:

- Baseline from the README.

- **Room loads.** For each route: `drive page <route> --wait '!!document.querySelector("main") && !!document.querySelector("footer")'`. `failed` is `false` and `console_errors` is empty.
- **Phone width.** Same with `--phone --eval '[document.documentElement.scrollWidth, document.documentElement.clientWidth]'`. The first number is at most the second plus 1.
- **Dark.** Add `--eval 'getComputedStyle(document.body).backgroundColor'`. A dark colour (each channel under about 60).
- **Nav.** `drive page field --wait 'document.querySelectorAll("header.nav nav a").length > 0' --eval '[...document.querySelectorAll("header.nav nav a")].map(a => a.textContent.trim())'`. The list includes Field, Cortex, Lab, Ledger, Integrity, Treasury, Rewind, Connectome, Charter.
- **Stream state.** Add `--wait '/last event|waiting for the first event|relay unreachable/.test(document.querySelector("header.nav .live")?.textContent ?? "")' --eval 'document.querySelector("header.nav .live").textContent'`.
- **Paper.** Add `--eval 'document.querySelector("footer").innerText'`. It contains `paper trading`.

## Gotchas

- `relay unreachable` in the stream state is a passing render but means the web app cannot reach the relay; check doctor before calling the room broken.
- The Field's WebGL canvas uses SwiftShader in headless Chrome; slow first frames are normal.
