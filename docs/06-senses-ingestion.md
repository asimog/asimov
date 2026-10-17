# 06 · Senses: ingestion

The senses turn the world into events. Four of them: **Feed Reader**, **Sessions S1-S8**, **Chain Reader**, **X Reader**. All write to the Tape. None of them decide anything.

## Phase 0 discovery (before any ingestion code)

Goal: an endpoint catalog in `docs/research/pumpfun-endpoints.md`, built from evidence.

1. Open a session session on `https://pump.fun/callouts` with `agent-browser network har start --content all`.
2. Scroll the feed, open 5 callout threads, 5 caller profiles, 3 coin pages with `?highlight_callout=`.
3. `network har stop` and save under object storage `har/discovery/`.
4. From the HAR, list per endpoint: method, URL pattern, query params, auth headers, response schema (sample), pagination, rate-limit headers.
5. Inspect the NATS WebSocket frames (`wss://prod-v2.nats.realtime.pump.fun`): CONNECT options, SUB subjects. Look for callout subjects.
6. Log in S8 with the agent wallet through the signer-backed provider (docs/09) and capture one test callout post and one update on a coin we hold. Record the payloads, the holding threshold and the cooldown responses.
7. Only if a needed endpoint is not visible on web: use the `reverse-engineer-anything` skill (REA, with Ghidra for native code) on the mobile app to find the client call. Scope: endpoints for reading the public feed and posting our own content. Never the Activity Metric or ranking logic (terms 7.1(f)).

Output: the catalog, a JSON Schema per payload in `packages/contracts/schemas/pump/`, and a first recorded tape (`tests/e2e/fixtures/tapes/discovery-*.ndjson.gz`).

## Feed Reader

The reliable path for callouts. It reads the same JSON the web client reads.

| Aspect | Rule |
|---|---|
| Transport | Push channel if Phase 0 finds one (NATS subject or WebSocket); else poll the feed endpoint every 2 s with a cursor. |
| Dedupe | By `pump_callout_id` and `update_id`. The same callout seen twice yields one `callout.created`; changed counts yield `callout.counts`. |
| Gap detection | When every callout on page 1 is new, the poll walks older pages until it meets a known callout (`FEED_GAP_PAGES`, default 10). If the walk runs out of pages first, the reader writes `system.gap` (source `feed`) from the last good poll to the oldest callout it reached. A NATS push disconnect writes `system.gap` (source `feed.push`) on reconnect; the poll still covers the interval. |
| Backfill at start | Walk back 48 h on first run, then from the last seen cursor. |
| Rate | Max 1 request per second per host by default, burst 3. Honor `Retry-After`. Back off ×2 to 60 s on 429 or 5xx. |
| Provenance | Every response body is stored as an observation blob (sha256), and each event cites it. |
| Coins | The payload's mint is trusted first. If a callout's text names other contract addresses or tickers, the Jev `callout` pack picks the called coin among regex candidates (pre-parsed extraction pattern). An unknown mint triggers a `coins-v2/{mint}` fetch and a NATS subscribe. |
| Watched set | Coins with a callout in the last `WATCH_HOURS` (6), newest first, capped at `WATCH_MAX_COINS` (60). Later: plus coins with an open position and our own coin. A coin dropped by the cap gets `system.gap` (source `trades`, scope the mint, `to: null`). |

### Feed Reader: ways it fails

1. Endpoint changes shape. Detect with schema validation; emit `system.schema_drift` with a sample; stop the adapter, keep session reads running.
2. Auth or bot challenge appears. Detect by 401, 403 or HTML in a JSON response. Switch reading to session S1 DOM reads (slower, still recorded) and alert.
3. Silent gaps (cursor skips). Detect with the continuity check and with S1's visible feed: any callout S1 sees that the Tap does not have within 10 s raises `system.gap`.
4. Duplicate floods after a reconnect. Dedupe by id; counts only update.
5. Clock skew between pump.fun timestamps and ours. Store both; never sort by pump time across sources.
6. Deleted callouts. Mark `deleted`; never remove from the Tape.

## Sessions S1-S8

Up to eight agent-browser sessions (`SESSIONS` in config; budget profile runs 3: S1, S2, S8). Each is a real browser that a visitor can watch.

### Roles (defaults; Attention reassigns S3-S7)

| Session | Default task | Session |
|---|---|---|
| S1 | The live callout feed, scrolled to top, reading new cards | anonymous |
| S2 | Coin page of the top candidate (chart with callout markers, trades, holders) | anonymous |
| S3-S6 | Research jobs from Attention: caller profiles, callout threads, coin pages, holder lists | anonymous |
| S7 | Outside: X posts and profiles linked from callouts | anonymous (X Reader does the heavy reading) |
| S8 | Voice: the agent's logged-in pump.fun session. Posts callouts, updates and replies. Idle on our own profile. | logged in, `--restore` state, encrypted at rest |

### Reading protocol (one task)

1. `attention.grant` arrives with a goal (for example "read caller profile of wl_X: last 50 callouts, follower count").
2. `open <url>` in the session's session (`--session S4 --pin-tab`).
3. `snapshot -i` (interactive refs) and `read` (markdown of the rendered DOM).
4. For each element the task needs, `get box <ref>` so the website can place a contact mark on it.
5. Extract typed facts with a fixed extractor per page type (DOM selectors and the JSON found in network requests). No LLM in the extraction path for known page types.
6. Emit `session.read` with the refs, boxes and extracted facts. Extracted facts also become normal events (`caller.profile`, `callout.reply`...) with `source: session:S4`.
7. Emit `session.task` done; return to idle or take the next grant.

