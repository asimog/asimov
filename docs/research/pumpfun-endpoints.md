# Pump.fun endpoints (discovery, 2026-10-17)

Captured with agent-browser (HAR, CDP WebSocket frames) on pump.fun web and tested directly from Node. Credentials live only in `.env.local`. Nothing here needs login.

## Callout feed (HTTP)

`GET https://frontend-api-v3.pump.fun/home-feed/new?pageSize=50&chain=all&platform=WEB[&pageToken=<token>]`

Headers used: a desktop `User-Agent`, `Origin: https://pump.fun`, `Referer: https://pump.fun/`.

| Field | Meaning |
|---|---|
| `coins[]` | One item per callout, newest first |
| `headToken` | `<µs>:<calloutId>` of the newest item |
| `nextPageToken` | Pass as `pageToken` to page backward in time |
| `liveSubject` | `homeFeedNew.head.all.prod` (NATS) |

`GET /home-feed/new/count?chain=all&platform=WEB&since=<headToken>` → `{newCount, capped, headToken}`: cheap check for new items.

`GET /home-feed?pageSize=150&chain=all&platform=WEB` is the ranked ("hot") feed: same item shape, with `recommendationRank`.

### Item shape (`coins[i]`)

| Path | Example / meaning |
|---|---|
| `coinMint`, `coinName`, `symbol`, `coinImage`, `marketCap`, `protocol`, `program`, `chain`, `narrative` | Coin context at fetch time |
| `position.userId`, `userName`, `walletAddress`, `xUsername`, `followerCount`, `totalCallouts`, `isVerified`, `accountKind` | The caller |
| `position.amountHeld`, `costBasisUsd`, `pnlUsd`, `pnlPercentage`, `realizedPnlUsd` | The caller's position |
| `position.contentKind` | `callout` |
| `position.callout.calloutId` | UUID |
| `position.callout.calledOutAtMcap`, `calloutPrice` | Market cap and price at call |
| `position.callout.thesis`, `mediaUrl` | The call itself |
| `position.callout.calloutTimestamp` | ISO time |
| `position.callout.multiple`, `maxMultiplier`, `maxMultiplierAt` | Performance since the call |
| `position.callout.updates[]`, `updateCount` | Threaded updates (`{id, content, createdAt}`) |
| `position.callout.likes`, `commentCount`, `replyCount`, `repostCount`, `quoteCount`, `viewCount` | Engagement |
| `position.callout.quotedCalloutId`, `quotedCallout` | Quote relation (echo edges) |

Observed rate: about 50 callouts per 90 seconds (about 0.5 per second) at 05:10 UTC.

## Realtime (NATS over WebSocket)

Both servers accept `CONNECT` with `user: subscriber` and a static password the web client ships to every visitor. Each server has its own password (`.env.local`: `PUMP_NATS_PASS`, `PUMP_NATS_FEED_PASS`).

| Server | Subjects | Payload |
|---|---|---|
| `wss://unified-prod.nats.realtime.pump.fun` | `unifiedTradeEvent.processed.{mint}`, `unifiedTradeEvent.lite.{mint}`, `unifiedTradeEvent.processed` (global) | JSON string (UnifiedTrade shape from `@pump-fun/shared-contracts`) |
| `wss://prod-v2.nats.realtime.pump.fun` | `followingFeed.user.{followerUserId}` | JSON: `{type:"position", walletAddress, coinMint, coinSymbol, userId, isExited, amountHeld, costBasis*, realizedPnl*, timestamp, callout:{calloutId, calloutPrice, calloutMarketCap, multiplier, maxMultiplier, thesis, createdAt, positionSnapshot}}`. Each callout is fanned out once per follower, so dedupe by `calloutId`. Position changes (exits) arrive on the same subject. A 20 s slice on 2026-10-19 (1000 messages, `tests/e2e/fixtures/pump/feed-slice.json`) carried `chainId: 1399811149` on every message and no chain name; the reader stores `chain: null` and `filters.json` `callout.unknown_chain` decides it. |
| same | `shadow.positions.{wallet}` | protobuf position updates (not used) |
| same | `multichain.coin-lifecycle.*`, `coinLifecycle.prod`, `newCoinCreated.prod`, `alertsFeed.user.*` | Coin lifecycle and alerts |
| same | `homeFeedNew.head.all.prod` | Head-token pings for the new feed (rare in our sample) |

Observed: about 7 `followingFeed` messages per second (fan-out included), about 2 global processed trades per second on the global subject.

## Callout replies (HTTP, found 2026-10-18 from the site's own requests)

