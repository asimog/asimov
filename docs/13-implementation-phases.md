# 13 · Implementation phases

Every step follows `AGENTS.md`: docs first, E2E test (watch it fail), smallest implementation, clean up. Every phase ends with an artifact under `artifacts/e2e/<suite>/<run>/` that anyone can regenerate.

The weekend builds the spine, the senses, the cheap organs, the paper Brood and the Tank. That is the part everything else plugs into, so it gets done properly. Labs, live hands and the token come after, on that spine.

## Phase 0 · Discovery (Friday evening, about 4 h)

| Step | Output |
|---|---|
| Finish installs in `services/octo`: `pnpm approve-builds` (allow agent-browser, bigint-buffer, bufferutil, utf-8-validate), then `pnpm exec agent-browser install` to fetch Chrome | `agent-browser --version` works |
| Deploy profile chosen (docs/15): Railway + Vercel, or Coolify + Cloudflare Tunnel. Postgres, a bucket, private network | Profile live; `deploy/compose.yaml` runs locally too |
| Provider keys: Helius free tier RPC, Jev (TypeSafe), OpenRouter (one key per thinking lane with spend limits) | Keys in env; `octo doctor` reaches each provider |
| HAR capture of feed, threads, profiles, coin pages (docs/06) | `docs/research/pumpfun-endpoints.md`, schemas in `packages/contracts/schemas/pump/` |
| NATS inspection | Subjects and connect options added to the research doc |
| T8 login and one manual test callout and update, posted by the owner's hand through T8 | Holding threshold, cooldowns, payloads recorded |
| A 2-hour recorded tape from a throwaway script that only writes raw observations | `tests/e2e/fixtures/tapes/discovery-2h.ndjson.gz` |

Acceptance: endpoint catalog covers read feed, read thread, read profile, post callout, post update, reply; the fixture tape exists. Delete the throwaway script after.

## Phase 1 · Spine (Saturday morning)

| Build | Notes |
|---|---|
| `packages/contracts` | JSON Schemas for envelope, topics, signals, intents, orders; generators for TS and Python |
| Tape | `tape.events`, writer role, batch insert, `NOTIFY`, consumer offsets |
| Clock | live, paper, replay |
| `octo` CLI | `state`, `tail`, `why`, `replay --report`, `doctor` |
| Replay runner | Reads a tape file, drives every consumer on a virtual clock, writes `report.json` + `report.html` + `tape.sha256` |

E2E: `e2e/replay-determinism`: replay the discovery tape twice, same report hash. `e2e/why-chain`: pick 20 random events, `octo why` reaches an observation for each.

## Phase 2 · Senses and Memory (Saturday afternoon and night)

| Build | Notes |
|---|---|
| Feed Tap | Endpoints from Phase 0, dedupe, gap detection, 48 h backfill |
| Chain Ear | NATS trades for the watched set; gRPC for curve state |
| Tentacles T1-T7 | agent-browser sessions, reading protocol, extractors for feed, thread, profile, coin page; frame relay |
| Memory projections | coins, callers, callouts, edges, bars_1m |

E2E: `e2e/live-capture-30m`: run 30 min live, export the tape, replay it, projections match the live database row for row. `e2e/gap-heal`: kill Feed Tap for 2 min during a capture; backfill closes the gap; T1-vs-Tap check reports zero missing. `e2e/tentacle-crash`: kill one Chrome; it regrows within 15 s; frames resume.

## Phase 3 · Cheap organs and Board (Sunday morning)

| Build | Notes |
|---|---|
| Board | `signals`, `live` view, in-memory mirror |
| Organs | age, echo (online part), hawkes, curve, regime v0 (fit on backfill), shadows tier 1 v0 (fit on backfill), hunt v0 |
| Reflex v1 | Jev packs `callout`, `coin`, `shadow`, `guard`; `jev.answer` on the Tape; pinned model; budget meter |
| Attention v0 | VOI table from docs/07 |
| Scorekeeper | Outcomes at 5 m, 30 m, 2 h, 6 h; Brier for `*_p` signals |

E2E: `e2e/organs-replay`: replay a 6 h tape; report shows signal counts, scores, and baselines; Jev answers come from the tape, zero live Jev calls. `e2e/reflex-live`: 30 min live; p95 Jev pack latency ≤ 200 ms; every answer recorded. `e2e/no-lookahead`: for every signal, all inputs have `seen_time` ≤ the signal's `produced_at`; zero violations allowed.

