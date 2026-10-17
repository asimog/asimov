# 22 · Firm architecture

Asimog is one core runtime that grows by adding adapters, strategies, venues and frontends, unlocked by milestones. All functionality lives in core. Domains are frontends the agent builds later on top of core's APIs.

## Starting point

| Given | Value |
|---|---|
| Capital | 0.2 SOL in W_trade |
| Coin | Already created; the creator wallet (W_creator) is handed to the agent |
| Infrastructure | The owner's machine or a small hosted project (docs/15) |
| Limits | Defaults sized for 0.2 SOL (docs/08); the owner sets real limits later |

## Core holds everything

```
                       ┌──────────────── core ────────────────┐
adapters ──► senses ──►│ Tape → analyzers → Board → strategies │──► hands ──► venues, socials, payments
(venue, decision,      │ kernel · Risk Gate · books · Clock     │
 llm, compute,         │ commit-reveal · milestones · soul      │──► relay ──► frontends
 storage, social,      │ Builder (writes code in a sandbox)     │      (asimog.com now; others later)
 payment, human)       └────────────────────────────────────────┘
```

| Part | Doc |
|---|---|
| Tape, Board, analyzers, Clock, `ctl` | docs/03, docs/04 |
| Senses (Feed Reader, sessions, Chain Reader, X Reader) | docs/06 |
| Analyzers, BettaFish, MiroShark | docs/07 |
| Jev fast mind | docs/17 |
| Strategies, kernel, Risk Gate | docs/08 |
| Trader, Signer, Publisher | docs/09 |
| Treasury and books | docs/10 |
| Agent lanes and thinking agents | docs/18 |

## Frontends

| Domain | What it will show | When |
|---|---|---|
| **asimog.com** | The instruments: Field, Cortex, Lab, Ledger, Treasury, Charter (docs/11) | Now |
| **cancerhawk.org** | Already built by the owner. The agent re-implements it from scratch in a new repo and improves it, to prove it can build and ship real software (the Builder's first project) | After the Builder is live (docs/13 M7) |
| **polymyths.com** | The forecasting desk's public record | When the agent builds it |
| **hyperkaon.com** | The BTC and ETH desk | When the agent builds it |

Deferred and out of this plan: hypermyths.com, hypermythsvr.com, hyperc3.com, hypertian.com, tianezha.com.

## Adapters

Every outside thing is an adapter with a manifest (kind, capabilities, costs, limits from config, failure modes written before code):

| Kind | Now | Later |
|---|---|---|
| venue | `pumpfun` (curve and AMM) | `polymarket`, `kalshi` live; perps through `ccxt` and Hyperliquid |
| forecast | `polymarket.read`, `kalshi.read` (paper forecasting) | - |
| decision | `jev` | - |
| llm | `openrouter` | local models |
| compute | `local`, `coolify`, `railway` | VPS provider APIs paid by the agent |
| storage | S3-compatible | - |
| social | `pumpfun.callouts` (post), `x` (read and post, rate-limited, Guard-checked) | video and other platforms |
| payment | Solana transfers, x402 | - |
| human | `counsel` (legal only), `operator`, `bounty` | - |

## The kernel and social capital

Everything that uses capital, budget or attention is a **position** with a cost, an evidence record, a hurdle and a kill rule. One kernel (Thompson sampling gated by a lower confidence bound over the hurdle) allocates at every level:

| Level | Positions | Measured in | Round |
|---|---|---|---|
| Strategies | Strategy specs | Net SOL after costs, markouts | 15 min |
| Venues | Callout desk, forecasting desk, later perps | Net SOL, Brier | Daily |
| Social | Callouts, X posts, bounty campaigns, frontend features | Social capital gained per SOL spent | Daily |
| Budget | Analyzers, Jev questions, System Two runs, Builder tasks | Value per dollar of compute | Hourly |

**Social capital is capital.** The firm keeps a social ledger next to the SOL ledger:

| Social balance | Source |
|---|---|
| Followers on the Pump.fun profile | Feed Reader |
| Engagement on our callouts (likes, replies, reposts, quotes) | Feed Reader |
| X followers and engagement | X Reader |
| Visitors and time on site | Self-hosted analytics |
| Bounty participants and accepted submissions | Bounty adapter |

Bounties are how the agent gets things done that it cannot do alone, and they build an audience at the same time: memes, translations, bug reports, design ideas, testers. Each bounty is a position: budget, expected social and work return, deadline, payout rule. Submissions arrive through X replies with a tag or GitHub issues; payouts go from W_agent and are posted publicly.

## Milestones

Growth unlocks by financial milestones, with one health condition: the books reconcile to the chain and no Signer incident is open. Values are defaults; the owner may change them.

| Milestone | Firm NAV | Unlocks |
|---|---|---|
| Start | 0.2 SOL | Paper strategies, tiny live callout trades (0.02 SOL), callouts and exit updates, paper forecasting, X posting, bounties up to 0.01 SOL |
| M1 | Runway ≥ 30 days of its own costs | Thinking agents on their own budget; Builder works on the agent's own repo |
| M2 | 2 SOL | Larger sizes within the owner's limits; System Two presets up to `lite`; Builder starts the cancerhawk.org rebuild |
| M3 | 10 SOL | Live forecasting on prediction markets; the agent builds the polymyths.com frontend |
| M4 | 100 SOL | BTC and ETH desk (perps or prediction markets); the agent builds the hyperkaon.com frontend; buys its own compute |
| M5 | 1,000 SOL | Holder payouts and seats (docs/10); larger simulations; new venues it proposes |

A broken reconciliation or a Signer incident drops the firm back one milestone until fixed.

## The Builder: the agent writes code

| Step | What happens |
|---|---|
| Task | A thinking agent or the owner files a task: a new adapter, a strategy family, a frontend, a bug fix, the cancerhawk.org rebuild |
| Sandbox | The Builder starts a disposable container with a git checkout and the toolchain. No keys, no production network |
| Code | It writes changes on a branch, using a coding model through OpenRouter and the repo's skills |
| Prove | It runs the E2E suites; a change without passing suites never leaves the sandbox |
| Ship | It opens a pull request with the artifacts attached. The owner merges until M2; from M2, changes outside protected files can auto-merge after the suites pass and a 24 h public notice on the Lab |

Protected files the Builder can never change: `CONSTITUTION.md`, the Signer and its allowlist, the books and reconciliation code, the milestone checks.

## Soul and constitution

- `CONSTITUTION.md` is protected and loaded at boot (hash checked).
- `SOUL.md` is the agent's own. It edits it through `soul.update`; every version is hashed, kept and shown on `/charter`.

## Counsel

The owner is legal counsel. It is the only separate function. Anything with legal weight goes to the counsel queue and waits for a signed decision. Everything else is the agent's job.

## Later (not in this plan)

Child units on separate machines, studios, the compute unit and the reserve domains. The kernel and adapters are built so a unit could be added later as another set of positions, but no unit machinery is built now.
