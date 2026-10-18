# Integrity and case pages

Integrity shows the caller ledger (calls, measured, won per caller) and links to case files. A case page lays one callout out as six evidence sections, in order, each fact in its own section, with the callout text in a fenced block. Case pages state data; they never call out a person.

## Sub-features

- `integrity-ledger` ledger rows equal `/v1/integrity`.
- `case-sections` six `[data-class]` sections in order.
- `case-facts` the page prints every fact of `ctl case <id> --json`.
- `case-fenced` callout text sits in a `pre` block.
- `case-phone` no sideways scroll on the phone.

## How to get to it (user POV)

- Choose `Integrity` in the top nav, or open `/integrity`.
- Open a case from the room, or `/case/<callout_id>`.

## Driving it with drive.ts

Preconditions:

- Baseline from the README.
- A measured callout exists: `curl -s localhost:7401/v1/cards` returns a non-empty `ids`; take the first as `<id>`.

- **Ledger.** `drive page integrity --wait 'document.querySelectorAll("table.ruled tbody tr").length > 0' --eval '[...document.querySelector("table.ruled").querySelectorAll("tbody tr")].map(tr => [...tr.children].map(c => c.textContent.trim()))'`. Then `curl -s localhost:7401/v1/integrity`: same row count, and row `i` columns 0, 1, 2 equal `callers[i].who`, `calls`, `ok`.
- **Case sections.** `drive page case/<id> --wait 'document.querySelectorAll("[data-class]").length >= 6' --eval '[...document.querySelectorAll("[data-class]")].map(s => s.getAttribute("data-class"))'`. Six classes, in the order the `site-integrity` suite's `SECTIONS` lists.
- **Facts.** `npm run ctl -- case <id> --json` and check each leaf value appears in the matching section's text (the page text file).
- **Fenced text.** Add `--eval '[...document.querySelectorAll("[data-class] pre")].map(p => p.textContent)'`. The callout text is inside one of them.
- **Phone.** `drive page case/<id> --phone --wait 'document.querySelectorAll("[data-class]").length >= 6' --eval '[document.documentElement.scrollWidth, document.documentElement.clientWidth]'`. First at most second plus 1.

## Gotchas

- The ledger can be legitimately empty on a fresh database; that fails the `--wait`, and the report says why.
- Callout text is untrusted; it must never render outside the fenced block.
