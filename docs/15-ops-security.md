# 15 · Ops and security

## Providers are config

Every outside service is chosen by env (for RPC: `RpcPool` in `services/core/src/lib/rpc.ts`). Code never names a provider.

| Role | Env | Default | Alternatives |
|---|---|---|---|
| RPC (HTTPS, websockets) | `RPC_URLS` (`name|rps|url`, comma-separated, in order of preference), else `RPC_URL`; `RPC_WS_URL` | Free tiers with fallback: Helius, Chainstack (Developer), RPC Fast (Start, 1.5M compute units a month), QuickNode | Any Solana RPC; paid plans |
| Holder data | `DAS_URL` | Helius DAS | `getProgramAccounts` on any RPC |
| Stream (optional) | `GRPC_URL`, `GRPC_TOKEN` | off | Yellowstone gRPC on a paid plan |
| Fast decisions | `JEV_BASE_URL`, `JEV_API_KEY`, `JEV_MODEL` | TypeSafe, `jev-1.14.0` | A future System One model |
| LLMs | `LLM_BASE_URL`, `LLM_KEY_<LANE>`, `LLM_MODEL_CHEAP`, `LLM_MODEL_SMART`, `LLM_MODEL_FALLBACK` | OpenRouter; `deepseek/deepseek-v4.1-flash` for cheap and smart; `qwen/qwen3.7-flash` fallback | Any OpenAI-compatible endpoint |
| Object storage | `S3_ENDPOINT`, `S3_BUCKET`, keys | Railway bucket | Cloudflare R2, MinIO (Coolify) |
| Alerts | `NOTIFY_URL` | Telegram bot | Any webhook |
| Session count | `SESSIONS` | 8 | 3 on the budget profile |

Lane keys: `LLM_KEY_SYNTH`, `_SWARM`, `_EXTRACT`, `_THINK`, `_OPS`, `_BUILD`, each with its own OpenRouter spend limit and a local limit `LLM_USD_HOUR_<LANE>`. `LLM_STUB=1` replaces every lane with the offline stub. Core MCP: `MCP_PORT`, `MCP_TOKENS` (`cap=token` pairs).

`ctl doctor` prints the active provider for each role and checks it.

## Deploy profiles

The canonical runtime is `deploy/compose.yaml`: one image per service. Both profiles run the same images.

### Profile A: Railway + Vercel (default)

| Service | Where | Size (start) | Public? |
|---|---|---|---|
| `core` | Railway | 1 vCPU, 2 GB | No (private API to relay and web) |
| `sessions` | Railway | 2 to 4 vCPU, 4 to 8 GB (by `SESSIONS`) | No |
| `signer` | Railway | 0.25 vCPU, 256 MB | **Never** |
| `relay` | Railway | 0.5 vCPU, 512 MB | Yes (SSE, frames), behind Cloudflare |
| `agents` | Railway | 0.5 vCPU, 1 GB | No |
| `analyzers-py` | Railway (plus a nightly cron service) | 1 vCPU, 2 GB | No |
| `bettafish` | Railway | 1 vCPU, 2 GB | No |
| `miroshark` | Railway (its own Railway config as a base) | 1 vCPU, 2 GB | No |
| Postgres, Neo4j, bucket | Railway | small plans | No |
| `web` | Vercel | - | Yes |

### Profile B: Coolify at home + Cloudflare Tunnel (learning, near-zero hosting cost)

- One machine runs Coolify with the same compose file. Postgres and Neo4j as Coolify resources, MinIO for storage.
- `cloudflared` exposes only `relay` and `web` through a Cloudflare Tunnel. No ports open on the router.
- `signer` binds to the Docker internal network only. It has no tunnel route.
- Backups: Coolify scheduled Postgres dumps to an off-machine bucket.

On both profiles, `ctl doctor` probes the signer from the public side and fails loudly if it answers.

## Secrets

| Secret | Lives in |
|---|---|
| Wallet keys, deposit seed | `signer` only |
| RPC keys | `core`, `sessions` |
| Jev key | `core`, `agents`, `analyzers-py` |
| OpenRouter keys (one per lane, each with an OpenRouter spend limit) | `bettafish` (A), `miroshark` (B), `core` extractor (C), `agents` postmortem and researcher (D), `agents` ops, reporter, integrity writer, social (E), `agents` Builder (F) |
| S8 session encryption key | `sessions` |
| Capability tokens | issued by the Signer and core at boot, one per lane |
| Admin token | Owner only; `core` checks a hash |

Never print secrets. Never commit `.env`. Never put a secret in a prompt.

## Config

