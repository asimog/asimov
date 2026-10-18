# 19 · UI implementation plan

How the site is built: app structure, data flow, the three instrument renderers, frames, choreography, mobile and testing. What it shows: `11-ui-spec.md`. Tokens and bans: `12-design-guidelines.md`.

Key simplification: **no hand-made 3D models.** The Field, the Cortex and the Lab are generated from data and math at runtime. The only static assets are fonts and a few hairline SVG glyphs.

## App structure (`apps/web`)

```
app/
  layout.tsx                 shell: HUD, footer, <SceneRoot/> mounted once for all routes
  page.tsx                   / Field
  cortex/ lab/ ledger/ treasury/ charter/ integrity/ connectome/ rewind/ reports/
  calls/[id]/ callers/[id]/
  cards/[id]/route.tsx       share card image (next/og ImageResponse)
  terms/ privacy/ disclosures/
components/
  scene/                     R3F: SceneRoot, FieldClouds, Filaments, CortexCloud, Tracts, Slices, FlyCloud
  lab/                       Arc (DOM cards on an arc), Threads (canvas 2D), Rays (canvas 2D)
  hud/                       Hud, Tape, Strip panels, WhySheet
  ui/                        shadcn primitives restyled; react-bits, tweenly and transitions.dev pieces
lib/
  stream/                    SSE client, frame WebSocket client, event normalizer
  store/                     zustand stores: events, board, positions, milestones, social, sessions, cues
  choreo/                    Animator: event → cue with rate limits
  layout/                    worker-side cluster layout and point sampling
workers/
  frames.worker.ts           decode JPEG frames with createImageBitmap
  layout.worker.ts           cluster layout and point generation
```

### One canvas, many views

`SceneRoot` mounts one `<Canvas>` in the root layout. Instruments place 3D views into DOM slots with drei's `<View>`. Moving from the Field to the Cortex never recreates the WebGL context. The page background switches mode (night or paper) with a View Transition; the canvas clear color follows.

### Rendering modes

| Route | Server | Client |
|---|---|---|
| Instruments | Server components fetch a snapshot (HUD numbers, last 40 tape lines, positions, milestone) so first paint has real data | Client takes over with SSE |
| Dossiers | Fully server-rendered, cached 30 s | Live updates if open |
| `/cards/[id]` | `next/og` image: ticker, entry, opportunity age, key signals, exit ladder, result, commit hash | none |

## Data flow

```
core → relay SSE ─► stream client ─► normalizer ─► stores ─► Animator ─► cues ─► scene (useFrame)
relay frames WS  ─► frames worker ─► ImageBitmap ─► session atlas texture (texSubImage2D)
stores (markets) ─► layout worker ─► point buffers ─► FieldClouds attributes (in place)
```

Stores are zustand slices read with selectors. The scene reads cues inside `useFrame`; React never re-renders per frame.

### The Animator (truthful and readable)

| Rule | Value |
|---|---|
| Cloud flares | At most 4 per cloud per second; extra events add to a count shown on the cloud label |
| Filaments | Created or removed only on real position changes; a fill flicker lasts 400 ms |
| Temperature | Follows the risk state with a 1.5 s critically damped transition; never animated without a state change |
| Cortex lobes | Lit while their lane has written an event in the last 2 s; tract pulses at most 2 per second per lobe |
| Lab cards | Added on commit, flipped on resolve; never shuffled for effect |
| Tape | Lines group by second: "12 callouts" expands on tap |

Every cue keeps its source event ids, so clicking anything in a scene opens its why-chain.

## Field renderer

| Part | Technique | Budget |
|---|---|---|
| Cluster layout | Each market cluster (venue, coin, book) is a node. A force layout in `layout.worker.ts` places clusters: same venue attracts, correlated markets attract, size from attention. Layout updates at 1 Hz, eased. | 1 worker |
| Point clouds | Per cluster, points sampled inside an irregular blob: sum of 3 to 6 noise-displaced spheres seeded by the market id, so each market has a stable, unique shape. Points stored in one big `BufferGeometry` (positions, cluster index, seed). Rendered as one `Points` draw with a custom shader: size by depth, color amber mixed toward crimson by a `uTemperature` uniform, additive blending, alpha by local density. | 200k points desktop, 40k mobile, 1 draw call |
| Breathing | Vertex shader offsets each point by low-frequency noise over time; amplitude scales with the cluster's live volume | in shader |
| Filaments | Instanced line strips (drei `Line` or a custom instanced ribbon) from the Core to each position's cluster, curved by a bezier with noise; additive, thin | ≤ 200 filaments |
| Labels | MSDF text (drei `Text`, IBM Plex Mono) billboarded on cluster centers, culled by distance | ≤ 60 labels |
| Session thumbnails | One 2048 × 2048 atlas holds 8 session frames at 640 × 360; updated in place with `texSubImage2D` from the frames worker | 1 texture |
| Postprocessing | Mild bloom on the additive layer only, SMAA. No depth of field on mobile. | - |

