# 16 · Decisions

## Resolved by the owner

| # | Decision | Resolution | Where |
|---|---|---|---|
| 1 | Name | Asimog, home asimog.com | docs/00 |
| 2 | Mandate | The agent is given the coin, the starting infrastructure and 0.2 SOL; limits set by the owner later | docs/00, docs/22 |
| 3 | Fast decisions | Jev as System One; BettaFish and MiroShark as System Two | docs/17 |
| 4 | Thinking agents | LangGraph JS | docs/18 |
| 5 | LLM access | OpenRouter, cheap models (DeepSeek v4.1 Flash default) | docs/15 |
| 6 | RPC | Helius free tier first; provider is config | docs/15 |
| 7 | Hosting | Railway + Vercel, or Coolify + Cloudflare Tunnel; nothing hard-coded | docs/15 |
| 8 | Fee sweep | Every 10 minutes; half to trading capital, half to running costs and the operator | docs/10 |
| 9 | Followers | Free market; honest trading code; follower PnL published, never a gate | docs/08 |
| 10 | Separate functions | Only legal (counsel). The agent runs everything else | docs/22 |
| 11 | Social capital | Counted and allocated like capital; bounties build audience and get work done | docs/22 |
| 12 | Frontends | All functionality in core. cancerhawk.org (already built) is rebuilt from scratch by the Builder as proof; polymyths.com and hyperkaon.com are frontends the agent builds later | docs/22 |
| 13 | Deferred | hypermyths.com, hypermythsvr.com, hyperc3.com, hypertian.com, tianezha.com; child units; holder payouts and seats until M5 | docs/22 |
| 14 | Callouts | Main focus at the start; the entry point to the deeper system | docs/01 |

## Chosen by me

| # | Decision | Pick | Why |
|---|---|---|---|
| 15 | Starting trade size | 0.02 SOL, max 5 open | Keeps 0.1 SOL free for fees and rent at a 0.2 SOL start |
| 16 | Token accounts | Closed after every full exit | Recovers about 0.0015 SOL rent each time |
| 17 | Milestones | Start, M1 runway 30 days, M2 2 SOL, M3 10 SOL, M4 100 SOL, M5 1,000 SOL | Each unlocks a clear step (docs/22) |
| 18 | Builder merge policy | Owner merges until M2; then auto-merge after passing suites and 24 h notice, protected files excluded | Speed with a safety margin |
| 19 | Bounty channels | X replies with a tag and GitHub issues; payouts from W_agent, published | Uses channels people already have |
| 20 | Sessions | 8 on a full host, 3 on a budget host | Chrome is the biggest hosting cost |
| 21 | Jev model | Pinned `jev-1.14.0` | Calibrated thresholds stay valid |
| 22 | Data replies | Max 1 per callout, threshold 0.85 | Rare and factual |

## Owner input still needed

| # | Item | Default until then |
|---|---|---|
| 23 | Real risk limits | Defaults sized for 0.2 SOL (docs/08) |
| 24 | Milestone values | The defaults in #17 |
| 25 | Coin details (mint, name) | Provided with the creator wallet |