Every env key has exactly one default, in `.env.example`; `.env.local` overrides and the process env wins. Code never carries a fallback: `env.num`, `env.int`, `env.bool` and `env.str` throw on a missing or malformed value and name the key, so boot stops instead of running with a silent `NaN` or `0`. Keys built at runtime (one per RPC endpoint or lane, such as `RPC_BUDGET_<NAME>`) use `env.numOpt`: unset means no cap, `0` means zero.

## Kill switch and pauses

| Command | Effect | Who |
|---|---|---|
| `ctl pause hands` | Trader and Publisher stop taking new work; open orders finish | Owner, Ops agent |
| `ctl kill` | `halted`: nothing trades or signs, pending orders fail, senses and the Tape keep recording. Writes `artifacts/KILL` itself, so it works with core down | Owner |
| `ctl resume` | Back to `running` | Owner (admin token) |
| `ctl limits set <key> <value>` and `ctl lists load <kind> <file>` | New version of the limits or a list, on the Tape | Owner (admin token) |

Automatic kill triggers move the firm to `exit_only` (no new buys; exits keep running so no position is stranded): live daily loss stop hit, Signer refuses 3 requests in 10 min, 3 live fills drifting 3x or more from their ghost twin within an hour, Feed Reader gap longer than 5 min while positions are open, a failed reconciliation, the Ops agent's `ops.stop_requested`.

**Built (S6.7, fix plan Phase 1), `treasury/kill.ts`.** One state: `ops.kill.state` (`running`, `exit_only`, `halted`), written only by the projection of `kill.changed` events. The consumer runs in its own loop, counts trigger occurrences in `ops.kill_counts` (restart safe), and rewrites `artifacts/KILL` with the state name after each change commits. Only live events trip it: a `daily_loss_stop` counts only from the live gate (source `riskgate.live`); paper desk rejections are `riskgate.paper`. Thresholds from env: `KILL_SIGNER_REFUSALS=3`, `KILL_REFUSAL_WINDOW_MIN=10`, `KILL_FEED_GAP_MIN=5`, `KILL_FILL_DRIFT_X=3`, `KILL_FILL_DRIFT_FILLS=3`, `KILL_FILL_DRIFT_WINDOW_MIN=60`. The Signer reads the file for every endpoint: no file is running, `exit_only` refuses buys, anything else refuses everything. Env numbers that do not parse stop boot with a named error, so a typo can never turn a trigger off.

Send endpoint: `TX_SEND_URL` is the one endpoint used to send and confirm (the Gatekeeper or the FluxRPC Shield URL from `.env.local`). `FUN_BLOCK_URL` defaults to `https://fun-block.pump.fun`. Treasury: `WALLET_TRADE`, `WALLET_CREATOR`, `WALLET_AGENT`, `WALLET_OPERATOR` (public keys), `COIN_MINT`. Signer client tokens (core side): `SIGNER_CLIENT_TOKEN_SWAP`, `SIGNER_CLIENT_TOKEN_TREASURY`. Live gate: `LIVE_STRATEGIES` (comma list of strategy ids), `ASIMOG_MODE=live`.

## Monitoring

- `ctl doctor`: Tape write lag, consumer lag, Board freshness per analyzer, Jev latency and error rate, session health, NATS and RPC connections, RPC credit projection, signer reachability (private yes, public no), budget burn, open positions without a fresh quote.
- Alerts to `NOTIFY_URL`: kill, any `system.*` drift or gap, budget exhausted, payout blocked, RPC budget at 80%.

## Budgets (low-cost defaults)

| Item | Cap | Expected cost |
|---|---|---|
| Jev | 1.5M input tokens per hour | about $1.50 per day at full use |
| BettaFish (lite) | feed run every 30 min + 6 coin runs per hour | about $1 to $3 per day |
| MiroShark (lite) | 6 runs per hour, $0.10 cap each | about $1 to $7 per day at full use, usually far less (escalations only) |
| Thinking agents | $1 per day per lane | under $5 per day |
| Extractor | 200k tokens per hour | under $0.10 per day |
| RPC | Helius free tier | $0 until upgraded |
| **Target total** | | **under $10 per day of model spend**, paid from W_agent from fee sweeps |

Presets nano, lite and full switch the System Two costs with one variable each (`BETTAFISH_PRESET`, `SWARM_PRESET`). Code never raises a cap.

## Backups and data safety

- Postgres daily backups plus point-in-time recovery (Railway) or scheduled dumps (Coolify).
- Tape archive files are written hourly to the bucket and never deleted.
- The deposit seed is backed up offline in two places; the signer refuses to start without the backup flag set by the owner.
- No agent drops, truncates or resets any table or bucket without the owner saying yes in the same conversation.

## RPC pool (`lib/rpc.ts`)

Several free RPC endpoints act as one. Each request goes to the first healthy endpoint in `RPC_URLS` order that may serve the method and has room under its requests-per-second limit and its monthly budget. Pattern: carbon's transaction crawler (`.upstream/repos/sevenlabs-hq__carbon/datasources/rpc-transaction-crawler-datasource`): retries with backoff from 1 s, doubling, capped at 10 s.

