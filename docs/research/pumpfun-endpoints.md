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
| `wss://prod-v2.nats.realtime.pump.fun` | `followingFeed.user.{followerUserId}` | JSON: `{type:"position", walletAddress, coinMint, coinSymbol, userId, isExited, amountHeld, costBasis*, realizedPnl*, timestamp, callout:{calloutId, calloutPrice, calloutMarketCap, multiplier, maxMultiplier, thesis, createdAt, positionSnapshot}}`. Each callout is fanned out once per follower, so dedupe by `calloutId`. Position changes (exits) arrive on the same subject. |
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

Not captured yet: needs the W_trade wallet logged in (docs/09). Pending S6.