Unknown page types go through the SDE cascade: a cheap LLM (DeepSeek v4.1 Flash) extracts, the Jev `verify` pack checks each field, and only flagged extractions escalate to a stronger model. Output is marked `confidence < 1`.

### Frames

- Each session streams JPEG frames over its own WebSocket (`AGENT_BROWSER_STREAM_PORT` per session; `AGENT_BROWSER_STREAM_MAX_WIDTH=640`, `QUALITY=40`).
- The frame relay in `sessions` subscribes to all 8, drops frames that did not change, caps at 2 fps per session for the public, and fans out over one WebSocket to the web.
- Each frame carries `seq`, `session`, `url`, `task_id`, and the current read boxes, so the 3D scene can draw session contact points that match the page.
- Every 60 s one frame per session goes to object storage for Rewind.

### Politeness and identity

- Real Chrome, a normal desktop user agent, one session per role, no fingerprint tricks.
- Global cap of 1 page navigation per 3 s per session and 20 per minute across all sessions to pump.fun.
- S8 never likes, follows, reposts or quotes. Its only writes are Publisher posts.
- S8 runs with `--allowed-domains pump.fun,*.pump.fun`. Research sessions run without wallet shims and without stored logins.

### Sessions: ways they fail

1. Chrome crashes or hangs. Health check every 5 s (`session.health`); restart the session; the website shows that session thumbnail as "restarting".
2. A modal or consent banner covers the target. agent-browser reports the covering element; dismiss it, re-snapshot, retry once.
3. Page layout changes break an extractor. Schema check on extracted facts; on failure, emit `system.schema_drift` and route that page type to the LLM extractor under budget.
4. S8 session expires. Detect `create_session_expired` or 401; re-login through the signer provider; Publisher retries the queued post once.
5. Memory growth over days. Restart each session every 6 h on a staggered schedule.
6. Frame relay overload. Drop to 1 fps, then to keyframes every 5 s. Never block the reading itself.

## Chain Reader

| Need | Source | Topic |
|---|---|---|
| Trades for watched coins | pump.fun NATS `unifiedTradeEvent.processed.{mint}` | `trade.curve`, `trade.amm` |
| Global trade pulse | NATS `unifiedTradeEvent.processed` (sampled 1 in 10 for global stats) | `trade.sample` |
| Curve state | `accountSubscribe` on `bondingCurvePda` over the RPC websocket for watched coins (gRPC when enabled) | `curve.state` |
| Graduation | Curve `complete` flag and pool creation | `coin.graduated` |
| Our own fills, fee sweeps, burns, payouts | `signatureSubscribe` and `logsSubscribe` (mentions our wallets) over the RPC websocket, then `getTransaction` | `order.filled`, etc. |
| Holder balances of our coin | DAS `getTokenAccounts` by mint (Helius) or `getProgramAccounts` (token program, mint memcmp), at 4 random minutes per hour | `holders.snapshot` |
| Funding links for holder clusters | `getSignaturesForAddress` on new top-100 holders, once per wallet, cached | `wallet.funded_by` |

Money paths use our RPC and confirmed transactions only. NATS data feeds signals only.

**RPC budget.** Helius free tier has a request-per-second limit and monthly credits. The Chain Reader meters every call as `budget.spent` (unit: rpc credits). Subscriptions are preferred over polling. When the monthly projection passes 80% of the plan, `system.rpc_budget` alerts the owner.

### Chain Reader: ways it fails

1. NATS disconnects. Reconnect with backoff (built). On reconnect, write `system.gap` (source `trades`) for the interval (built), so outcomes in it are marked, never silently computed. Filling the gap from RPC history for watched coins is **not built yet** (S2.7, pattern: `myron-dev/pump-indexer`, multi-provider `logsSubscribe` decoding).
2. NATS and RPC disagree on a trade. RPC wins; emit `system.source_disagree`.
3. Provider rate limits (free tier) on holder snapshots. Spread pages; fall back to the previous sample and mark the hour "degraded" (payout waits).
4. Reorgs or dropped transactions. Fills count only after `confirmed`; payouts only after `finalized`.
5. Trades before a coin is called are not observed, because the watch starts at the first callout. On the first tape, 44 of 53 coins with trades had their first recorded trade after their first callout. Outcomes report `pre_call_trades`; case files list it under UNRESOLVED. S2.7's backfill fixes this for called coins.

## X Reader

- XActions scrapers, read only: posts and profiles of handles linked from callouts and caller profiles.
- A screenshot of each referenced post is stored as proof (`x.post.screenshot_ref`).
- Runs as a metered analyzer: jobs only from Attention, with an hourly cap.
- Never posts, likes, follows or DMs.

### X Reader: ways it fails

1. X login wall or rate limit. Mark the job failed; keep the link without content; retry later under budget.
2. Deleted posts. Keep our stored copy; mark `deleted_at`.
3. Wrong handle linking. Links carry evidence and confidence; Integrity never uses a link under 0.8 confidence.
