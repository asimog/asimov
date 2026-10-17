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

## Kill switch and pauses

| Command | Effect | Who |
|---|---|---|
| `ctl pause hands` | Trader and Publisher stop taking new work; open orders finish | Owner, Ops agent |
| `ctl kill` | Cancel pending orders, stop all hands, keep senses and the Tape recording | Owner, Ops agent |
| `ctl resume` | After kill | Owner (admin token) |
| Limits or budget caps change | New version in config | Owner (admin token) |

Automatic kill triggers: daily loss stop hit, Signer refuses 3 requests in 10 min, fill-model drift above 3× for an hour, Feed Reader gap longer than 5 min while positions are open.

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

Several free RPC endpoints act as one. Each request goes to the first healthy endpoint in `RPC_URLS` order that has room under its own requests-per-second limit. Pattern: carbon's transaction crawler (`.upstream/repos/sevenlabs-hq__carbon/datasources/rpc-transaction-crawler-datasource`): retries with backoff from 1 s, doubling, capped at 10 s.

- A 429, a 5xx, a network error or a timeout (`RPC_TIMEOUT_MS`, default 8000) rests that endpoint (1 s, 2 s, 4 s, up to 10 s) and the request moves to the next one. A success clears the rest.
- A JSON-RPC error (for example a bad parameter) is returned as is, never retried: another provider would say the same.
- When every endpoint is resting, the request waits for the soonest one, at most `RPC_MAX_TRIES` (default 6) attempts in all.
- Endpoint URLs carry API keys. They live only in `.env.local`. Logs and `ctl doctor` print endpoint names, never URLs.
- `ctl doctor` checks each endpoint by name with `getHealth`.
- Money paths (S6 Trader) will send transactions through one chosen endpoint, never spray them across providers.