## Cortex renderer

| Part | Technique | Budget |
|---|---|---|
| Brain cloud | Procedural: two hemispheres from deformed ellipsoids with folded-noise displacement (gyri and sulci), sampled into points on and just under the surface. Each point carries a lobe id from its position (fixed region rules). No external brain mesh, so no license issue. | 120k points desktop, 30k mobile |
| Lobe lighting | Uniform array of 10 lobe intensities; points of a lit lobe shift ink → teal and brighten | in shader |
| Tracts | Bezier tubes (thin lines) from each lobe center to the Core center; a traveling dash shows a decision chain in flight | ≤ 40 lines |
| Slices | Three small orthographic `<View>`s of the same cloud with a clipping plane each (axial, coronal, sagittal) | 3 extra renders at low resolution |
| Detail cards | DOM elements positioned from projected lobe centers, with hairline leader lines | DOM |

## Lab renderer (2D, crisp text)

| Part | Technique |
|---|---|
| Arc | An SVG arc with tick marks. Cards are DOM elements placed along it with CSS transforms (rotate along the tangent), virtualized so only visible cards exist. Scroll or drag rotates the ring. |
| Threads | Canvas 2D: hairline quadratic curves from evidence points to card anchors; bundling by grouping shared endpoints; redrawn only when cards or evidence change |
| Rays | Canvas 2D: one ray per resolved card with outcome chips |
| Counters | react-bits `CountUp` and `SplitFlapText` |

## Other instruments

| Instrument | Build |
|---|---|
| Ledger | Virtualized table; number pop-ins (transitions.dev); filters as sliding tabs |
| Treasury | SVG flow diagram; dashes animate only when a sweep or payout event arrives; proof chain list |
| Charter | Markdown render of the constitution and soul; soul diffs as side-by-side; counsel log table |
| Integrity | GPU-instanced graph in a `<View>` (visualize-web3-realtime pattern) |
| Connectome | Soma positions as instanced points; spikes from `fly.action`; attribution line |
| Rewind | A range slider; on release, fetch `/v1/board?at=<ms>` (Board at T plus the tape lines up to T). Replay at 1×, 4× or 16× comes later with stored frames |

## Relay endpoints added for S5 (read-only, cached a few seconds)

| Path | Returns |
|---|---|
| `/v1/treasury` | `as_of`, `mode` (PAPER), `mandate_sol`, paper balance, reconciliation (positions net vs `position.closed` net), `sweeps` and `costs` (empty until S6), `chain` (24 hourly links) |
| `/v1/board?at=<ms>` | `at`, `range {from,to}`, `signals` live at `at` (kind, subject, symbol, value, confidence, produced_at, valid_until), `lines` (last 40 non-trade lines before `at`) |
| `/v1/connectome` | `fly_events`, `state` |
| `/v1/cards` | ids of 20 sample callouts that have a measured outcome |
| `/v1/card/:id` | the fields a share card prints |

## Assets

| Asset | Source | Format |
|---|---|---|
| Fonts | IBM Plex Mono, Plex Sans, Plex Sans Condensed (OFL) | WOFF2, subset, self-hosted |
| MSDF font atlas | Generated from Plex Mono | PNG + JSON |
| Glyph set | Hand-drawn hairline SVGs (venue, unit, lane, counsel, proof, seat) | Inline SVG |
| Low-power stills | Rendered from the live scene every 5 s on the server for mobile low-power mode | WebP |

## Performance

- drei `PerformanceMonitor` + `AdaptiveDpr`: DPR 2 → 1, then point count halves, then low-power stills.
- `frameloop="demand"` when the tab is hidden.
- Buffers allocated once; layout updates write into existing attributes.
- Draw calls: ≤ 20 on the Field desktop, ≤ 12 mobile.
- Shell JS ≤ 250 KB gz; 3D chunk lazy-loaded after first paint.

## Testing the UI (E2E)

- `site-shell`, `site-field`, `site-cortex`, `site-lab`, `site-integrity`, `site-treasury`, `site-rewind`, `site-cards` (suites under `tests/e2e/suites`, shared driver `tests/e2e/lib/site.ts`) drive the real site with agent-browser at 1440 × 900 and 390 × 844, wait for real events, and save screenshots. They need the relay (7401), the web app (7402) and Postgres running; they read the working database and write nothing. Each run writes screenshots and the compared numbers into its artifact folder.
- Visual diffs with `agent-browser diff screenshot --baseline`; diffs over threshold fail and save the diff image.
- Truth check: every HUD number and tape line on screen is looked up through the API and must match.
- Motion check: record a 10 s screen capture and run it through the `video-frames` skill; every visible change must line up with an event in the tape for that window.
- Performance: 60 s scripted session; 95th-percentile frame time within budget.
