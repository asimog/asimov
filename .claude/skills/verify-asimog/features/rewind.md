# Rewind

Rewind lets a visitor drag a slider to a past time and see the Board as it was then: the signals live at that moment, counted by kind, and the tape lines before it, with nothing from after that time.

## Sub-features

- `rewind-load` shows the latest Board and the slider's time range.
- `rewind-scrub` moving the slider shows the Board at the chosen time.
- `rewind-no-future` nothing shown is newer than the chosen time.

## How to get to it (user POV)

- Choose `Rewind` in the top nav, or open `/rewind`.
- Drag the `Time, UTC.` slider.

## Driving it with drive.ts

Preconditions:

- Baseline from the README. The Board holds signals (doctor's snapshot has coins).
- Pick `T`: read `curl -s localhost:7401/v1/board` for `range.from` and `range.to`, then choose `T = from + k*1000` between them (the slider steps by 1000 ms from `from`).

- **Load.** Open the room and wait for the table. `drive page rewind --wait 'document.querySelectorAll(".rewind-kinds tbody tr").length > 0' --shot before`. The step result is `true` and the text file shows `TIME SHOWN`, `SIGNALS LIVE` and a `KIND / LIVE` table.
- **Scrub.** In the same command, add `--set '#rewind-at=<T>' --wait 'document.querySelector("[data-at]")?.getAttribute("data-at") === "<T>"'`. Both steps are `true`; the final screenshot shows the new `TIME SHOWN`.
- **Read the page.** Add `--eval 'document.querySelector("[data-total]").getAttribute("data-total")' --eval '[...document.querySelectorAll(".rewind-kinds tbody tr")].map(tr => tr.children[0].textContent + ":" + tr.children[1].textContent)'`.
- **Compare.** `curl -s "localhost:7401/v1/board?at=<T>"`. `total` equals `data-total`, and the `kinds` list equals the table rows; every line in `lines` has `t <= T`.

Example that passed on 2026-10-18 (range from `1792240695038`): `T=1792318000038`, total `4476`, kinds `caller.dna:3805, echo.score:606, age.opportunity:65`.

## Gotchas

- A `T` not on the 1000 ms grid from `range.from` snaps to the nearest step, so the `data-at` wait never matches. The value you set is not the value shown.
- `--set` must use the native setter (the helper does); assigning `.value` alone does not reach React.
- `range.to` is the tape head, not now. With core stopped the range ends hours ago.
- `data-total` is set before the kinds table refreshes; wait on `data-at` first, then read.
