# Ops

How Asimog is configured, where its data lives, how big it gets, where it runs, how it stops, and how it is tested. Target design; gaps are rows in `PLAN.md`.

## 1. Configuration

**One home, one default, one schema, one way to change it.** Every setting belongs to exactly one kind below. A value appears in one place only. Code carries no fallback: a missing or malformed value stops boot and names the key.

| Kind | Examples | Lives in | Changed by | Checked by |
|---|---|---|---|---|
| Secrets | RPC URLs with keys, lane keys, signer tokens, `ADMIN_TOKEN`, keypair paths | `.env.local` only | Owner edits, restarts | Boot refuses a missing required secret |
| Process settings | Ports, poll intervals, windows, batch sizes, caps | `.env.example` (defaults), `.env.local` (overrides) | Edit, restart | zod config module at boot; `docs/generated/env.md` |
| Pipelines | Feed sources and filters, launch filters, retention windows per data class, schedules, escalation stages, model per agent type and the fallback chain | `config/*.json` (`feeds`, `filters`, `retention`, `schedules`, `models`) | Edit, then `ctl config reload` or restart | zod schema; `config.loaded` event with the file hash |
| Owner policy | Limits, lists, live strategies, mode | Versioned rows in `mind.limits`, `mind.lists`; defaults in `config/limits.default.json` | `ctl limits set`, `ctl lists load` with the admin token | Schema on load; `limits.changed`, `lists.loaded`; gates read as of now |
| Seeds | Strategy seeds, Jev question packs, voice rules, persona templates | `config/seeds/` | A change in the repo | Contracts schemas in tests |
| Protocol facts | Curve reserves, fee bps, rent, program ids | Code, with the protocol, as the Pump.fun SDK defines them | A change when the protocol changes | `amm-golden` against the official SDK |
| Catalogs | Topics, tables, signal kinds, env keys | Code (`TOPICS`, `schema.sql`, `CATALOG`, `.env.example`) | A change in the repo | `npm run docs:check` |
| Learned values | Evolved thresholds, Index scores, calibration maps, kernel shares | The Tape and projections | The firm itself | Replays reproduce them; never config |

**Models.** `config/models.json` names a default model, an override per agent type (synth, swarm, postmortem, researcher, ops, reporter, wiki) and a fallback chain that ends in OpenRouter's free models, called with a separate key `LLM_FALLBACK_KEY` from `.env.local`. `LLM_STUB=1` runs every lane on the offline stub and is refused in live mode.

**Providers are config.** RPC (`RPC_URLS` through `RpcPool`), the send endpoint (`TX_SEND_URL`), Jev, the LLM base URL, search, embeddings (`EMBEDDING_*`: OpenRouter embedding models through the OpenAI-compatible API, key `EMBEDDING_API_KEY` in `.env.local`), archive targets, wiki export targets and alerts are all chosen by env. Code never names a provider, URL or model.

## 2. Data

### Where each kind lives

