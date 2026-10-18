# Prior art: caller intelligence, collection and datasets

Inspected 2026-10-17. Clones live in `.upstreamref/repos/<owner>__<name>` (read-only, gitignored, never imported). Verdicts use the key in `SUCCESSOR.md` §8: RUN, DEP, SKILL, PATTERN, ASSESS, AVOID.

"Inspected" means the README, licence, file list, commit date and, for datasets, the stated schema were read. Source code was not audited line by line, and nothing here was run. No repo below is claimed to work.

## Removed

`greengod63/PumpFun-Bonding_Curve` was deleted from `.upstreamref/` on 2026-10-17. Windows Defender flagged `.vscode/tasks.json` in it as a trojan (a VS Code task that runs when the folder opens, a known malware pattern in crypto repos), and Defender had already quarantined the file. Its only role was a graduation-alert pattern, which our curve analyzer covers. **Do not re-clone it.** The 69 other clones were checked for `.vscode/tasks.json` with `runOn: folderOpen` and for install hooks that fetch remote code; none were found. Two harmless `tasks.json` remain: an empty one in `nirholas/visualize-web3-realtime`, and `dotnet` build tasks in `QuantConnect/Lean`.

Rule added to `.upstreamref/UPSTREAM.md`: never open an `.upstreamref` repo as a VS Code workspace with automatic tasks allowed.

## Matrix

