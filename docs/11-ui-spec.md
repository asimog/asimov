# 11 · UI spec

How it is built (assets, shaders, frames, choreography): `19-ui-implementation.md`.

Rule zero: **every motion on screen is caused by a real event.** The 3D scene subscribes to the same event stream as everything else. When nothing happens, the octopus breathes slowly and the water drifts. Nothing else moves. Design tokens and bans are in `12-design-guidelines.md`.

## The Tank (`/`)

### Layout (desktop)

```
┌──────────────────────────────────────────────────────────────┐
│ header: OCTOPUS · mode · war chest · open positions · clock  │
├──────────────────────────────────────────────┬───────────────┤
│                                              │ Mind strip    │
│      3D scene: octopus + 8 glass plates      │ (top coins,   │
│      in an arc around it                     │  key signals) │
│                                              ├───────────────┤
│                                              │ Event tape    │
├──────────────────────────────────────────────┴───────────────┤
│ footer: terms · privacy · disclosures · proofs               │
└──────────────────────────────────────────────────────────────┘
```

### Scene graph

| Node | Build | Driven by |
|---|---|---|
| Water | Dark gradient volume, 3 to 5 additive light shafts, instanced marine snow (2k points desktop, 600 mobile) | Time only (ambient) |
| Seabed | Low plane with bathymetric contour lines from a noise height field | Static |
| Mantle | Sculpted mesh (or SDF baked to mesh), skin shader below | `mood.skin`, breathing |
| Arms ×8 | Each arm is a chain of 24 segments solved by FABRIK IK toward a target, rendered as a tapered tube with instanced suckers on the inner side | Tentacle state, sucker boxes |
| Plates ×8 | Thin glass panes with a hairline bone frame and sharp corners, each with a texture updated from the frame relay | `tentacle.*` events, frames |
| Specimen tags | Small text cards that travel from a sucker up the arm into the mantle | `tentacle.read` extracted facts |
| Flares | A small rising light from the mantle to the surface | `post.published` (callout) |
| Ink | Particle cloud near a plate or the Reef | `echo.ring`, `hunt.finding` |

### Skin shader (the signature)

Real cephalopod skin has three cell layers. We draw all three, driven by data.

| Layer | Biology | Our mapping |
|---|---|---|
| Chromatophores | Pigment sacs that expand and contract (rust, ochre, umber) | Voronoi cells. Expansion per cell type follows `mood.skin`: greed expands ochre, fomo expands rust, fear contracts all (pale), disgust darkens umber. |
| Iridophores | Structural sheen | A faint view-angle sheen in muted verdigris. Only on the mantle top. |
| Leucophores | White scattering spots | Bone-white flecks. They brighten when the octopus is sure (high max signal confidence on its focus coin). |

Chromatophore pulses ("passing clouds", like real octopus) travel across the mantle when a big event arrives. Waves go faster during a wave regime on a held coin.

### Arms and plates

- Each arm belongs to one tentacle T1-T8. The arm's root is fixed on the mantle; its tip targets the plate.
- When a frame carries sucker boxes, the box center is mapped into plate UV and then world space. The arm tip moves there, and one sucker pulses on contact.
- `tentacle.read` with extracted facts: one specimen tag per fact ("@caller · 42 calls · median age +60%") rides up the arm.
- `tentacle.health = crashed`: the arm curls back and the plate fogs over ("regrowing"). It comes back when the session is up.
- T8 (Voice) types a post: the plate shows the real page as the text appears. On `post.published`, a flare rises from the mantle.

### Event → motion map

| Event or signal | Motion |
|---|---|
| `callout.created` | A small card enters T1's plate at the top of the real feed; the T1 arm taps it. |
| `attention.grant` (tentacle job) | The granted arm lifts and swings to its plate; the plate's URL label changes. |
| `tentacle.read` | Sucker pulse at each read box; specimen tags travel up. |
| `regime.state` changes for a held coin | Chromatophore cloud passes; mind strip row changes state chip. |
| `jev.answer` (fast mind) | A quick ripple of leucophore flecks across the mantle, under 200 ms, once per pack. The mind strip row shows a small "S1" chip with the answer's confidence. |
| `jev.escalated` | The ripple stops at the mantle's top and holds as a slow glow: the octopus is "thinking slow" on that coin. The mind strip row shows "S2". |
| `swarm.run` started | A faint second set of ghost arms (outline only) on the MiroShark side of the tank; ends when done. |
| `synthesis.run` started | The mantle's leucophores dim and pulse slowly until done. |
| `order.filled` (buy) | The mantle contracts once (a "grab"), position chip appears in the header. |
| `post.published` | Flare to the surface. |
| `order.filled` (sell) | The mantle relaxes; the position chip number pops. |
| `fees.swept` | Plankton drifts down from the surface into the mantle (every 10 min). |
| `distribution.sent` | 50 thin currents leave the tank toward the edge (hourly). |
| `system.kill` | All arms curl, ink fills the tank, red state in header. |

