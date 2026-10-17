# 12 · Design guidelines

## Who decides

1. The owner's words.
2. **impeccable** (`.claude/skills/impeccable`). It wins every conflict with other skills.
3. This doc and `docs/inspiration/README.md`.
4. Advisors: `design-taste-frontend`, Emil Kowalski's motion skills, transitions.dev skills, the r3f skills, react-bits components.

## Direction: Instrument

Asimog's site is a set of scientific instruments for watching an autonomous firm work. Each screen is one instrument: one dominant form that fills the canvas, and a strip of small dense panels under it. Futuristic through precision and live data, not through effects. References: the four videos in `docs/inspiration/`.

## Two modes, one accent each

| Mode | Used by | Ground | Ink | Accent | Stress |
|---|---|---|---|---|---|
| **Night** | The Field (markets, money in motion) | warm black | bone | amber (particles, positions) | crimson (drawdown, crisis regime) |
| **Paper** | Cortex, Lab, Ledger, Treasury, Charter | warm paper | near-black ink | vermilion for money and actions; teal for the mind (Cortex only) | vermilion fill |

The mode belongs to the instrument, not to the visitor. Moving from the Field to the Lab crosses from night to paper with a view transition.

## Tokens

Colors in OKLCH. Variants with `color-mix()`. Grays use hue `none`.

| Token | Value | Use |
|---|---|---|
| `--night` | `oklch(0.14 0.012 60)` | Field ground |
| `--night-2` | `oklch(0.19 0.012 60)` | Field panels |
| `--amber` | `oklch(0.80 0.13 75)` | Particles, positions, live state |
| `--amber-dim` | `oklch(0.55 0.08 70)` | Filaments, quiet labels |
| `--crimson` | `oklch(0.56 0.17 28)` | Stress: drawdown, crisis regime, kill |
| `--paper` | `oklch(0.955 0.008 85)` | Paper ground (never pure white) |
| `--paper-2` | `oklch(0.92 0.01 85)` | Panels on paper |
| `--ink` | `oklch(0.20 0.01 85)` | Text and hairlines on paper |
| `--ink-soft` | `oklch(0.50 0.01 85)` | Secondary text |
| `--rule` | `oklch(0.80 0.01 85)` | Rules and panel borders |
| `--vermilion` | `oklch(0.62 0.19 33)` | Money, actions, the one hot number |
| `--teal` | `oklch(0.60 0.09 200)` | The mind (Cortex lobes and tracts) |
| `--bone` | `oklch(0.92 0.012 85)` | Text on night |

Chroma ceiling 0.19 (vermilion only); everything else ≤ 0.13. Nothing neon.

| Type role | Face | Use |
|---|---|---|
| Labels, data, captions | IBM Plex Mono 400/600, caps micro-titles tracked +0.08em | Panel titles, tape, IDs, tables |
| KPI numerals | IBM Plex Sans Condensed 600, `tabular-nums` | Header KPIs, counters |
| Body | IBM Plex Sans 400 | Paragraphs, the constitution, reports |

Type scale: one fluid `clamp()` scale (good-css). KPI numerals are the only large type.

| Other | Value |
|---|---|
| Radius | 0. Chips 2 px. |
| Borders | 1 px `--rule` on paper, `--night-2` lines on night |
| Shadows | None |
| Glow | Only additive blending on particles and filaments in the Field. Never on UI chrome. |
| Spacing | 4 px base; gaps, not margins |
| Motion | UI 120 / 200 / 320 ms; scene motion slow and continuous; color temperature changes over 1 to 3 s |

## Composition rules

1. One dominant form per instrument, edge to edge: the cloud field, the brain, the arc.
2. Under it, an instrument strip of 6 to 8 dense panels, each with a caps micro-title and a live number.
3. A KPI header row: caps label over big numeral. At most one KPI in the accent color.
4. Callout boxes with hairline leader lines explain parts of the dominant form.
5. Numbers tell the story: counters that fill, costs struck through, streaks that grow.
6. Captions state facts only when true (`NO HUMAN IN THE LOOP`, `WAITS FOR COUNSEL: 2`).