| Repo | Commit, date | Licence | What it actually is | Verdict | Use in Asimog |
|---|---|---|---|---|---|
| Smurfetc/solana-memecoin-calls-dataset | e7b3096, 2026-10-16 | CC0 | 10,207 calls from one automated Telegram caller (SmugCalls), 2026-06-30 to 10-16. Fields: mint, ticker, call time, mcap at call, peak multiple after the call (a ratchet). File hash anchored with OpenTimestamps. | PATTERN + baseline | The honest-ledger pattern: losers kept, hash-anchored, "a peak is not a payout". Compare our peak distribution with it once horizons reach 30 min (docs/research/literature-review.md). Caveat: one caller grading itself; peak only, no exits or costs. |
| BankkRoll/pumpfun-apis | 6f71cb2, 2026-06-17 | MIT | Captured documentation of 483 pump.fun endpoints (OpenAPI-like JSON). Undocumented, can change. | PATTERN | Cross-check `docs/research/pumpfun-endpoints.md` when an endpoint drifts. Read-only use only (AGENTS.md: reverse engineering limited to reading the public feed and posting our own content). Cited by Meme Coin Factories. |
| madeonsol/madeonsol-sdk | eb1a4cc, 2026-10-15 | MIT | SDK for a paid API: 1,069 tracked KOL wallets, deployer scores, bundle clusters. Free tier delayed 5 min. | ASSESS | A paid, closed provider of the same inferences we compute. Not a source of truth. Its `bundles` idea matches our `bundle_buy` indicator. |
| yksanjo/kol-tracker | 80e2ae8, 2026-05-23 | none stated | Scrapes the Kolscan leaderboard into an outreach list. | AVOID | A leaderboard scrape for outreach. Nothing for us. |
| nirholas/pumpkit | 142af1b, 2026-10-11 | All rights reserved | Telegram bot framework: claim monitors, feeds, whale alerts. Distinguishes verified from unverified creator links. | PATTERN (read only) | The verified vs. unverified link distinction matches our link-confidence rule. No code reuse (licence). |
| nirholas/pumpfun-claims-bot | 476cbb0, 2026-10-11 | All rights reserved | Read-only Telegram channel of on-chain events (fee claims, graduations). | PATTERN (read only) | Event-card shape only. No code reuse (licence). |
| myron-dev/pump-indexer | f8160d9, 2026-08-30 | MIT | Python indexer: decodes `TradeEvent` and `CreateEvent` from `logsSubscribe` across several providers, SQLite, local WebSocket rebroadcast. | PATTERN | **The RPC fallback for the Chain Reader** (docs/PIPELINE.md): multi-provider `logsSubscribe` with decoding is how we fill NATS gaps and see pre-call trades without trusting pump.fun's stream. Port the idea to TS on `@pump-fun/pump-sdk` IDL; do not copy. |
| 0xfnzero/sol-parser-sdk (+ -nodejs, -python) | 1a21a76, dfdb0e0, 7c489bf, 2026-10-14 | MIT (Python: none stated) | Rust core plus Node and Python ports: DEX event parsers for Yellowstone gRPC, many programs. | ASSESS | Useful if we move to gRPC on a paid plan. Today NATS plus RPC is enough. Large surface; check the parser against the official IDL before trusting it. |
| 0xfnzero/solana-streamer | 7966826, 2026-10-14 | MIT | Rust streaming facade over sol-parser-sdk. | ASSESS | Rust is not one of our two languages. Pattern only. |
| rpcpool/yellowstone-grpc | 0e1ec9a, 2026-10-16 | AGPL-3.0 (plugin) | The Geyser gRPC plugin and clients. | DEP later (client only) | The client package (`@triton-one/yellowstone-grpc`, already in docs/SYSTEM.md) when a paid gRPC plan pays. Never vendor the AGPL plugin. Its README lists known gaps in block reconstruction. |
| chainstacklabs/grpc-geyser-tutorial | 2d162e8, 2026-06-05 | none stated | Python tutorial; explains why `logsSubscribe` truncates and `blockSubscribe` is unstable. | PATTERN | Read before building the RPC fallback. |
| no-limit-nodes/solana-programs-data-streaming-reference | 1a58e5e, 2026-04-14 | MIT | Reference clients for a commercial streaming service (17 topics including pump.fun launches and graduations). | ASSESS | Vendor-specific. A possible second provider for cross-collector checks. |
| ian05012/solana-memecoin-dataset | 7070d00, 2026-07-02 | MIT | About 20 days (2026-06-10 to 06-30) of GMGN-sourced feature snapshots of freshly graduated tokens, parquet, plus collection scripts. | ASSESS | Graduated-only and GMGN-derived: survivor-selected, third-party features. Not a baseline for callouts on the curve. |
| q33wx/pumpfun-pumpswap-market-data | f8e43f0, 2026-07-27 | none stated | Raw launches and PumpSwap bars from `logsSubscribe`, 2026-07-20 to 07-27, gzipped NDJSON. | ASSESS | Could test our curve math against independent data. No licence: read only, do not redistribute. |
| Solid-Sea/pump-gold-dataset | 9d418d6, 2026-08-19 | CC BY 4.0 | 1.3M tokens with "golden" (pmax ≥ 10 × pmin) and "dead" labels, from a Kaggle dump. | AVOID as labels | The label compares the path maximum to the path **minimum**, which can come after the maximum: it is not a return anyone could earn and it leaks the whole path. Source provenance is second-hand. |
| willho/fingerprinter-dataset | ee3d5d6, 2026-06-11 | none stated | `pg_dump` of about 39,000 launches with price trajectories. | ASSESS | No licence and an opaque schema. Not used. |
| PumpArchive/PumpArchive | a484fad, 2026-02-12 | none stated | Architecture doc for a hosted archive of token metadata, sites and socials (API at api.pumparchive.com). No code. | ASSESS | Possible later source for deleted metadata. A third-party API: treat its data as observations with provenance, never as truth. |
| Chrisymcsoup/solana-launch-study | db1f032, 2026-08-18 | MIT | Measurement pipeline over 8,587 launches. Finds two free creation-time features (the creator's launches in the prior 60 min; metadata host `ipfs.io` vs. bot hosts) that predict graduation, and **no tested exit rule profitable** (−9.7% to −17% ROI over 48 combinations, entry at T+30 s; median −4.6%, about the cost of a round trip). | PATTERN + baseline | The same lesson as our first tape: predicting graduation and profiting are different problems, and cost drag dominates. Its causal creator-frequency count and metadata-host feature are cheap candidates for S3. |
| cadenshokat/SolanAI | 62e6b64, 2025-08-24 | none stated | Flask + APScheduler + SQLite API of wallet flows, trends and sentiment. | AVOID | Generic dashboard. Nothing for us. |
| AliJuya/QuantOS | b3859e6, 2026-04-27 | none stated | Python event-driven runtime with deterministic replay and backtest, paper and live parity. | PATTERN | Confirms our Tape and Clock design. Nothing to take. |
| TradingChassis/core | cf551d0, 2026-08-26 | MIT | Archived exploration of intents, risk gates and execution boundaries. | PATTERN | Confirms the Risk Gate boundary. Archived upstream. |

## Source access

What each source we use or may use needs, what it covers, and how it fails. "Terms" means the owner's reading of the terms; the owner confirmed the callout terms with Pump.fun (SUCCESSOR §4).

| Source | Access | Terms and limits | Coverage | Retention | Failure modes and our handling |
|---|---|---|---|---|---|
| Pump.fun home feed `frontend-api-v3 /home-feed/new` | Public HTTP, Origin pump.fun | Undocumented; respect cooldowns; read only | All callouts, newest first, pages of 50 | Unknown; we keep everything on the Tape | Schema drift (`system.schema_drift`), poll errors (`system.gap` source `feed`), missed pages (gap walk) |
| Pump.fun NATS feed (`prod-v2`) | Public web-client subscriber credentials | Undocumented | Callouts pushed per followed user; deduped by calloutId | None (stream) | Disconnects (`system.gap` source `feed.push`); poll covers it |
| Pump.fun NATS trades (`unified-prod`) | Public web-client subscriber credentials | Undocumented; signals only, never money paths | Trades on the watched set only (coins called in the last `WATCH_HOURS`), from subscription time | None (stream) | Disconnects (`system.gap` source `trades`); **trades before a coin is watched are not observed**; RPC backfill is open (docs/PIPELINE.md) |
| Solana RPC (Helius free tier) | API key | About 10 rps, monthly credits | Truth for money; history by signature | Chain | Rate limits, dropped sends; metered as `budget.spent` |
| X (XActions, read only) | Agent's X account | X terms; never posts in S2 | Linked posts and profiles only | Our stored copy | Login walls, deleted posts (S2.6, open) |
| Third-party datasets (above) | Git clone | Per licence; no licence = read only | Fixed windows | Snapshot | Used as baselines with their caveats, never merged into the Tape |
