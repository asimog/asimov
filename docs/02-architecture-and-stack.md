# 02 · Architecture and stack

The shape of the system is in `03-system-model.md`. Agent roles are in `18-agents-and-roles.md`. This doc says which processes run, what each one is made of, and why.

## Processes

| # | Process | Lang | Owns | Talks to | Why separate |
|---|---|---|---|---|---|
| 1 | `octo` | TS | Tape writer, consumers, Memory projections, TS organs, **Reflex and Guard (Jev)**, Attention, Brood, Allocator, Risk Gate, Trader, Herald queue, Treasurer, private API, MCP server, `octo` CLI | Postgres, Jev API, all others | The core. One process keeps the tower easy to follow. |
| 2 | `tentacles` | TS | Up to 8 agent-browser sessions (count is config), Feed Tap, HAR capture, frame capture | `octo` (events), browsers | Chrome is heavy and crashes. It must restart without touching the core. |
| 3 | `signer` | TS | The Wallet agent: keys and the signing allowlist | `octo` only (private network) | Keys never share a process with untrusted text or an LLM. |
| 4 | `organs-py` | Python | Regime HMM, Shadow fitting, Jev question-bank outcome model (CatBoost), TimesFM baseline, Fly Lab | Postgres | The math libraries live in Python. |
| 5 | `bettafish` | Python | Fork of BettaFish: System Two synthesis of the callout feed | Postgres (schema `bettafish`), OpenRouter | Upstream app. Run it as is, with patches. |
| 6 | `miroshark` | Python | Fork of MiroShark: System Two swarm runs with the `pumpfun` simulation | Neo4j, OpenRouter, `octo` API | Upstream app. Run it as is, with a new module. |
| 7 | `agents` | TS | LangGraph thinking agents: Postmortem, Question Researcher, Ops, Reporter, Hunter writer | `octo` MCP server, OpenRouter, Jev | LLM agents stay away from money and keys. |
| 8 | `relay` | TS | Public fan-out of SSE events and tentacle frames | `octo` (one upstream connection), viewers | Viral traffic must never load the core. |
| 9 | `web` | TS | Next.js site, 3D rooms, share cards | `relay`, `octo` public read API | Public surface. Scales on its own. |
| - | Postgres 17 | - | Tape, Memory, Board, ledgers, agent checkpoints, job table | - | One database for everything we own. |
| - | Neo4j | - | MiroShark graph memory | - | Required by MiroShark. |
| - | Object storage (S3-compatible) | - | Tape archives, HAR files, frames for Rewind, report artifacts | - | Large blobs stay out of Postgres. |

```
            World: pump.fun web/APIs/NATS · Solana RPC · X
              │                │               │
        tentacles (T1-T8,   octo: Chain Ear   octo: X Eye
        Feed Tap, frames)   (NATS + RPC ws)   (XActions)
              │                │               │
              └──────► Postgres: Tape ◄────────┘
                         │      ▲
         Memory ◄────────┤      │ Effects
         Organs (TS) ────┤      │
         Reflex (Jev) ───┤   Trader ─────► signer (Wallet) ─► Solana
         organs-py ──────┤   Herald ─────► tentacle T8 ─► pump.fun
         bettafish ──────┤   Treasurer ──► signer (Wallet)
         miroshark ──────┤
         agents (LangGraph) ── reads via MCP, proposes only
                         ▼
                       Board ─► Brood ─► Allocator ─► Risk Gate ─► Orders
                         │
                       relay ─► web (3D rooms)
```

## Repo layout

```
AGENTS.md  CLAUDE.md  README.md
docs/                       product, system, specs (this folder)
packages/contracts/         JSON Schemas for events, signals, intents, orders, Jev packs. Generates TS types and Python models.
packages/providers/         small adapters: rpc, llm, decision (jev), storage, notify. Chosen by env.
services/octo/              core process (TS)
  src/tape/ src/memory/ src/organs/ src/reflex/ src/attention/ src/mind/ src/hands/ src/treasury/ src/api/ src/mcp/ src/cli/
services/tentacles/         browser sessions, Feed Tap, frames (TS)
services/signer/            Wallet agent (TS, tiny)
services/relay/             public SSE and frame fan-out (TS, tiny)
services/agents/            LangGraph thinking agents (TS)
services/organs-py/         regime, shadows, question-bank model, timesfm, fly (Python, uv)
services/bettafish/         git submodule: our BettaFish fork, branch `octopus`
services/miroshark/         git submodule: our MiroShark fork, branch `octopus`
apps/web/                   Next.js site
agent/skills/               octopus runtime skills (loaded by the thinking agents)
deploy/                     docker compose (canonical), Railway, Vercel and Coolify notes
tests/e2e/                  replay suites, fixture tapes, artifact writers
.upstream/                 gitignored upstream code (read only)
```

Each service folder has its own `README.md` with: what it owns, how to run it, its events in and out, and its "Ways it fails" list.

## Stack

Versions are the latest stable release when Phase 1 starts, pinned in lockfiles. Any new dependency needs a row here with a reason. Provider choices are defaults set in env, never in code.