## Banned (the vibe-coded list)

| Banned | Our rule instead |
|---|---|
| Harsh gradients | None. Night ground is flat; depth comes from particle density |
| Lucide icons | Our own small glyph set drawn as hairline SVG at cap height |
| Pure white background | `--paper`, never `#fff` |
| Rainbow coloring | One accent per mode plus stress |
| Drop shadows | None |
| 3 feature cards in a row | No marketing cards. Instruments only |
| Emojis | None, in UI and in posts |
| Liquid glass | None |
| Em dashes | None in UI copy and posts |
| Inter, Geist, Space Grotesk | Not loaded |
| Colored left stripe | None |
| Fake testimonials | None. Only real numbers |
| Bento grids | Instrument strips are rows of equal-height panels under one dominant form, not a bento |
| Terminal window | No fake window chrome. Logs are mono lists inside normal panels |
| "It's not X, it's Y" | Banned phrasing |
| Checkmark bullets | Plain lists or tables |
| 3 pricing tiers | No pricing. Seats are a curve shown as a curve |
| No real product demos | Every instrument shows live data on load |
| Soft corner radius | 0 |
| Purple and black | No purple. Night is warm black with amber |
| No skeleton loaders | Every streaming panel has a shaped skeleton |
| Radial orbs | No glowing orbs. Clouds are irregular point fields; counters are plain numerals |
| Dot grids | No dot-grid backgrounds. Pixel glyph clusters only as data marks |
| Sparkle icons | None |
| Animated arrows | None |
| No TOS | `/terms` in every footer |
| No privacy policy | `/privacy` in every footer |
| Hover animations | No hover motion. Focus rings and press feedback only |
| Neon colors | Chroma ceiling 0.19, amber 0.13 |
| Basic pastel colors | Paper, ink, amber, vermilion, teal, crimson only |

## CSS rules (from good-css)

Logical properties; `min-width: 0` on text-holding grid and flex children; `text-wrap: balance` on headings; `svh`/`dvh`; container queries for panels; `overflow: clip`; `:focus-visible` rings; hover styles only inside `@media (hover: hover)` and only color; motion inside `prefers-reduced-motion: no-preference`; `@starting-style` for enter and exit; View Transitions between instruments; 44 px hit areas; never disable zoom.

## Components: do not rebuild

| Need | Source |
|---|---|
| Counters, split-flap tickers, scrambled and decrypted text reveals, circular text on arcs | react-bits: `CountUp`, `Counter`, `SplitFlapText`, `DecryptedText`, `ScrambledText`, `CircularText` |
| Filament and thread backgrounds | react-bits: `GhostFibers`, `Threads`, `WebThreads` (restyled; Field uses our own GPU particles) |
| Contour backgrounds | react-bits: `Topography` |
| Gauges and dials | react-bits Micro: `CometDial`, `SloshGauge` |
| Thinking lines, status marks, loaders | react-bits Micro: `ThoughtLine`, `StatusMark`, `LatticeLoader` |
| Scrub controls (Rewind) | react-bits Micro: `ScrubField` |
| Transitions, number pop-ins, skeletons | transitions.dev |
| Charts from rows | tweenly |
| Panels, sheets, inputs | shadcn primitives restyled (radius 0, no shadow, Plex, our glyphs) |

react-bits is MIT with the Commons Clause: we may use its components in our site, but we must not sell or redistribute the components themselves. Every imported component is restyled to these tokens and checked against the banned list.

## Copy

Plain words, numbers exact, active voice. The agent's own words follow its terse voice (docs/09, `SOUL.md`). Simulated content is always labeled SIMULATED. Footer on every page: Terms, Privacy, Disclosures, Proofs, Constitution.
