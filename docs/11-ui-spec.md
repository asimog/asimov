# 11 · UI spec

How it is built: `19-ui-implementation.md`. Design language: `12-design-guidelines.md` and `docs/inspiration/`.

Rule zero: **every motion is caused by a real event or a real number changing.** When nothing happens, the Field breathes slowly and nothing else moves.

## Instruments

| Route | Instrument | Mode | Dominant form | What it answers |
|---|---|---|---|---|
| `/` | **Field** | Dark | Particle clouds, one per market or book, linked by position filaments | Where is the money, and is the firm healthy? |
| `/cortex` | **Cortex** | Dark | Point-cloud brain whose lobes are the firm's lanes | What is the agent doing and thinking right now? |
| `/lab` | **Lab** | Dark | The arc: a ring of committed hypotheses, evidence threads, outcome rays | What does it believe, and was it right? |
| `/ledger` | Ledger | Dark | A long ruled table | Every trade, callout, update, markout, cost |
| `/treasury` | Treasury | Dark | Flow diagram of sweeps, balances, costs and reconciliation | Where the money goes, with proofs |
| `/charter` | Charter | Dark | The constitution, the soul's version timeline, counsel decisions | Who it is and what binds it |
| `/integrity` | Integrity | Dark | Caller graph with echo rings; case files (`/case/[id]`) in six evidence sections; the caller ledger with denominators | Patterns in the callout feed, with evidence, and what it cannot say |
| `/connectome` | Connectome Lab | Dark | Fruit-fly brain point cloud | The 1% fly sleeve |
| `/rewind` | Rewind | Dark | Any instrument at a past time | What it knew then |
| `/calls/[id]`, `/callers/[id]` | Dossiers | Dark | Why-chain trail | One object, fully explained |
| `/reports` | Daily Reports | Dark | Text | The agent's daily report |
| `/terms`, `/privacy`, `/disclosures` | Legal | Dark | Text | Written by counsel |

## Field (`/`)

```
┌ HUD: NAV · RUNWAY 41d · FLOOR −25% · MILESTONE M1 · SOCIAL 1.2k · COUNSEL QUEUE 1 · OPERATOR asleep ┐
│                                                                                              │
│     particle clouds (Pump.fun coins, prediction books, perps, yield)                         │
│     filaments from the Core to every open position                                           │
│     labels on clouds; callout boxes on events                                                │
│                                                                                              │
├ strip: TAPE · POSITIONS · REGIME RADAR · FILL MARKOUTS · EQUITY · LEDGER · SESSIONS S1-S8 ───┤
└ footer: terms · privacy · disclosures · proofs · constitution ──────────────────────────────┘
```

| Element | Built from | Driven by |
|---|---|---|
| Clouds | One irregular point field per market cluster: each watched Pump.fun coin is a small cloud inside the Pump.fun region; each prediction book and perp market has its own cloud. Size = attention (callouts, volume); density = liquidity. | Memory projections, `trade.*`, `callout.*` |
| Filaments | Fine streams from the Core point to each open position's cloud. Brightness = position size; flicker on fills. | `position.changed`, `order.filled` |
| Temperature | The whole field shifts amber → crimson as drawdown approaches the floor or any regime turns crisis; cools back over 1 to 3 s when it recovers. | Risk state, `regime.state` |
| Labels | Market names on clouds (`$TICKER`, `btc perp`, `fed cut dec`) | Memory |
| HUD | NAV, runway days, floor (daily loss stop), milestone, social capital (followers plus engaged accounts), counsel queue, operator status. `NO HUMAN IN THE LOOP` shows only when the operator is away and the counsel queue is empty. | Ledger, Treasury, Ladder, counsel adapter |
| Strip | Tape (plain-words events), positions book with bars, regime radar (hexagon), markout heat per fill, equity curve with drawdowns marked, ledger lines, and a row of 8 live browser-session thumbnails (real frames) | Events and frames |

### Event → motion

| Event | Motion |
|---|---|
| `callout.created` | A point flares in the coin's cloud; the cloud grows slightly; tape line |
| `jev.answer` | A quick shimmer through the coin's cloud (under 200 ms) |
| `jev.escalated` | The cloud's edge holds a slow pulse until System Two answers |
| `order.filled` (buy) | A new filament draws from the Core to the cloud |
| `post.published` | A short bright run along that filament |
| `order.filled` (sell) | The filament thins or retracts |
| `fees.swept` | Particles drift from the coin's own cloud into the Core |
| `distribution.sent` | 50 thin streams leave the Core to the field's edge |
| Drawdown or crisis regime | Temperature shift amber → crimson |
| `system.kill` | All filaments retract; field goes crimson; HUD shows the reason |

