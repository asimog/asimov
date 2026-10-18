# UI

The website: rooms, design language, the banned list and how it is built. Rule zero: every motion comes from a real event or a real number changing. When nothing happens, the Field breathes slowly and nothing else moves. Simulated content is labelled SIMULATED and paper content PAPER.

## 1. Who decides

1. The owner's words.
2. This doc and `docs/inspiration/README.md`.
3. Advisors: motion and r3f skills, react-bits components.

## 2. Rooms

Every room is an instrument: one dominant form edge to edge, a strip of 6 to 8 dense panels under it, a KPI header with at most one accent number.

| Route | Room | Dominant form | Answers |
|---|---|---|---|
| `/` | Field | Particle clouds per market, filaments to open positions | Where is the money, is the firm healthy |
| `/cortex` | Cortex | Point-cloud brain, lobes are the firm's lanes | What is the agent doing now |
| `/lab` | Lab | The arc of committed theses, evidence threads, outcome rays | What does it believe, was it right |
| `/ledger` | Ledger | A ruled table | Every trade, callout, update, markout and cost |
| `/treasury` | Treasury | Sweeps, balances, reconciliation, the proof chain | Where the money goes, with proofs |
| `/charter` | Charter | Constitution, soul versions, disclosure registry | Who it is and what binds it |
| `/integrity` | Rug feed | Risk evidence from scraped comments and risk signals; case files in six sections | Which coins look unsafe, with evidence and limits |
| `/wiki` | Wiki | Pages for top traders, callers, creators, coins, narratives | Who trades how: styles, strategies, hold times, records |
| `/synthesis` | Synthesis | Forum lines and coin stances with cited case files | What BettaFish read |
| `/simulations` | Simulations | Swarm runs, branches, belief drift, SIMULATED report | What MiroShark simulated |
| `/rewind` | Rewind | Any room at a past time | What it knew then |
| `/cards/[id]` | Share card | 1200 x 630 PNG of one callout, net result, PAPER position, no caller named | A call worth sharing |
| `/terms`, `/privacy`, `/disclosures` | Legal | Text | Written by counsel |

Event to motion (Field): a callout flares a point in its coin's cloud; a Jev answer shimmers under 200 ms; an escalation pulses the cloud's edge until System Two answers; a buy draws a filament; a sell thins it; a sweep drifts particles into the Core; drawdown or the kill state shifts the field from amber to crimson.

Every panel has five states: loading (shaped skeleton), empty (what will appear and when), stale (past `valid_until`, greyed with age), error (what failed and what the agent is doing), kill (crimson HUD with the reason).

## 3. One dark world

Every room is dark: warm black ground, bone ink, amber for money and the one hot number, crimson for stress, teal only for the mind.

| Token | Value | Use |
|---|---|---|
| `--night` | `oklch(0.14 0.012 60)` | Ground |
| `--night-2` | `oklch(0.19 0.012 60)` | Panels |
| `--amber` | `oklch(0.80 0.13 75)` | Particles, positions, live state |
| `--amber-dim` | `oklch(0.55 0.08 70)` | Filaments, quiet labels |
| `--crimson` | `oklch(0.56 0.17 28)` | Drawdown, crisis, kill |
| `--teal` | `oklch(0.60 0.09 200)` | The mind |
| `--bone` | `oklch(0.92 0.012 85)` | Text |

Type: IBM Plex Mono for labels and data (caps micro-titles tracked 0.08em), IBM Plex Sans Condensed 600 with tabular figures for KPI numerals, IBM Plex Sans for body. One fluid type scale. Radius 0 (chips 2 px), 1 px lines, no shadows, glow only on Field particles, 4 px spacing base, motion 120 / 200 / 320 ms.

## 4. Banned

| Banned | Instead |
|---|---|
| Gradients, radial orbs, dot grids, liquid glass, neon, pastels, purple | Flat warm night; depth from particle density; five colors only |
| Pure white backgrounds | Every room is dark |
| Drop shadows, soft radius, colored left stripes | None; radius 0 |
| Lucide and sparkle icons, animated arrows, checkmark bullets | Our own hairline glyphs; plain lists |
| Three cards in a row, bento grids, pricing tiers, fake testimonials | Instruments with live data only |
| Fake terminal windows | Mono lists inside normal panels |
| Inter, Geist, Space Grotesk | IBM Plex only |
| Emojis, em dashes, "it's not X, it's Y" | Plain words, exact numbers |
| Hover motion | Focus rings and press feedback only |
| Missing legal pages | Terms, Privacy, Disclosures, Proofs, Constitution in every footer |

## 5. How it is built

- `apps/web` on Next.js. One R3F canvas mounted in the root layout; rooms place views into DOM slots, so moving between rooms never recreates the WebGL context. No hand-made 3D models: forms are generated from data.
- Data flow: core to the read-only relay (SSE), to a normalizer, to zustand stores, to the Animator (event to cue, rate limited), to the scene inside `useFrame`. React never re-renders per frame.
- Server components fetch a snapshot so first paint has real data; the client takes over with SSE.
- Share cards render with `next/og`, no browser.
- Mobile at 760 px and below: dominant form on top at lower density, the strip stacked; low-power stills when frame rate drops; 44 px targets.
- Accessibility: every scene change has a DOM mirror with `aria-live="polite"` for trades, posts and the kill state; keyboard navigable; reduced motion swaps animation for instant color.
- CSS: logical properties, `min-width: 0` on text-holding grid children, `text-wrap: balance` on headings, container queries for panels, `:focus-visible` rings, hover color only inside `(hover: hover)`, motion inside `prefers-reduced-motion: no-preference`, never disable zoom.
- Proof of a UI change: the `verify-asimog` skill drives the real site in headless Chrome and captures screenshots and page text.