| Tier | Data | Store | Kept |
|---|---|---|---|
| 0 Not stored | Trades of unwatched coins; feed items that fail filters | Memory only; folded into Index rollups; counted; 1% sampled | never |
| 1 Hot | Watched-coin trades, holder snapshots, raw feed pages, `observation.raw` | `tape.events` hourly partitions | 4 h while testing (raw feed pages 1 h), then archived and dropped; tuned after measuring |
| 2 Warm | Board signal history, bars, scraped replies | Postgres | Board 48 h, replies 14 d, then archived |
| 3 Indexes | Hourly rollups; wallet, coin, creator, caller scores; leaderboards | `idx.*` | Rollups 48 h, then compacted to wallet x coin and wallet x day; scores over 30 d; leaderboards hourly; light rebuild every 12 h, full rebuild every 48 h, deeper refresh weekly; weekly versions kept |
| 4 Record | Callouts that passed filters, decisions, orders, fills, books, kill, commits, outcomes, scores, lineage, Jev answers, slow reports | `tape.events` (kept partitions) and projections | Kept (callouts may move to archive after 90 d, owner's call) |
| 5 Archive | Every dropped partition | gzipped NDJSON files with a checksum, sent to one or more archive targets: a local folder, an S3-compatible bucket, or a git repository updated on a schedule | Kept |
| 6 Knowledge | Wiki pages | Postgres, versioned; markdown export to a wiki target (a bucket or a GitHub docs repository) | Kept |

Every window and target is a setting in `config/retention.json`. Budget for hot storage (tiers 1 to 4 and 6): 5 to 10 GB; everything older goes to the archive targets. The archive and wiki targets stay pluggable, so the owner can switch between a bucket and a git repository without code changes.

### How pruning stays safe

The Tape is append-only: no row is ever edited or deleted, and a database trigger refuses row `UPDATE` and `DELETE`. The only removal is whole blocks:

1. `tape.events` is partitioned by hour and by class (inputs-hot, inputs-kept, derived).
2. Every hour the archiver exports each closed hot partition to `tape-<class>-<hour>.ndjson.gz`.
3. It re-reads the file, compares row count and checksum, and writes `tape.archived` (file, rows, sha256) on the Tape.
4. It checks that every consumer's offset is past the partition, so the Index and Memory have already used it.
5. Only then it drops the partition. Dropping a partition is instant and leaves no half-deleted rows.

Think of the Tape as a notebook where no line is ever erased. When a full hour's page has been photocopied and the copy checked, the whole page is filed away. Replays and rebuilds read the archive files, so nothing is lost.

### How big it gets

These are estimates from measured rates (all trades about 232 per second, 131 KB/s on the wire). Measure them in the first week with `ctl stats` and adjust the windows.

| Data | If we stored everything | With filters and windows |
|---|---|---|
| All trades | about 20M rows and 12 to 20 GB a day | 0: kept only as rollups |
| Watched-coin trades (tier 1) | about 1 to 3 GB a day | 0.2 to 0.5 GB hot at any time (4 h window) |
| Board history (tier 2) | 0.3 to 5 GB a day | 1 to 10 GB for 48 h |
| Index (tier 3) | | 3 to 10 GB |
| Callouts kept (tier 4) | | 10 to 100 MB a day |
| Decisions, books, scores | | under 1 GB a year |
| Neo4j, wiki | | 1 to 5 GB |
| **Postgres total** | | **about 6 to 30 GB steady** |
| Archive files (tier 5) | | about 5 to 15 GB a month, growing |

## 3. Where it runs

| Part | RAM | Notes |
|---|---|---|
| Postgres | 2 to 4 GB | The main cost; fast NVMe matters most |
| Neo4j | 1 to 2 GB | Only for MiroShark `lite` and `full` graph memory |
| core | 1 to 2 GB | Scout hot set in memory |
| BettaFish and MiroShark workers | 3 to 6 GB while running | Python with CPU torch; images are several GB on disk |
| relay, web | under 1 GB | web can live on Vercel |

Minimum: 4 vCPU, 8 GB RAM, 100 GB NVMe, with `nano` presets and no Neo4j. Comfortable: 8 vCPU, 16 to 32 GB RAM, 200 to 500 GB NVMe.

| Option | What it is | Rough monthly cost | Good for |
|---|---|---|---|
| Owner's PC | Docker Desktop, Cloudflare Tunnel later | 0 | Development now; not reliable 24/7 |
| Hetzner cloud VPS | 8 vCPU, 16 GB, plus a volume | about 20 to 40 EUR | Always-on paper trading |
| Hetzner dedicated server | 6 to 8 cores, 64 GB, 2 NVMe disks | about 40 to 60 EUR | Best value once the stack runs 24/7 |
| Budget VPS (Contabo, OVH) | Lots of RAM per dollar, weaker disks and support | about 15 to 30 USD | Cheap experiments |
| Railway | Managed services, billed by use | about 50 to 150 USD or more | Least setup, costs grow with always-on workers |
| Archive storage | Hetzner Storage Box, Backblaze B2, Cloudflare R2 | about 1 to 6 USD per TB | Tier 5 files |

Prices are rough and change; check before buying. Recommended path: build on the PC now; for 24/7 paper trading, one Hetzner box (8 vCPU, 16 to 32 GB, NVMe) with archive files on a Storage Box or B2, and the web on Vercel. The same `docker-compose.yml` runs everywhere. Only `relay` and `web` are public; the Signer has no public route.

## 4. Secrets

Keys and the deposit seed live only in the Signer's host files. RPC, Jev and lane keys live in `.env.local`. The worker container gets a named list of the secrets it needs, never the whole file. Logs and `ctl doctor` print provider names, never URLs. Never print a secret, never commit `.env.local`, never put a secret in a prompt.

## 5. Stopping

| Command | Effect | Who |
|---|---|---|
| `ctl pause hands` | Trader and Publisher take no new work | Owner, Ops agent |
| `ctl kill` | `halted`: nothing trades or signs; senses keep recording; writes the kill file itself | Owner, no token needed |
| `ctl resume` | Back to `running` | Owner, admin token |

Automatic triggers move the firm to `exit_only` (exits keep running): the live daily loss stop, 3 Signer refusals in 10 min, live fills drifting from their ghost twins, a feed gap over 5 min with open positions, a failed reconciliation, the Ops agent's stop request. Thresholds are `KILL_*` settings.

## 6. RPC pool

Several free endpoints act as one (`lib/rpc.ts`). Each request goes to the first healthy endpoint that may serve the method and has room under its rate and monthly budget. A 429, 5xx or timeout rests that endpoint with backoff and moves on; a JSON-RPC error is returned as is; a plan refusal denies that method on that endpoint. `send*` methods are refused: money paths use `TX_SEND_URL` only. Budgets are counted per endpoint and stop at `RPC_BUDGET_STOP`. Backfill fans out across endpoints in parallel.

## 7. Monitoring and budgets

`ctl doctor`: Tape write lag, consumer lag, Board freshness, Jev latency, NATS and RPC health, RPC budget, Signer reachability (private yes, public no), model spend per lane, data sizes per tier, archive lag. Alerts go to `NOTIFY_URL`.

Target model spend: under 10 USD a day, paid from W_agent. Jev about 1.50 USD a day at full use; BettaFish and MiroShark by preset and stage caps; thinking agents capped per lane.

## 8. Backups

Daily Postgres dumps off the machine; archive files never deleted; the deposit seed backed up offline. No agent drops, truncates or resets data without the owner's yes in the same conversation.

## 9. Testing

| When | Run |
|---|---|
| Every change | `pnpm typecheck`, `npm run lint`, `npm run docs:check`, and replay suites under 60 s on short fixtures |
| A sense or hand changed | A short live smoke (a few minutes) |
| Only when the owner asks | Full replay suites, long live captures, site suites |
| Money | `live-*` tests at 0.01 SOL, by hand, after the paper side is complete |

Tests go through the module's interface and fail first. Replays are the backbone: a recorded tape plus the Clock reruns real history through the whole firm, network cut, model answers read from the Tape. A replay steps in lockstep: every consumer reaches each Tape time before any consumer passes it, in three stages (memory, then the other projections, then the deciders). Inside a stage the order changes nothing, and `precall-replay` proves it by reversing every stage. Replay databases are disposable; the runner drops them unless `E2E_KEEP=1`. Fixtures live in `tests/e2e/fixtures/tapes/`: `discovery-2m` (the default) and `graduated-2m` (a called coin that graduates) run in under a minute each, and `discovery-10m` is the long one for milestones (`E2E_TAPE=...`). A fixture may carry a settings file beside it (`<tape>.env`, such as 1-minute horizons so a 2-minute tape resolves its outcomes); the process env still wins. `scripts/fixture-cut.ts` cuts a new fixture from a tape file (inputs only), after `ctl export --from --to` from a database. Every replay checks: no lookahead, complete why-chains, no orphan effects, budgets respected, no order above its limits version, no live model calls, lanes respected. Every suite writes `report.json`, `report.html` and `sha256.txt` under `artifacts/e2e/<suite>/<run>/`.

## 10. Evals

Tests prove the code does what it says. Evals measure how good the judgment is. Three layers, each with criteria set before it runs:

| Layer | Measures | Graded by | Example criteria |
|---|---|---|---|
| Model outputs | BettaFish claims and stances, Jev answers, wiki and rug feed prose, postmortem proposals | Code first (citations exist and were seen by then, numbers match raw counts, schema, public-text rules); a different model with a written rubric for prose; a small owner-labelled set to calibrate the grader | 100% of kept claims cite valid ids; 0 public-text violations; stance agreement with owner labels above a target set after the first 50 labels |
| Signals | Every probability signal | Brier and skill against the base rate, day buckets, trailing window | Skill above 0 before a strategy may weight it fully |
| Trading | Families and the slow mind | Point-in-time backtests on archive files through the same fill model | Net after costs, calibration error per bin, fee-adjusted markouts, escalated against control |

Eval cases live in `evals/<name>/cases.jsonl` with their grader beside them. Runs write the same artifact format as suites. Batch runs are fine: evals are not latency-bound.
