# 16 · Decisions (resolved and open)

## Resolved by the owner

| # | Decision | Resolution | Where |
|---|---|---|---|
| 1 | Fast decision layer | Jev (TypeSafe System One) for every fast judgment; BettaFish and MiroShark become System Two | docs/17 |
| 2 | Agent harness | LangGraph JS (LangChain) | docs/18 |
| 3 | LLM access | OpenRouter, cheap models (DeepSeek v4.1 Flash default) | docs/15 |
| 4 | RPC | Helius free tier until a paid plan is needed; provider is config | docs/15 |
| 5 | Profit split | 50 points octopus, 50 points holders; each seat takes 1 point from the top-50 share; a seat owner may also be top 50 | docs/10 |
| 6 | Non-traded half of fees | Operator and the agent's x402 wallet (LLM costs, subscriptions) | docs/10 |
| 7 | Holder exclusions | Curve, AMM pools, LP and program-owned accounts, our wallets | docs/10 |
| 8 | Hosting | Railway + Vercel default; Coolify + Cloudflare Tunnel optional; nothing hard-coded | docs/15 |
| 9 | Low budget | Cheap models, env presets for every System Two step count | docs/07, docs/15 |

## Chosen by me (owner asked for the best pick)

| # | Decision | Pick | Why |
|---|---|---|---|
| 10 | Seat curve and cap | 21 seats, floor 1M × 1.15^(n−1), +50% premium after each sale fading over about a day | Scarcity, visible jumps and dip races; about 118.8M tokens burned (docs/10) |
| 11 | Seat quote lock | 15 minutes | Short enough to feel urgent, long enough to send from a phone wallet |
| 12 | W_agent runway | 30 days of measured spend, overflow to the operator | The agent never starves; the operator gets the rest |
| 13 | Callout posting path | T8 browser session with the signer-backed login shim | Works without an API and is visible on the site |
| 14 | Ink notes | On, max 1 per callout, threshold 0.85, Jev self-consistency must agree | Hunting stays factual and rare |
| 15 | Public X presence | No automated X posting in v1; the owner may share Tide Reports by hand | Avoid X automation risk; the voice lives on Pump.fun |
| 16 | Holder clustering | On (common funder within 24 h, token transfers within 7 days) | Stops whale splitting |
| 17 | Jev images | Off on the money path; optional for frame boxes and coin-image originality | Experimental feature |
| 18 | Tentacle count | 8 on profile A, 3 on the budget profile | Chrome is the biggest hosting cost |
| 19 | Jev model | Pinned `jev-1.14.0`; new versions run in shadow first | Calibrated thresholds stay valid |

## Still open (defaults keep work moving)

| # | Decision | Default | Owner input needed |
|---|---|---|---|
| 20 | x402 payees | Only providers that accept x402; others are topped up from W_agent by the Ops agent proposing a transfer the owner approves | Confirm which provider accounts to fund |
| 21 | Legal pages | Stubs linked in the footer | Owner writes them |
| 22 | Coin name, ticker, image | Not set | Owner |
