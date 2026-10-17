# 21 · First principles and team questions

Five disciplines each answer the same four questions: what a top professional would do that nobody asked for, the rawest material to start from, the methods and tools, and what (other than us) proves the result right. Every answer is recorded as a decision we build on. The last section answers every question needed to start implementation. Legal and compliance are out of scope here; counsel handles them.

Facts marked **(chain, 2026-10-17)** were read from Solana mainnet with `@pump-fun/pump-sdk` 4.1.0. Anything else not from a source is marked **estimate**.

## Mandate

The agent receives: the coin (already created, creator wallet handed over), the starting infrastructure, and **0.2 SOL**. The owner sets limits later; the defaults in docs/08 are sized for 0.2 SOL. Everything else it must earn.

## 1. Software engineer

| Question | Answer (recorded) |
|---|---|
| **What would a top engineer do that we did not ask for?** | Build a **walking skeleton first**: one thin path from the real feed to the Tape, one analyzer, one paper strategy, and the Field showing it, all running locally with one command, before any depth. Make time and randomness injectable from the first line (Clock, seeded RNG), so replays are deterministic forever. Generate types from the contracts instead of writing them twice. Log with event ids so any log line leads to a why-chain. |
| **Rawest material?** | The recorded discovery tape (HAR bodies, NATS frames, RPC responses), the SDK sources in `.upstream/npm/`, and real payloads, not docs about them. The first artifact of the project is a 10-minute fixture tape. |
| **Methods and tools?** | TypeScript strict, Node 24, pnpm workspaces; JSON Schema → TS types (`json-schema-to-typescript`) and runtime validation (`ajv`); Python 3.12 with uv; Biome for TS lint and format, ruff for Python; Docker Compose for local dev; the E2E replay harness (docs/14) as the only test layer. |
| **What proves it right?** | A fresh clone runs `pnpm dev` and `pnpm e2e` and gets the same report hashes as CI. |

## 2. Frontend and UI designer

| Question | Answer (recorded) |
|---|---|
| **What would a top designer do that we did not ask for?** | Design with **real data from day one**: replay the fixture tape into the UI instead of mock data. Write the **state-to-visual map** (every event and number → its visual) before drawing. Prototype the **hardest piece first**: the Field's 200k-point cloud on a mid-range phone. Set performance and accessibility budgets before polish. |
| **Rawest material?** | The four reference videos frame by frame (done: `docs/inspiration/`), the real event stream, real session frames, and performance traces from real devices. |
| **Methods and tools?** | impeccable critique loop; agent-browser screenshots and visual diffs; the `video-frames` skill to review motion frame by frame; React Three Fiber and drei; react-bits, transitions.dev and tweenly components; Chrome performance traces and Lighthouse. |
| **What proves it right?** | 95th-percentile frame time within budget on a mid-range Android; every visible change maps to a tape event (motion check, docs/19); visitors' time on page and shares measured with self-hosted, cookie-free analytics (Umami). |

## 3. Systems architect

| Question | Answer (recorded) |
|---|---|
| **What would a top architect do that we did not ask for?** | Write **SLOs** and **failure domains** before code: what may fail together, what must never. Plan for **replay at 10× speed** as the load test. Write the upgrade path for each component when its limit is hit (Postgres → partitioned tables → a broker), but build only the first step. Draw the trust boundaries (the Signer, the public relay, untrusted text) and keep them few. |
| **Rawest material?** | Measured rates from discovery (callouts per second, trades per second), provider limits (Helius free tier requests per second and credits), measured latencies (Jev p95, RPC confirm time, fill time), and the memory of 8 Chrome sessions. |
| **Methods and tools?** | Event sourcing on Postgres; LISTEN/NOTIFY with idempotent consumers and offsets; OpenTelemetry traces (Railway supports OTLP); chaos suites that kill processes; tape replay at 10× as load test. |
| **What proves it right?** | 10× replay with no consumer lag; chaos suites recover inside their budgets; an independent replay matches the report hash. |

### SLOs (recorded)

| SLO | Target |
|---|---|
| Callout seen to Tape | p95 ≤ 2.5 s (platform-bound) |
| Tape to signal (System One) | p95 ≤ 250 ms |
| Signal to order sent (fast lane) | p95 ≤ 450 ms |
| Order sent to confirmed | p95 ≤ 4 s (estimate on free RPC; measured in Week 2) |
| Event to visitor screen | p95 ≤ 1 s |
| Ledger vs chain mismatch | 0 lamports, hourly |

## 4. Backend designer