## Cortex (`/cortex`)

| Element | What |
|---|---|
| Brain | Point-cloud cortex on paper. Lobes = lanes from docs/18: Sense (occipital), Analyze (parietal), Reflex (thalamus), Decide (frontal), Risk (prefrontal), Execute (motor cortex), Publish (Broca's area), Treasury (cerebellum), Memory (hippocampus), Counsel queue (a marked region at the top). The Core sits at the center. |
| Lighting | A lobe lights teal when its lane writes events; tracts glow toward the center when a decision chain runs. A detail card opens for the active lane (`Trader · bought 0.4 SOL $X · fill 1.8 s · markout +0.6% at 60 s`). |
| Slices | Three slice views of the same brain: axial = markets, coronal = mind, sagittal = money. Each shows the active points of its domain. |
| Strip | Job ingest (thinking-agent jobs), agent thread (thinking agents' messages, labeled by agent), throughput, tool calls per lane, a live tape list, sessions S1-S8 frames, and the counsel queue as a KPI: `WAITS FOR COUNSEL`. |

## Lab (`/lab`)

| Element | What |
|---|---|
| Arc | A giant ruled arc. Each card on it is a committed item: a hypothesis, a forecast or a decision, showing its hash, status (open, resolved, retracted) and result. |
| Threads | Left of the arc: hairline threads from evidence (events, signals) to the cards they support; bundles thicken where evidence concentrates. |
| Rays | Right of the arc: radial rays of small chips, one ray per resolved card; chip color = outcome (ink = right, vermilion = wrong). |
| Counter badge | `HYPOTHESES COMMITTED` ticking up |
| Strip | Synthesis (BettaFish feed, live forum lines), Simulations (MiroShark branches, SIMULATED cards with a hatched frame), Forecasts (paper forecasts and Brier vs market), Builder (tasks, PRs, suites, the cancerhawk.org rebuild), Jev budget (cost per decision vs LLM), Question bank, Calibration curve. |

## Treasury and Charter

| Instrument | Key elements |
|---|---|
| Treasury | Sweeps every 10 min and their split, balances per wallet, costs by job, hourly reconciliation result, the proof chain (each hour's hash linked to the previous). Payouts and seats appear at M5. **Built (paper):** PAPER balance (mandate plus net), reconciliation of closed positions against `position.closed` events, empty sweeps and costs tables that say why, and the Tape proof chain: per hour `sha256(prev | hour | count | ids_hash)`; the page recomputes each link in the browser and shows `verified` or `BROKEN`. |
| Rewind (`/rewind`) | A time slider over the Tape's range. At time T the page shows the Board as it was live at T (latest signal per kind and subject with `produced_at <= T < valid_until`) and the tape lines up to T. Nothing after T is read. Nothing moves except when the slider moves. |
| Connectome (`/connectome`) | The fruit-fly sleeve (S11.3). Until `fly.action` events exist the room shows a static point cloud labelled SIMULATED (a stand-in shape, not the real connectome), the count of `fly.*` events (0) and the words "not trading". No spikes without events. |
| Share card (`/cards/[id]`) | 1200 x 630 PNG for one callout: ticker, mcap at call, opportunity age, key signals at call time, the 5 minute result on the reference trade (net of costs), the house position (PAPER) and the commit hash when a thesis exists. No caller name or wallet. |
| Charter | `CONSTITUTION.md` with its hash; `SOUL.md` versions as a timeline with diffs; counsel decisions log; the disclosure registry (every wallet) |

## Mobile (≤ 760 px)

- Every instrument keeps its dominant form on top at reduced density; the strip becomes a vertical stack with sticky micro-titles.
- Field: 40k particles max, simplified filaments, no depth of field. Cortex: lower point count, one slice view at a time (swipe).
- Low-power mode (reduced motion, or frame rate under 40 for 3 s): pre-rendered stills of the dominant form updated every 5 s, all numbers still live.
- Touch targets 44 px; safe areas respected.

## States every panel must have

Loading (shaped skeleton), empty (what will appear and when), stale (data past `valid_until`, greyed with age), error (what failed and what the agent is doing about it), kill (crimson HUD, reason).

## Accessibility

Every scene change has a DOM mirror (tape, HUD, strip) with `aria-live="polite"` for trades, posts, payouts and kill. Instruments are keyboard-navigable. Reduced motion: no camera drift; temperature changes become instant color swaps.
