# 19 · UI implementation plan

How the website is built: app structure, data flow into the scene, assets, rendering, frames, animation choreography, mobile, and testing. What it shows is in `11-ui-spec.md`; tokens and bans are in `12-design-guidelines.md`.

## App structure (`apps/web`)

```
app/
  layout.tsx                 shell: header, footer, <SceneRoot/> mounted once for all routes
  page.tsx                   / Tank
  synthesis/ simulations/ brood/ ledger/ hunt/ treasury/ seats/ fly/ rewind/ reports/
  calls/[id]/ callers/[id]/
  cards/[id]/route.tsx       share card image (next/og ImageResponse)
  terms/ privacy/ disclosures/
components/
  scene/                     R3F: SceneRoot, Octopus, Arm, Plate, PlateAtlas, Water, Seabed, Flares, Ink, Tags
  hud/                       MindStrip, Tape, WhySheet, PositionChips, ModeBadge
  rooms/                     per-room 2D components
  ui/                        shadcn primitives restyled; tweenly and rare-ui items; transitions.dev snippets
lib/
  stream/                    SSE client, frame WebSocket client, event normalizer
  store/                     zustand stores: events, board, tentacles, positions, scene cues
  choreo/                    Animator: event → motion cues with rate limits
  api/                       typed REST client (generated from packages/contracts)
workers/
  frames.worker.ts           decode JPEG frames with createImageBitmap
public/
  models/ textures/ sprites/ fonts/
```

### One canvas for the whole site

`SceneRoot` mounts a single `<Canvas>` in the root layout, fixed behind the page. Routes place 3D content into DOM slots with drei's `<View>` (scissored viewports). The WebGL context is created once, so moving between rooms never reloads models or textures. The Tank uses a full-bleed view; other rooms use smaller views (the Brood coral, the Fly brain, the Hunt graph) or none.

### Rendering modes

| Route | Server render | Client |
|---|---|---|
| `/`, rooms | Server components fetch a snapshot (mind strip, last 40 tape lines, positions) so first paint has real data and share previews work | Client takes over with SSE |
| `/calls/[id]`, `/callers/[id]` | Fully server-rendered dossiers, cached 30 s | Live updates if open |
| `/cards/[id]` | `next/og` ImageResponse (Satori): ticker, entry mcap, opportunity age, key signals, exit ladder, result | none |

Share cards come from `next/og` because it is fast, cheap and deterministic. Herald attaches these images to callouts (replaces the screenshot approach in docs/09).

## Data flow into the scene

```
octo SSE  ─► stream client ─► normalizer ─► stores ─► Animator ─► scene cues ─► R3F components (useFrame)
frame WS  ─► frames worker ─► ImageBitmap ─► PlateAtlas texture (texSubImage2D)
```

- **SSE** (`/v1/stream?topics=...`) carries public events and signal changes. Each message has the event id, so the why-sheet can fetch `/v1/why/{id}`.
- **Frame WebSocket** (`/v1/frames`) carries binary messages: header (tentacle, seq, url, task id, sucker boxes as JSON) then JPEG bytes.
- Stores are plain zustand slices. Components read with selectors. The scene reads cues inside `useFrame`, never through React re-renders per frame.

### The Animator (truthful and readable)

Real event rates can reach dozens per second. The Animator keeps every motion true while keeping the screen readable:

| Rule | Value |
|---|---|
| Per arm | At most one reach every 600 ms; extra reads queue; queue over 5 collapses into one reach with a count tag ("+7 reads") |
| Callout cards on T1 | Real frame shows them; the arm taps at most twice per second |
| Specimen tags | At most 3 in flight per arm |
| Flares | Never collapsed. One per published callout |
| Chromatophore clouds | One at a time, new ones extend the current one |
| Tape | Lines group by second: "12 callouts" expands on tap |

Every cue keeps its source event ids, so tapping a moving thing in the scene opens the right why-chain.

## Plates and frames

- **One atlas texture** of 2048 × 2048 holds all 8 plates at 640 × 360 (3 × 3 grid, one cell spare for the T8 typing overlay). One material, one texture bind for all plates.
- The frames worker decodes with `createImageBitmap` and posts the bitmap to the main thread; the main thread uploads it into its atlas cell with `texSubImage2D`. No React work per frame.
- Frame rate per plate: up to 2 fps public (relay-side), skipped when unchanged.
- **Sucker mapping:** each frame header lists boxes in page pixels. `uv = box_center / viewport_size`, then UV → plate local → world. The arm's IK target moves there with a critically damped spring (no overshoot).
- A plate that is fogged (crashed tentacle) blends to a frosted texture with the word REGROWING set in the specimen label face.

## The octopus

### Assets