| Question | Answer (recorded) |
|---|---|
| **What would a top backend designer do that we did not ask for?** | Make **everything a projection of the Tape**, including the ledger. Then schema changes need no migrations: drop the projection and rebuild it from the Tape (this fits the "no migrations" rule). Use an **outbox** for every side effect (orders, posts, payouts), so a crash never doubles an action. Use **idempotency keys** everywhere. Keep three API surfaces small and separate: private core API, public relay API, MCP. |
| **Rawest material?** | Payload samples from HAR, SDK types, the NATS trade schema (`@pump-fun/shared-contracts`), and Postgres query plans under replay load. |
| **Methods and tools?** | `postgres` (porsager) with plain SQL; `ajv` validation at every boundary; **Hono** for HTTP and SSE (small, standard Request/Response); `@modelcontextprotocol/sdk` for the MCP server; a Postgres job queue (`FOR UPDATE SKIP LOCKED`); native Postgres partitioning by month. |
| **What proves it right?** | Rebuilding all projections from the Tape gives identical tables (hash per table); no orphan effects (docs/14 check 3); API p95 under budget during 10× replay. |

## 5. Trading desk

| Question | Answer (recorded) |
|---|---|
| **What would a top trader do that we did not ask for?** | Measure **execution quality before cleverness**: slippage versus model, land rate, time to fill and markouts, on the smallest possible size. Know the **cost floor** of every round trip before trusting any signal. Benchmark against dumb baselines. Close positions and accounts cleanly. Keep a journal of every decision and its reason (the why-chain). |
| **Rawest material?** | Our own fills and their on-chain receipts; the callout feed with exact timestamps; bonding-curve state; prediction-market order books and resolutions; BTC and ETH perp data for later. |
| **Methods and tools?** | Markouts at 1 s, 10 s, 60 s, 5 min; implementation shortfall; Brier score for forecasts; lower-confidence-bound fitness; fractional Kelly capped by capacity and bankroll; baselines such as "buy the first callout of every top-decile caller" and "buy nothing". |
| **What proves it right?** | Markouts and net PnL after all costs over a declared window; forecast Brier versus the market's own price; the ledger reconciling to the chain. |

### The cost floor at 0.2 SOL (recorded)

| Cost per round trip on the bonding curve | Size |
|---|---|
| Pump protocol fee 95 bps + creator fee 30 bps, each side **(chain, 2026-10-17)** | about 2.5% |
| Token account rent for a new coin | 0.0015 SOL **(chain)**: 7.5% of a 0.02 SOL trade, **refunded only if the account is closed after selling** |
| Base transaction fees | 2 × 5,000 lamports, about 0.05% at 0.02 SOL |
| Slippage | from curve math per trade |

Consequences for the desk:

1. The Trader **closes the token account after every full exit** to recover rent. Without this, rent alone eats the bankroll.
2. A trade needs an expected move above about **3%** just to break even. Fast genomes must clear that bar in their score.
3. Starting size: 0.02 SOL per trade, at most 5 open positions, so at least 0.1 SOL stays free for fees and rent.
4. Capacity is not the problem yet; cost is. The capacity limit (docs/22) matters later.

## 6. Questions to start implementation, answered

### Repo and tooling

| Question | Answer |
|---|---|
| Package manager and runtime? | pnpm 10 workspaces on Node 24 (`npx -y pnpm@10.29.3` on WSL); Python 3.12 with uv. |
| Folder layout? | docs/02 "Repo layout". New folders are created by the task that needs them (docs/13). |
| Lint and format? | Biome (TS), ruff (Python). One config each at the root. |
| Type sharing across languages? | JSON Schemas in `packages/contracts/schemas`, generated into `packages/contracts/ts` and `packages/contracts/py` by `pnpm gen`. |
| How do I run everything locally? | `docker compose -f deploy/compose.yaml up` for Postgres, Neo4j and MinIO; `pnpm dev` starts core, sessions, relay and web with live reload. |
| Where do secrets live locally? | `.env` at the root (gitignored), loaded by each service; `.env.example` lists every variable without values. |
| Commit style? | Conventional Commits; one change per commit; docs first in the same commit (AGENTS.md). |

### Runtime and data

| Question | Answer |
|---|---|
| Event ID format? | Prefixed ULIDs (`ev_01J...`), generated by the Clock-aware ID helper. |
| Time? | Only from the Clock (`clock.now()`); modes `replay`, `paper`, `live`. |
| How do consumers resume? | Offset per consumer in `tape.consumer_offsets`; at-least-once delivery; idempotent by event id. |
| Schema changes? | Change the schema, bump `v`, rebuild affected projections from the Tape. No migrations. Money projections are rebuilt the same way, then checked against the chain. |
| Large blobs? | S3-compatible storage (MinIO locally); events keep the key and sha256. |
| Where does the 0.2 SOL live? | W_trade. Its key is only in the Signer. |
| Coin creator wallet? | W_creator, handed over at start; its key goes into the Signer at setup. |

### Interfaces

| Question | Answer |
|---|---|
| Private API? | Hono app in core, on the private network: reads, `ctl` commands, admin endpoints behind the admin token. |
| Public API? | Relay only: SSE events, frame WebSocket, read endpoints cached at the edge. |
| Agent tools? | MCP server in core (`@modelcontextprotocol/sdk`), tools filtered by capability token. |
| CLI? | `ctl` (TypeScript, in core), JSON output with `--json`, same names as MCP tools. |