Free-tier limits we stick to (read from each provider's docs on 2026-10-17; edit `.env.example` when a plan changes):

| Provider | Requests/s | Monthly | Cost per call | Refused on the free plan |
|---|---|---|---|---|
| Helius | 10 (`getProgramAccounts` 5, DAS 2, `sendTransaction` 1) | 1,000,000 credits (not on the rate-limit page: check the dashboard) | 1 | none |
| Chainstack Developer | 5 on Solana mainnet (pricing page says 25: we take the lower) | 3,000,000 request units | 1 | `getProgramAccounts`, `getTokenLargestAccounts` (dedicated nodes only, error -32601) |
| RPC Fast Start | 15 | 1,500,000 compute units | 1 (`getProgramAccounts` 10) | `getProgramAccounts`, `getTokenAccountsByOwner`, `getTokenAccountsByDelegate`, `getTokenLargestAccounts` (limited query shapes, error -32099) |
| FluxRPC Free | 15 (third-party source: check) | 10 GB bandwidth, not counted by us | 1 | none known |
| QuickNode Free trial | 15 | 10,000,000 API credits | 30 for every Solana method (about 333k calls) | none listed; kept last |

- Order: Helius, Chainstack, RPC Fast, FluxRPC, QuickNode. A busy endpoint hands the request to the next one, so the order is also the spill order.
- Budgets: the pool counts units per endpoint, per UTC month, in `artifacts/rpc-usage.json` (saved at most every 5 s, so a crash can lose a few seconds of counts). An endpoint stops taking calls at `RPC_BUDGET_STOP` (default 95%) of its budget. Provider billing cycles are 30 days from signup, not calendar months: the count is a guard, the dashboard is the truth.
- A 429, a 5xx, a network error or a timeout (`RPC_TIMEOUT_MS`, default 8000) rests that endpoint (1 s, 2 s, 4 s, up to 10 s; a `Retry-After` header is honoured up to 60 s) and the request moves to the next one. A success clears the rest.
- A JSON-RPC error (for example a bad parameter) is returned as is, never retried: another provider would say the same. One exception: code -32099 "Method not available" or -32601 "dedicated nodes only" (plan refusals) adds the method to that endpoint's deny list for the run and moves on.
- Found live (2026-10-17): RPC Fast and QuickNode free plans take at most 5 keys in one `getMultipleAccounts`; callers batch by 5.
- `RPC_DENY_<NAME>` lists methods a plan refuses; the pool never sends them there. If no endpoint may serve a method, the call fails at once with a clear error.
- When every endpoint is resting, the request waits for the soonest one, at most `RPC_MAX_TRIES` (default 6) attempts in all.
- Methods that begin with `send` are refused by the pool. Money paths (S6 Trader) send through one chosen endpoint, never sprayed across providers.
- The slow-workers container reads strangers' text, so `docker-compose.yml` gives it `.env.example` plus a named list of the secrets it needs (`LLM_KEY_SYNTH`, `LLM_KEY_SWARM`, `EMBEDDING_API_KEY`, `TAVILY_API_KEY`, `SWARM_CORE_TOKEN`, `NEO4J_PASSWORD`), never the whole `.env.local`. A new worker secret gets a line there. The Signer refuses to start if its port (7410) is taken; BettaFish uses 7412, MiroShark 7411.
- Endpoint URLs carry API keys. They live only in `.env.local`. Logs and `ctl doctor` print endpoint names, never URLs. `ctl doctor` shows `getSlot` and budget used per endpoint.
- Websockets: `RPC_WS_URL` stays Helius. RPC Fast allows 1 concurrent subscription, Helius 5 connections. Other providers' `*_WSS` values are saved for later and unused.
- The Helius Gatekeeper URL (`HELIUS_GATEKEEPER_URL`) and FluxRPC Shield URL are saved but not in the pool: they share the plan of the same account and are meant for transaction sending (S6).

Ways the pool fails (written before its code; each has a test in `tests/e2e/suites/rpc-pool`):

1. An endpoint answers 429: it must rest and the call must move on, without losing the call.
2. A method the plan refuses is sent there anyway: it must never reach that endpoint.
3. Budget counts reset on restart: usage must survive a new pool and reset on a new month.
4. The rate limit is exceeded under a burst: calls to one endpoint must be spaced by 1/rps.
5. A JSON-RPC error is retried across providers and burns budget: it must be thrown at once.
6. A plan refusal (-32099) is treated as an outage: it must deny the method, not rest the endpoint.
7. A `send*` method goes through the pool: it must be refused.
8. An error message or log echoes a URL with its key: it must not.