### Mind strip and tape

- Mind strip: up to 6 coins the octopus cares about now. Per coin: regime chip, wave odds, opportunity age, position, last action. A row updates with a number pop-in when its signals change.
- Tape: the last 40 events in plain words, color-coded by layer. Tapping any line opens its why-chain in a side sheet.

### Interaction

- Desktop: drag to orbit within limits, scroll inside the page (never hijacked by the scene), click a plate or arm to bring that plate forward, Esc to return.
- Mobile: see Mobile below.
- Focus and press states only. No hover animations.

## Other rooms

| Room | Main visual | Real source |
|---|---|---|
| `/synthesis` | A lab notebook. Left: the live forum transcript, agent name per line, cited callouts as inline chips that open the callout. Right: the latest Feed Synthesis rendered section by section with the transitions.dev UI-generation reveal when a new report lands. | `synthesis.forum_line`, `synthesis.feed`, `mood.skin` |
| `/simulations` | Two columns. Left: a simulated callout feed, every card stamped SIMULATED with a hatched frame so it cannot be mistaken for real. Right: Branch A vs B fan charts of callers and net SOL. | `swarm.run`, `swarm.post`, `swarm.*` signals |
| `/brood` | A coral. Each genome is a polyp; lineage is the branching. Live genomes are lit; probe genomes glow faintly; retired ones calcify white. Tap a polyp for its spec, scores and trades. | `genome.*`, `allocation.set`, `genome_scores` |
| `/ledger` | Dense table: time, coin, action, size, price, PnL, follower PnL, link to callout and tx. Number pop-ins on new rows. | `money.*` |
| `/hunt` | Caller graph (GPU instanced, the visualize-web3-realtime pattern). Echo rings sit inside ink clouds. Findings list with evidence. | `echo.ring`, `hunt.finding` |
| `/treasury` | Flow view of sweeps, war chest, hourly pools, seats; the proof chain as a list of segments with hashes. | `fees.swept`, `profit.hour_closed`, `distribution.*` |
| `/seats` | 21 seat slots, taken ones show owner (shortened wallet) and live lifetime SOL earned. Price chart: floor curve plus the live premium fading since the last sale. Deposit panel: payout wallet input, deposit address, amount, QR, 15-minute countdown, live status. | `seat.*`, `deposits`, `seat_market` |
| `/reports` | Daily Tide Reports in the caveman voice, with links to every cited trade. | Reporter agent output |
| `/fly` | 3D fly brain from soma positions (fly-connectome-template pattern, with its attribution line). Actual simulated spikes light neurons; the readout's choice and the fly's PnL. | `fly.action`, fly sleeve ledger |
| `/rewind` | The Tank at a past time: a scrubber, the Board rebuilt at that moment, plates showing stored frames. | Tape archive, frames |
| `/calls/[id]`, `/callers/[id]` | Dossiers with why-chains drawn as a vertical causal trail from observation to outcome. | `octo why` over the public API |

## Mobile (≤ 760 px)

- The Tank becomes vertical: octopus in the top 40% of the screen, one plate full width below it, tape under the plate.
- Swipe the plate area or tap an arm to change tentacle. A row of 8 small tentacle chips shows which ones are active.
- 3D at device pixel ratio ≤ 1.5, 12 segments per arm, no depth of field, 600 snow points.
- **Low-power mode** (prefers-reduced-motion, or frame rate under 40 for 3 seconds): the 3D scene is swapped for a 2D pixel-art octopus sprite sheet (hand-made in Piskel) with the same states, and plates as plain images.
- Touch targets 44 px or more. Safe-area insets respected.

## Performance budgets

| Item | Budget |
|---|---|
| Shell JS (gz) | ≤ 250 KB |
| 3D chunk | Lazy loaded after first paint |
| Desktop frame rate | 60 fps on an M1 or RTX 3060 class machine |
| Mobile frame rate | ≥ 30 fps on a mid-range 2024 Android |
| Plate textures | 8, updated in place; frames decoded with `createImageBitmap` in a worker |
| Event stream | One SSE connection for events, one WebSocket for frames |

## States every view must have

Loading (skeleton loaders shaped like the real content), empty (says what will appear and when), stale (data older than its `valid_until`, shown greyed with age), error (what failed, what the octopus is doing about it), and kill (red header, reason).

## Accessibility

- Every 3D state change also appears in the DOM (tape and mind strip), with `aria-live="polite"` for buys, sells, posts and kill.
- Plates and arms are reachable by keyboard (Tab cycles T1-T8, Enter brings forward).
- Reduced motion: no camera drift, arms move without easing overshoot, chromatophore clouds replaced by a color change.
