# Pump.fun callouts: what the web client shows

Source: pump.fun web JS chunks fetched 2026-10-16 (`references/sites/pumpfun-web-bundles/`) and the callout terms page. These are facts read from shipped client code. API hosts and payload shapes are not confirmed yet. Phase 0 confirms them with HAR capture (docs/06).

## Routes

| Route | Meaning |
|---|---|
| `/callouts` | The callout feed. |
| `/callouts/{mint}/{calloutId}` | One callout. |
| `/callouts/{mint}/{calloutId}/{updateId}` | One update inside a callout thread. |
| `/coin/{mint}?highlight_callout={calloutId}` | Coin page with the callout marked on the chart. |
| `/docs/callout-reward-terms` | Terms. |

## Hosts seen in the client

`frontend-api-v3.pump.fun`, `profile-api.pump.fun`, `livestream-api.pump.fun`, `swap.pump.fun`, `fees.pump.fun`, `fun-block.pump.fun` (agent tx builder API, documented in pump-fun-skills).

## Callout features (from i18n keys and component names)

| Feature | Evidence (key) | What it means for OCTOPUS |
|---|---|---|
| Holding required to post | `holding_requirement`, `holding_below_threshold`, `no_holding`, `create_no_eligible_wallet` | Buy first, confirm the holding, then post. The platform enforces "buy then call". |
| Wallet session required | `connect_wallet_to_post`, `create_session_expired` | Posting needs a wallet-authenticated session. Herald needs a signer-backed login (docs/09). |
| Market cap at call | `calling_at_mc`, `called_at` | Every callout stores entry context. Opportunity age is computable for every caller. |
| Author trades shown on the callout | `author_trades_a11y`, `trade_buy`, `trade_sell`, `view_transactions`, `include_transfers`, `last_trade_label`, `exit_label` | The platform shows the caller's buys and sells, including an exit marker. Our exits are visible natively. |
| Updates (threaded) | `update_your_callout`, `update_placeholder`, `update_cooldown`, `update_label`, `updated` | Exit callouts are native updates on the original callout. Update cooldown limits how often we can post them. |
| Cooldowns and limits | `ineligible_cooldown`, `ineligible_attempt_limit`, `ineligible_existing`, `create_duplicate_toast` | One callout per coin per account at a time, with cooldowns. Herald must check eligibility before posting. |
| Replies, comments | `post_your_reply`, `calloutRepliesQueryKey`, `calloutReplyCommentsQueryKey`, `comments_count` | Ink notes (data comments) go here. |
| Reposts, quotes | `repost_a11y`, `quote_your_take`, `quote_posted` | Echo rings can form from reposts and quotes. Track them as edges. |
| Likes | `like_a11y`, `like_update_a11y` | Engagement counts. We read them. We never automate likes. |
| Media attachments | `callout_attachment_alt`, `create_media_not_owned`, `create_media_not_clean`, `create_media_rate_limited`, `create_video_disabled` | We may attach our own generated cards. Media must be ours and pass moderation. |
| Moderation | `create_moderation_flagged`, `more.report_callout` | Posting can be refused. Herald handles refusal as a normal outcome. |
| Quality tip | `quality_tip_title`, `quality_tip_example` | The platform nudges callers to write a thesis. |
| Share card with thesis | `callout-share-card-thesis` | Callouts carry a thesis text. |
| Replay | `replay_cta`, `callout-line-chart-container`, `callout-marker-pulse` | The web shows a replay chart of price since the call. |
| Followed holders | `followed_holders_title`, `holder_column` | Followers can see which followed accounts hold a coin. |
| Groups | `not_group_admin` | Callouts can be posted to groups. Out of scope for v1. |
| Mayhem | `create_mayhem_not_completed` | Mayhem-mode coins have extra callout rules. |
| Other chains, perps | `calloutChainFromSlug`, `perpCalloutTicker` | Callouts exist beyond Solana spot. v1 ingests Solana spot callouts only. |

## Real-time channels

The web client connects to NATS over WebSocket:

| URL | Seen as |
|---|---|
| `wss://prod-v2.nats.realtime.pump.fun` | Main realtime NATS |
| `wss://multichain-prod.nats.realtime.pump.fun` | Multichain realtime NATS |
| `wss://solana-mainnet.pump.fun/<key>` | Pump.fun's own Solana RPC websocket |
| `wss://pump-prod-*.livekit.cloud` | Livestreams |

`@pump-fun/shared-contracts` (`src/events/nats-subjects.ts`) names the subjects. The important ones:

| Subject | Payload |
|---|---|
| `unifiedTradeEvent.processed.{mint}` | `UnifiedTradeSchema` (`src/events/unified-trade.types.ts`): amountSol, amountUsd, baseAmount, isBondingCurve, marketCap, mintAddress, poolAddress, priceSol, priceUsd, fees, slotIndexId, timestamp, tx, type buy/sell, userAddress |
| `unifiedTradeEvent.processed` | All processed trades |
| `trending.event` | Volume spikes, percent moves |
| `whale.large.buy` | Large buys |
| `livestream.created` | New livestreams |

Our `trade.*` event body copies `UnifiedTradeSchema` field names, so the NATS adapter is a pass-through and the gRPC adapter fills the same shape.

## Open questions for Phase 0

1. Feed endpoint, pagination, and whether a push channel (WebSocket or SSE) exists.
2. Callout payload fields: id, mint, author, text, media, mcap at call, created time, update list, counts.
3. Profile endpoint: a caller's callout history and their wallet.
4. Post and update endpoints, the auth flow, and the holding threshold value.
5. Cooldown and update-cooldown values.
6. Whether reading needs a session. Default assumption: reading is anonymous.
7. NATS connect credentials the web client uses, and whether callout events also flow on NATS (look for `callout` subjects in the connection's SUB lines).