## Phase 4 · Paper Brood and the Tank (Sunday afternoon and night)

| Build | Notes |
|---|---|
| Genome interpreter + validator | docs/08 DSL |
| Seed Brood | 5 families × 6 variants |
| Fill model, ghost positions | Shared by replay and paper |
| Risk Gate and Allocator in paper mode | Real logic, simulated hands |
| Private read API, `relay` service for public SSE and frames | Read-only; viewers never connect to `octo` |
| Web: Tank, Ledger, mobile layout, legal page stubs linked in footer | 3D scene per docs/11 with real events and live plates |

E2E: `e2e/brood-replay`: replay a 6 h tape; ghost ledger report per genome. `e2e/fast-lane`: on a recorded tape, event-to-intent latency for fast genomes ≤ 300 ms in replay timing; no fast genome reads System Two signals. `e2e/site-tank`: agent-browser opens the site at desktop and phone sizes, waits for 3 real events, takes screenshots of the Tank and Ledger, checks that each visible tape line exists in the database. Artifacts: screenshots and a JSON of checked lines.

**Weekend exit:** OCTOPUS runs 24/7 in paper mode on Railway. The Tank shows real tentacle pages and real events.

## Week 1 · The labs

| Build | E2E |
|---|---|
| BettaFish fork with the patch set (docs/07), presets nano/lite/full by env, forum mirror, Jev `verify` on claims | `e2e/synthesis-run`: one run on a recorded window; every claim cites an existing callout |
| MiroShark fork with `simulations/pumpfun`, AMM port, presets by env, escalation-only trigger | `e2e/amm-golden`: 1,000 quotes match the TS SDK within 1 lamport; `e2e/swarm-run`: one A/B run on a recorded coin; result signals present |
| X Eye | `e2e/x-proof`: a post linked from a callout is stored with a screenshot |
| Rooms: `/synthesis`, `/simulations`, `/hunt` | `e2e/site-labs`: screenshots, SIMULATED labels present on every simulated card |

## Week 2 · Hands and evolution

| Build | E2E |
|---|---|
| Wallet agent (signer) with the allowlist and capability tokens | `e2e/signer-refuses`: forbidden transactions and wrong-capability requests, every one refused |
| `agents` process: LangGraph Postmortem and Ops agents, octo MCP server with per-agent tool filters | `e2e/agent-lanes`: each agent tries a tool outside its lane; every attempt refused and logged |
| Executor, live with pre-coin limits | `e2e/live-roundtrip`: one 0.05 SOL buy and sell on a liquid coin; fills match the chain |
| Herald with T8 login shim, templates, cards | `e2e/herald-post`: on a coin we hold, post a callout and an update; both visible on pump.fun; screenshots |
| Evolution loop, `/brood` | `e2e/evolution-replay`: 24 h replay; births, retirements, niches filled; no duplicate genomes |
| Rewind, Fly Lab | `e2e/rewind`: Board at time T rebuilt equals the Board that was live at T |

## Weeks 3 to 5 · The record

- Live trading at pre-coin limits, real callouts and exit updates, ink notes.
- Reporter, Hunter writer and Question Researcher agents; the daily Tide Report; the question bank's first promotions.
- Weekly review: useless organs flagged, budgets tuned, limits reviewed by the owner.

Launch gate: success measures in `01-product-spec.md` met for 3 weeks.

## Launch · The coin and the treasury

| Build | E2E |
|---|---|
| Coin creation with `create-coin` (owner confirms every parameter) | Mint exists; W_creator is creator |
| Fee sweep every 10 min | `e2e/sweep`: three sweeps; amounts match chain |
| Profit hours, HWM, holder samples, distributions, proofs | `e2e/distribution-replay`: a recorded day with a losing hour; payouts follow the HWM rule; proof chain verifies |
| Seats and deposits | `e2e/seat-flows`: exact pay, overpay, underpay then top-up, late deposit, wrong token, quote with premium decay; each ends in the right state |
| Holder clusters | `e2e/cluster-split`: a recorded hour with one whale split across 50 funded wallets; it ranks as one holder |
| `/treasury`, `/seats`, final legal pages | `e2e/site-treasury` screenshots |
