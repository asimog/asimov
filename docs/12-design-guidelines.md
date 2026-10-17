# 12 · Design guidelines

## Who decides

1. The owner's words.
2. **impeccable** (`.claude/skills/impeccable`). It wins every conflict with other skills.
3. This doc.
4. Advisors: `design-taste-frontend` (public pages), Emil Kowalski's skills (`animate`, `find-animation-opportunities`, `review-animations`, `improve-animations`, `animation-performance`, `emil-design-eng`), transitions.dev skills, the r3f skills.

When an advisor disagrees with impeccable or this doc, follow impeccable or this doc, and do not argue the point in code comments.

## Direction: the specimen tank

A living cephalopod studied under lab light in deep water. Real biology colors, instrument-grade data type, sharp glass. Futuristic through what it does (a creature reading live pages), not through neon.

## Tokens

Single dark world by choice. Colors in OKLCH, variants with `color-mix()`. Grays use hue `none`.

| Token | Value | Use |
|---|---|---|
| `--abyss` | `oklch(0.17 0.015 230)` | Page ground. Never pure black, never white. |
| `--trench` | `oklch(0.21 0.015 230)` | Panels, plates' backing |
| `--silt` | `oklch(0.30 0.012 230)` | Hairlines, dividers |
| `--bone` | `oklch(0.93 0.012 85)` | Main text, plate frames |
| `--fog` | `oklch(0.70 0.015 230)` | Secondary text |
| `--rust` | `oklch(0.64 0.14 40)` | Primary accent: the octopus, our own actions |
| `--ochre` | `oklch(0.78 0.11 80)` | Exits, warnings, greed |
| `--verdigris` | `oklch(0.72 0.07 175)` | Perception: tentacle reads, buys |
| `--madder` | `oklch(0.55 0.15 25)` | Losses, kill, danger |
| `--umber` | `oklch(0.42 0.05 55)` | Simulated content hatch, retired genomes |

Chroma ceiling: 0.16. Nothing neon.

| Type role | Face | Use |
|---|---|---|
| Display | Unbounded 600/800 | Room titles, tickers, big numbers on cards |
| Body | IBM Plex Sans 400/500 | Text |
| Data | IBM Plex Mono 400/600, `tabular-nums` | Every number, IDs, tape |
| Specimen label | IBM Plex Serif italic 400 | Rare labels only ("Octopus vulgaris · T4") |

Type scale: one fluid scale from good-css (`clamp()` with rem plus vw, capped so text still scales with zoom).

| Other | Value |
|---|---|
| Radius | 0 to 2 px. Plates and panels 0. Chips 2. |
| Borders | 1 px `--silt`; plate frames 1 px `--bone` at 60% |
| Shadows | None. Separation by contrast and hairlines. |
| Spacing | 4 px base; gaps, not margins, between siblings |
| Motion tokens | Durations 120 / 200 / 320 ms; ease-out for enter, ease-in for exit; springs only for the 3D arms. UI motion stays under 300 ms. |

## Banned (the vibe-coded list)

| Banned | Our rule instead |
|---|---|
| Harsh gradients | Only the water depth gradient, lightness steps ≤ 6% |
| Lucide icons | Our own small glyph set (arm, sucker, plate, flare, ink), drawn as SVG at text cap height |
| Pure white background | Never. `--abyss` everywhere |
| Rainbow coloring | Max 2 accents per view plus semantic colors |
| Drop shadows | None |
| 3 feature cards in a row | No marketing card rows at all. The product is the demo |
| Emojis | None, in UI and in the octopus's posts |
| Liquid glass | Plates are clear glass with a hairline frame, no blur, no frost |
| Em dashes | None in UI copy and posts. Use periods or commas |
| Inter, Geist, Space Grotesk | Not loaded |
| Colored left stripe | No accent stripes on cards or rows |
| Fake testimonials | None. Only real ledger numbers |
| Bento grids | None. Layout follows the scene and the data |
| Terminal window | No fake terminal chrome. Data is set in mono type inside normal panels |
| "It's not X, it's Y" | Banned phrasing |
| Checkmark bullets | Plain lists or tables |
| 3 pricing tiers | No pricing. Seats are a curve, shown as a curve |
| No real product demos | The live Tank is the homepage |
| Soft corner radius | 0 to 2 px |
| Purple and black | No purple. Ground is blue-gray slate |
| No skeleton loaders | Every streaming view has shaped skeletons |
| Radial orbs | No glowing orbs. Coins are drawn as specimen tags or chart marks |
| Dot grids | Bathymetric contour lines instead |
| Sparkle icons | None |
| Animated arrows | None |
| No TOS | `/terms` linked in every footer |
| No privacy policy | `/privacy` linked in every footer |
| Hover animations | No hover motion. Focus rings and press feedback only |
| Neon colors | Chroma ceiling 0.16 |
| Basic pastel colors | Earth and sea pigments only (rust, ochre, umber, verdigris, bone) |

## CSS rules (from good-css)

- Logical properties (`margin-inline`, `padding-block`).
- `min-width: 0` on flex and grid children that hold text.
- `text-wrap: balance` on headings, `pretty` on body.
- `svh`/`dvh` units for full-height views; `scrollbar-gutter: stable`.
- Container queries for components (plates, chips, tables), media queries only for page layout.
- `overflow: clip` instead of `hidden` where scroll is not wanted.
- `:focus-visible` rings in `--bone`; hover styles only inside `@media (hover: hover)` and only color changes.
- Motion inside `@media (prefers-reduced-motion: no-preference)`.
- `@starting-style` and `allow-discrete` for enter and exit; View Transitions for room changes.
- Hit areas at least 44 px, larger than the visual where needed.
- Never disable input zoom.

## Components: do not rebuild

| Need | Source |
|---|---|
| Number pop-in, odometer, text swap, skeleton, sliding tabs, toasts | transitions.dev snippets (`transitions-dev` skill) |
| Charts from row data, animated counters | tweenly (shadcn registry) |
| Rare animated pieces | rare-ui (shadcn registry), one at a time, checked against the ban list |
| Panels, sheets, inputs | shadcn primitives, restyled to our tokens (radius 0, no shadow, Plex type, our glyphs) |
| 3D | drei helpers (`Instances`, `Line`, `Text`, `PerformanceMonitor`, `AdaptiveDpr`) |
| Graph rendering | visualize-web3-realtime pattern (GPU instanced nodes) |

Every imported component is restyled to the tokens before it ships. Lucide icons in shadcn components are replaced with our glyphs.

## Copy

- Plain words, active voice, numbers exact.
- The octopus's own words follow the caveman voice (docs/09).
- Every page footer: Terms, Privacy, Disclosures, Proofs.
- Simulated content is always labeled SIMULATED.