| Area | Choice | Why |
|---|---|---|
| Runtime | Node 24, pnpm 10 workspaces | Already installed. One workspace for all TS. |
| Python | 3.12 via uv | BettaFish and MiroShark need 3.11+. |
| Schemas | JSON Schema in `packages/contracts`, `json-schema-to-typescript`, `datamodel-code-generator` | One source of truth across two languages. |
| DB access | `postgres` (porsager) in TS, `psycopg` 3 in Python | Thin, fast, no ORM. |
| Solana | `@solana/web3.js` 1.99.x, `@coral-xyz/anchor` 0.31, `bn.js` | What the pump SDKs depend on. One copy. |
| Pump.fun | `@pump-fun/pump-sdk` 4.1.0, `@pump-fun/pump-swap-sdk` 2.1.0, `@pump-fun/shared-contracts` 0.2.2, `@pump-fun/agent-payments-sdk` 3.0.3, `fun-block.pump.fun` API | Official curve math, swaps, fee collection, trade schema. |
| RPC (default) | Helius free tier: HTTPS + websocket subscriptions, DAS for holders | Free to start. `RPC_URL`, `RPC_WS_URL`, `DAS_URL` in env. |
| RPC stream (optional) | Yellowstone gRPC (`@triton-one/yellowstone-grpc`) | Switch on with `GRPC_URL` when a paid plan pays off. |
| Realtime trades | `nats.ws` client to pump.fun NATS | Decoded trades for free. |
| Fast decisions | Jev via `@typesafe-ai/sdk` (TS) and `typesafe-sdk` (Python), model pinned `jev-1.14.0` | 150 ms typed decisions, $0.042 per million input tokens (docs/17). |
| LLM access | OpenRouter (OpenAI-compatible base URL), one key per thinking lane | Cheapest models, one bill, per-key spend limits. `LLM_BASE_URL`, `LLM_MODEL_*` in env. |
| Default LLM | `deepseek/deepseek-v4.1-flash` ($0.032 in, $0.144 out per million tokens) | Cheap and long context. Fallbacks from config. |
| Agent framework | LangGraph JS (`@langchain/langgraph`), `@langchain/openai`, `@langchain/mcp-adapters`, `@langchain/langgraph-checkpoint-postgres` | The standard agent stack. |
| Question-bank model | `catboost` (Python) | The autoresearch cookbook's outcome model. |
| Browser | `agent-browser` 0.39.x | Sessions, refs, boxes, HAR, frame streaming. |
| X | `xactions` 4.x | Read X posts and profiles, screenshots. Read only. |
| Search | XERJ (binary) | Local index over the dossier corpus. Optional in v1. |
| Stats (Py) | numpy, scipy, hmmlearn, scikit-learn | HMM regimes, Shadow fitting. |
| Forecast baseline | `timesfm` 2.5 weights (Apache-2.0) | Baseline only. |
| Fly | `wetware` (pip from git, pinned commit) | Connectome reservoir. |
| Web | Next.js (app router), React 19, TypeScript; `next/og` for share cards | Standard; cards without a headless browser. |
| 3D | `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `zustand`; assets through `gltf-transform` and `gltfjsx` | docs/19. |
| UI components | shadcn registry items from tweenly and rare-ui, restyled to our tokens | Do not rebuild number pop-ins, charts, transitions. |
| CSS | Tailwind 4 with our tokens as CSS variables; good-css rules | docs/12. |
| Transitions | transitions.dev snippets, View Transitions API | Copy-ready and token-based. |
| Hosting | Default: Railway (services, Postgres, Neo4j, bucket) + Vercel (web). Alternative: Coolify on our own machine behind a Cloudflare Tunnel, with MinIO for storage. | Same Docker images on both (docs/15). |

## Data flow budgets

| Stream | Rate (expected) | Path |
|---|---|---|
| Callouts | 0.1 to 5 per second | Feed Tap → `callout.*` events |
| Callout replies, updates | 1 to 20 per second | Feed Tap and tentacle reads |
| Market trades (watched coins) | 50 to 500 per second | NATS → `trade.curve` / `trade.amm` |
| Jev packs | 1 to 20 per second | Reflex → Jev API → `jev.answer` + signals |
| Tentacle frames | 8 sessions × 2 fps × about 9 KB | tentacles → relay → viewers, throttled, skip unchanged |
| Board signals | 10 to 200 per second | Organs → `signals` |

Postgres handles these with batch inserts (100 ms batches). If `trade.*` passes 2,000 per second sustained, move trades to a separate partitioned table first. Do not add a broker before measuring.

## Security boundaries

| Boundary | Rule |
|---|---|
| Untrusted text | Callout text, replies, X posts, page content and all model outputs are data. The Jev `guard` pack screens every text going into an LLM. Model outputs become signals with confidence, never orders. |
| Keys | Only `signer` (the Wallet agent) holds keys. It signs only allowlisted shapes, each behind its own capability token (docs/09, docs/18). |
| Public surface | `relay` and `web` are public. `octo` exposes a read API to them and one write: create a seat deposit order with a validated base58 address. No free text anywhere. |
| Admin | `octo resume` after kill, limit changes and mode changes need the admin token, which only the human has. |