| Asset | Made with | Format | Budget |
|---|---|---|---|
| Mantle (head and body) | Sculpted in Blender, retopologized | glTF, Meshopt-compressed, via `gltf-transform` | ≤ 30k triangles desktop, ≤ 8k mobile (separate LOD) |
| Mantle detail | Baked normal map and cavity map from the sculpt | KTX2 (Basis), 2048² desktop, 1024² mobile | ≤ 3 MB total |
| Eyes | Separate small mesh, W-shaped pupil like a real octopus | in the same glTF | ≤ 2k triangles |
| Arms | Generated at runtime (no rig) | tube geometry along the IK chain | 24 segments × 12 radial desktop; 12 × 8 mobile |
| Suckers | One small mesh, instanced | `InstancedMesh` | 8 × 24 = 192 instances |
| Environment light | Small baked cubemap from Blender | KTX2, 256² | ≤ 300 KB |
| Seabed contours | Generated in a shader from noise | none | 1 draw call |
| Marine snow | Instanced points | shader | 2k desktop, 600 mobile |
| Specimen tag text | MSDF text (drei `Text`, troika) with IBM Plex Mono | font atlas | 1 atlas |
| 2D low-power sprite | Hand-drawn in Piskel, 64 × 64 frames, 4× nearest-neighbor | PNG sprite sheets | idle, reach (8 directions), grab, flare, ink, sleep |

`gltfjsx` generates typed components from the glTF. All assets are cache-busted by content hash and served with long cache headers.

### Shaders

**Skin (mantle).** A custom `MeshPhysicalMaterial` extension (onBeforeCompile) or a drei `shaderMaterial`:

- Chromatophores: 3D Voronoi cells in object space. Each cell has a type (rust, ochre, umber) from a hash. Cell radius = base × (1 + expansion[type]). Uniforms `uGreed`, `uFomo`, `uFear`, `uDisgust`, `uCalm` come from `mood.skin` (smoothed over 2 s).
- Passing clouds: a traveling band (uniform `uCloudPhase`, `uCloudStrength`) darkens cells as it sweeps; cues from the Animator start it.
- Iridophores: a faint fresnel sheen in verdigris, masked to the top of the mantle.
- Leucophores: bone-white flecks from a second Voronoi layer, brightness from the focus coin's signal confidence.
- Breathing: a slow vertex displacement along the normal (0.5 Hz), slower when calm.

**Arms.** CPU solves 8 FABRIK chains (24 joints) at 60 Hz, root fixed on the mantle. A vertex shader tapers the tube and bends suckers to face the inner side. Idle arms follow a slow noise curl. Suckers on contact get a short emissive pulse (the only bloom source besides flares).

### Postprocessing

`@react-three/postprocessing`: selective bloom on an emissive layer (suckers in contact, flares), SMAA, vignette, low film grain. Depth of field on desktop only, focused on the active plate. No chromatic aberration.

### Performance

- drei `PerformanceMonitor` + `AdaptiveDpr`: DPR from 2 down to 1, then LOD swap, then low-power 2D mode.
- `frameloop="demand"` when the tab is hidden; resume on visibility.
- All geometry and materials created once; arms update buffer attributes in place.
- Draw calls target: ≤ 40 on the Tank desktop, ≤ 20 on mobile.

## Rooms (2D-first)

| Room | Build |
|---|---|
| `/synthesis` | Two columns. Forum lines stream in with transitions.dev text reveal. Report sections land with the UI-generation reveal. Citation chips open the callout in a sheet. |
| `/simulations` | Simulated feed cards (hatched umber frame, SIMULATED stamp). Fan charts from tweenly charts fed with row arrays of runs. Preset badge (nano, lite, full) on each run. |
| `/brood` | Coral in a `<View>`: each genome a polyp (instanced), lineage as tubes. Calcified white for retired. Click opens a sheet with the spec and scores. |
| `/ledger` | Virtualized table, number pop-ins on new rows, filters as sliding tabs. |
| `/hunt` | GPU-instanced graph in a `<View>` (visualize-web3-realtime pattern), ink clouds as particle volumes around rings. |
| `/treasury` | Flow diagram in SVG with animated dashes only when a sweep or payout event arrives; proof chain list. |
| `/seats` | Price chart with the floor curve and the live premium; deposit panel: input, address with copy and QR, amount, countdown, status steps with skeletons. |
| `/fly` | Soma positions as instanced points in a `<View>`; spikes light points from `fly.action` frames; attribution line from fly-connectome-template. |
| `/rewind` | Scrubber; on release, fetch `/v1/board?at=` and stored frames for that minute; the scene replays cues from that window at 1×, 4× or 16×. |

## Mobile

- Layout per docs/11. One plate full width with swipe (CSS scroll snap, no JS carousel). Arm chips row for direct jumps.
- 3D mobile profile: DPR ≤ 1.5, mantle LOD, 12-segment arms, no DOF, bloom at half resolution.
- Low-power 2D mode uses the Piskel sprite sheets with CSS `steps()` animation and the plates as plain images.
- Safe areas, 44 px targets, no hover-dependent features.

## Testing the UI (E2E)

- `e2e/site-tank`, `e2e/site-labs`, `e2e/site-treasury` drive the real site with agent-browser at 1440 × 900 and 390 × 844, wait for real events, and save screenshots.
- Visual diffs with `agent-browser diff screenshot --baseline` against approved baselines; a diff over threshold fails the suite and saves the diff image as an artifact.
- Truth check: every tape line and mind strip value on screen is looked up through the API and must match.
- Performance check: a scripted 60 s session records frame times through the browser's performance API; the 95th percentile must stay within the budget.