`GET https://frontend-api-v3.pump.fun/callout/{callout_id}/replies` returns `{replies: [{id, content, createdAt, likeCount, userId, walletAddress, userName, mediaUrl, parentMessageId, rootMessageId, directReplyCount, threadReplyCount, tombstone, repostCount, positionPnlUsd, ...}]}`. `GET /callout/{callout_id}` returns the callout. Note the singular `callout`. Read by the Reply Reader (`senses/reply-reader.ts`).

## Coins, traders, candles (HTTP)

| Endpoint | Use |
|---|---|
| `GET /coins-v3/{mint}?includeLiveStreamInfo=false` | Coin details incl. curve addresses |
| `POST /coins-v2/mints` (body: mints) | Batch coin details |
| `GET /candles/solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/{mint}?res=15m&count=300&measure=price_usd` | OHLCV candles |
| `GET /mint-positions/{mint}?sortBy=TOP&withThesis=true&pageSize=50` | Holders with theses (callers on a coin) |
| `GET /pnl-leaderboard?period=daily&sort=combined&limit=20` | Top traders |
| `GET /pnl-leaderboard/top-trader-trades/{mint}` | Top traders' trades on a coin |
| `POST /users/batch` | Profiles: followers, bio, x_username |
| `GET /sol-price` | SOL price |
| `POST https://swap-api.pump.fun/v1/coins/{mint}/trades/batch` | Recent trades |

## Posting

Not captured yet: needs the W_trade wallet logged in (docs/EXECUTION.md). Pending S6.

## Chains, programs and access (measured 2026-10-19)

One small slice, read from Node with the Feed Reader's headers: 2 pages of `/home-feed/new` (100 callouts), 20 callouts each with `chain=solana` and `chain=robinhood`, and 20 s of each NATS subject below. Counts are from that slice only.

| Source | What we saw |
|---|---|
| `/home-feed/new?chain=all` | `chain`: `solana` 99, `base` 1. `program` and `protocol` (equal): `pump` 94, `raydium_launchpad` 4, `stonkfun` 1. `platform`: `stonkfun` 5 |
| `/home-feed/new?chain=solana` | Every item `chain: solana`, `program: pump`: the server filters by `chain` |
| `/home-feed/new?chain=robinhood` | Every item `chain: robinhood`; `coinMint` is an EVM address (`0x…`), `program` and `protocol` mostly null; the caller's `walletAddress` is still a Solana address |
| `/home-feed?chain=all` (hot) | From Node `fetch`: 403 with `cf-mitigated: challenge` (a Cloudflare bot check), every page size and header set tried. curl got 200 at the same minute. We do not work around bot checks (`AGENTS.md`), so the hot source is read only while it answers a plain request |
| NATS trades `unifiedTradeEvent.processed` (81 messages) | No chain field: quote mint is wrapped SOL, so this stream is Solana only. `program`: `pump_amm` 40, `pump` 23, `meteora_dbc` 7, `meteora_damm_v2` 7, `raydium_v4_amm` 2, `raydium_cpmm` 1, `orca_whirlpool` 1. Fields used by B3: `slotIndexId`, `creatorAddress`, `userAddress`, `isBondingCurve`, `type` (`buy`/`sell`), `amountSol` |
| NATS feed server `newCoinCreated.prod` (7) | On `prod-v2` (the feed server), not on the trades server (0 in 20 s). Fields: `mint`, `creator`, `bonding_curve`, `created_timestamp`, `program` (`pump` 7), `market_cap_usd`, `mayhem_state` |
| NATS feed server `coinLifecycle.prod` (29) | `before`/`after` coin states; `chainId` in CAIP-2 form: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`; `program` `pump` or `meteora_dbc` |
| NATS feed server `multichain.coin-lifecycle.>` (300, capped) | EVM chains only, `chainId` `eip155:56` 176, `eip155:4663` 44, `eip155:8453` 41, `eip155:1` 33, `eip155:5042` 5, `eip155:999` 1; protocols such as `pancakeswap_v3`, `uniswap_v4`, `four_meme`, `flap`. Which `eip155` id is Robinhood's chain is not yet known |
| NATS `homeFeedNew.head.all.prod` | 0 messages in 20 s |

What this means for the build: the callout feed is multi-chain and the chain value is a plain lowercase word (`solana`, `base`, `robinhood`); the trade stream and the launch messages we use are Solana only. A new chain is added after its own slice is recorded here.

The slices committed on 2026-10-19 for the suites: `tests/e2e/fixtures/pump/trades-slice.json` (76 `unifiedTradeEvent.processed` messages, 20 s, fields above), `tests/e2e/fixtures/pump/launches-slice.json` (10 `newCoinCreated.prod` messages, 20 s) and `tests/e2e/fixtures/pump/feed-slice.json` (2 pages of `recent`, one 403 from `hot`, 1000 `followingFeed` messages; the push payload's only chain identifier is `chainId: 1399811149`).