### Testing

| Question | Answer |
|---|---|
| First test? | `e2e/replay-determinism` on the discovery fixture tape. |
| Test runner? | A small TS harness (`tests/e2e/lib`) run by `pnpm e2e`; no unit-test framework. |
| Where are artifacts? | `artifacts/e2e/<suite>/<run>/` with `report.json`, `report.html`, `sha256.txt`. |
| Live-money tests? | Named `live-*`, sized at 0.01 SOL, run only by hand. |

### Deploy

| Question | Answer |
|---|---|
| First deploy target? | The owner's machine with Coolify plus a Cloudflare Tunnel, or Railway; same compose file (docs/15). |
| Web? | Vercel or the same host; it only talks to the relay. |
| CI? | GitHub Actions: lint, typecheck, `pnpm gen` diff check, E2E replay suites. |
| Observability? | Structured JSON logs with event ids; OpenTelemetry traces to the host; `ctl doctor`. |

### Trading

| Question | Answer |
|---|---|
| First venue? | Pump.fun bonding curve and PumpSwap, through `fun-block.pump.fun` with the SDK as fallback. |
| First strategies? | 5 seed families × 6 variants in paper; live only after the paper gate (docs/13 M3). |
| Position size? | 0.02 SOL, max 5 open, until the owner sets limits. |
| Callouts? | Posted by the Publisher from session S8 after a confirmed buy, position disclosed, exits as updates. |
| Forecasting? | Paper forecasts on Polymarket and Kalshi questions (BTC, ETH and crypto events first), committed with hashes, scored on resolution. |

### Agents and models

| Question | Answer |
|---|---|
| Fast decisions? | Jev `jev-1.14.0` through `@typesafe-ai/sdk` (docs/17). |
| LLMs? | OpenRouter, `deepseek/deepseek-v4.1-flash` by default; one key per lane. |
| Agent framework? | LangGraph JS in `services/agents`. |
| How does the agent write code? | The Builder agent (docs/18) works in a sandbox container with a git checkout, writes changes on a branch, runs the E2E suites, and opens a pull request. The owner merges until the self-modification gate in docs/22 is met. |

### UI

| Question | Answer |
|---|---|
| First screen? | The Field with real replayed data, HUD and strip (docs/11). |
| Component sources? | react-bits, transitions.dev, tweenly, shadcn primitives restyled (docs/12). |
| Fonts? | IBM Plex Mono, Plex Sans, Plex Sans Condensed, self-hosted WOFF2. |
| Analytics? | Self-hosted Umami, no cookies. |

## 7. Findings that shape the plan

1. **Cost before edge.** At 0.2 SOL, a round trip costs about 2.5% plus rent unless the token account is closed (§5).
2. **Growth is forced by capacity, later.** A 300 bps impact budget allows about 0.45 SOL into a fresh curve and about 1.7 SOL near graduation (curve math with `initialVirtualSolReserves` = 30 SOL **(chain)**; the graduation size is an **estimate**). That is far above our size today and becomes the limit only as capital grows.
3. **Social capital is capital.** Followers, engagement on our callouts, site visitors and bounty participants are a balance the kernel allocates to and measures, like SOL (docs/22).
4. **Markouts are the fastest truth.** Minutes, not weeks, to see whether we trade against smarter flow.
5. **Public forecasts are free credibility.** Paper forecasts on prediction markets build an outside-verified record from week one.
6. **Predicting is not profiting** (added 2026-10-17 from the literature, docs/research/literature-review.md). Graduation is predictable from early flow, yet the unconditional graduation curve sits below the buy-and-hold breakeven `vSol² / 115²` (arXiv:2602.14860), and 48 exit rules on the best launch segment all lost 10% to 17% (Chrisymcsoup/solana-launch-study). Our first tape agrees. Every claim of skill is therefore stated net of costs at our size.
7. **What we see is what our collectors saw.** Coverage and corrections are published with every number (docs/07 coverage).

## 8. What could we be wrong about?

1. The callout edge may not beat a 3% cost floor. If markouts stay negative after 100 live trades, the callout desk becomes the storefront and the data source, and capital goes to forecasting and later venues.
2. Free-tier providers may be too slow for the fast lane. Measured in Week 2; upgrade by config.
3. The fixture tape may not represent busy hours. Record more tapes at different times before trusting replays as load tests.
4. The Builder agent may produce plausible but wrong code. Every change goes through E2E suites and a PR until the gate is met.
5. The Field may be too heavy for phones. It is the first UI prototype for this reason.
6. Our callers may differ from the literature's. Papers studied creators, Telegram channels and graduated coins; callouts are a newer, platform-native signal. Their numbers are hypotheses to test on our tapes, never facts about Asimog.
