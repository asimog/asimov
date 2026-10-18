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

**The watched set.** A coin is watched (every trade recorded on the Tape) from its first callout, or from the moment the Scout promotes it (below), for `WATCH_HOURS`, capped at `WATCH_MAX_COINS`. The Chain Reader reads `mem.coins.watch_from` (first callout or `coin.watched`, whichever is first).

### Scout

The Scout (`senses/scout.ts`) reads the whole trade firehose `unifiedTradeEvent.lite.>` (232 trades/s, 131 KB/s, measured 2026-10-17) in memory and writes to the Tape only when it decides a coin is worth watching. It exists because callers must hold a coin to call it, so their buy comes before their callout (median 57 s on the fixture, docs/research/pre-call-evidence.md).

| Rule | Writes |
|---|---|
| A buy by a known caller wallet (any wallet with a callout in `mem.callers`, refreshed every `SCOUT_CALLERS_REFRESH_S`, default 60) on a coin not yet watched | the trade itself (`trade.curve`, source `nats`, same dedupe key as the Chain Reader), then `coin.watched` with `reason: caller_buy` |
| A coin's flow heats: at least `SCOUT_HEAT_BUYERS` (8) unique buyers and `SCOUT_HEAT_NET_SOL` (1.5) net SOL in the last 60 s, on the curve | `coin.watched` with `reason: heat` and the window's numbers |
| A smart wallet from the latest Index version buys (docs/23) | `coin.watched` with `reason: smart_buy` |
| Coin metrics clear the scan floor: market cap at least `SCOUT_MIN_MCAP_USD` (4,000) and `SCOUT_MIN_BUYERS` (10) buyers. The floor only decides what we record in full; strategies set and evolve their own thresholds | `coin.watched` with `reason: metrics` |

Every `coin.watched` carries the coin's launch features as seen at promotion (docs/04), computed by the Index rollup (docs/23). Bundle features count only for coins seen from birth (a launch message on `newCoinCreated.prod`, or a first trade near the launch price); "fresh wallet" counts only once the Index holds `INDEX_FRESH_WARMUP_H` (24) hours of wallets. On promotion the Backfill reads the coin's history and, after `HOLDERS_DELAY_S` (15), an RPC holder snapshot is taken (`holders.snapshot`).

The Scout hands each promotion to the Chain Reader in the same process, which subscribes to the coin's full trade subject at once (no 15 s wait), and to the Backfill. A promoted coin is not promoted again for `WATCH_HOURS`. Rolling windows for coins with no trade for 2 minutes are dropped, so memory stays bounded by the live coin count (about 300 per 15 s). `SCOUT=0` turns it off; `WATCH_ALL_TRADES` is removed (the Scout replaced it).

### Scout: ways it fails

1. The firehose drops. NATS reconnects; on reconnect the Scout writes `system.note` (kind `scout_gap`, with the interval). Not `system.gap`: watched coins keep their own Chain Reader subscriptions, so recorded trades are complete; only promotions were missed.
2. A caller trades from a second wallet. We only know wallets that posted a callout; the buy is missed and the callout arrives unannounced. Coverage reports the share of callouts preceded by a recorded author buy.
3. Heat floods the watched set (a busy hour). Promotions respect `WATCH_MAX_COINS`; the oldest promotions leave first, each with `system.gap`.
4. A wallet buys many coins without calling (a trader who once called). The pre-call analyzer learns its call rate from our own record (docs/07 precall), so its buys stop mattering.

### RPC trade backfill (S2.7)

When a coin enters the watched set, the Backfill (`senses/backfill.ts`) reads what happened before:

1. `getSignaturesForAddress(bondingCurvePda(mint), limit: RPC_BACKFILL_SIGS)` (default 200), newest first.
2. Signatures already on the Tape for that coin (from NATS) are skipped; the overlap is counted for `ctl coverage`.
3. `getTransaction` for the rest, paced by the `RpcPool` per-endpoint limits and capped by `RPC_BACKFILL_TX_PER_HOUR` (default 3000) per hour. Every call is metered as `budget.spent` (unit `rpc`).
4. Each `Program data:` log line whose first 8 bytes are the pump `TradeEvent` discriminator is decoded with `PUMP_SDK.decodeTradeEventBc` and written as `trade.curve`: source `rpc`, `event_time` = the event timestamp, `price_sol` from the virtual reserves after the trade, dedupe `trade:<tx>:<wallet>:<side>:<tokens>`, the one key every sense uses for a trade.

A backfilled trade has `seen_time` = when we fetched it. Analyzers still read by `seen_time`, so nothing learned late can leak backwards. The Scorekeeper orders `rpc` trades by `event_time` when it measures an outcome after the horizon (docs/07), because by then it knows them.

### Backfill: ways it fails

1. The free tier rate-limits (429). Back off for 10 s, keep the queue; after the hour budget is spent, write `system.gap` (source `rpc`, scope the coin) for the unread history.
2. `getTransaction` returns null for a fresh signature. Retry once after 2 s, then skip it.
3. Logs are truncated in a large transaction, so the event line is missing. The trade is missed; NATS overlap shows the rate.
4. The program changes the event layout. The SDK decoder pads missing trailing fields; a failure to decode is counted, never guessed.


**RPC budget.** Helius free tier has a request-per-second limit and monthly credits. The Chain Reader meters every call as `budget.spent` (unit: rpc credits). Subscriptions are preferred over polling. When the monthly projection passes 80% of the plan, `system.rpc_budget` alerts the owner.

### Chain Reader: ways it fails

1. NATS disconnects. Reconnect with backoff (built). On reconnect, write `system.gap` (source `trades`) for the interval (built), so outcomes in it are marked, never silently computed. The Backfill (above) re-reads the coin's recent history when it re-enters the watched set.
2. NATS and RPC disagree on a trade. RPC wins; emit `system.source_disagree`.
3. Provider rate limits (free tier) on holder snapshots. Spread pages; fall back to the previous sample and mark the hour "degraded" (payout waits).
4. Reorgs or dropped transactions. Fills count only after `confirmed`; payouts only after `finalized`.
5. Trades before a coin is watched are not observed live. On the first tape (before the Scout and the Backfill), 44 of 53 coins with trades had their first recorded trade after their first callout. The Scout now promotes coins before their callout, and the Backfill reads history on promotion. Outcomes report `pre_call_trades`; case files list what is still missing under UNRESOLVED.

## X Reader

- XActions scrapers, read only: posts and profiles of handles linked from callouts and caller profiles.
- A screenshot of each referenced post is stored as proof (`x.post.screenshot_ref`).
- Runs as a metered analyzer: jobs only from Attention, with an hourly cap.
- Never posts, likes, follows or DMs.

### X Reader: ways it fails

1. X login wall or rate limit. Mark the job failed; keep the link without content; retry later under budget.
2. Deleted posts. Keep our stored copy; mark `deleted_at`.
3. Wrong handle linking. Links carry evidence and confidence; Integrity never uses a link under 0.8 confidence.
