# 00 · Vision and decisions

Read this first. Then `CONSTITUTION.md` and `SOUL.md` (who it is), `21-first-principles.md` (the team's questions and answers), `22-firm-architecture.md` (how it grows) and `13-implementation-phases.md` (the build plan).

## Vision

**Asimog** is a near-autonomous AI firm: a BlackRock of the future that started in the trenches. It is given a coin, a small machine and 0.2 SOL. It earns everything else.

1. **It starts with Pump.fun callouts.** It reads every callout, models every caller, trades honestly with tiny size, posts its own callouts with its position disclosed and every exit as an update. The callouts are the centrepiece at the start and the wow factor that pulls people into the deeper tech.
2. **It thinks at two speeds.** Jev and plain math decide in about 150 ms on every event; BettaFish, MiroShark and LLM agents think slowly, only when it matters.
3. **It grows by milestones.** Each financial milestone unlocks more: forecasting on prediction markets, BTC and ETH, its own compute, payouts to holders.
4. **It counts social capital as capital.** Followers, engagement, visitors and bounty participants are a balance it invests in and measures, like SOL.
5. **It writes its own code.** The Builder agent writes, tests and ships changes, and proves itself by rebuilding cancerhawk.org from scratch and improving it.
6. **It writes its own soul**, under a constitution it cannot change.
7. **Humans are partners.** The owner is its legal counsel. Bounty workers do what it cannot. Holders share in the profit later.
8. **Everyone can watch it work** through live instruments: the Field, the Cortex, the Lab.

## Mandate

| Item | Value |
|---|---|
| Starting capital | 0.2 SOL |
| Coin | Already created; creator wallet handed to the agent |
| Infrastructure | Owner's machine or a small hosted project |
| Limits | Defaults for 0.2 SOL in docs/08; the owner sets real limits later |
| Creator fees | Swept every 10 minutes: half to trading capital, half to the agent's running costs and the operator (docs/10) |
| Holder payouts and seats | Later (milestone M5) |

## The ideas that hold it together

1. **One tape, one board, one gate.** Everything known is an event; everything believed is a signal; every action passes the Risk Gate (docs/03).
2. **Two speeds.** System One for every event, System Two on escalation (docs/17).
3. **One kernel at every level.** Strategies, venues, social campaigns and compute are positions that must beat the hurdle (docs/22).
4. **Cost before edge.** At 0.2 SOL a round trip costs about 2.5% plus account rent; the desk must clear that before anything else (docs/21 §5).
5. **Commit, then reveal.** Hypotheses, forecasts and decisions are hashed before acting and revealed after.
6. **Everything is replayable.** The same code runs live and on recorded tapes; tests are replays.

## Decision log

### Identity

| Decision | Why | Not chosen |
|---|---|---|
| Name Asimog, home asimog.com | The Asimov lineage (laws for machines) plus "mog"; the domain exists | Creature names |
| Neutral, functional module names | Anyone can tell what a part does from its name | Metaphors |
| Constitution (protected) plus soul (agent-owned) | Laws it cannot rewrite; a self it can grow | One file for both |
| Frontends later: cancerhawk.org (rebuild as proof), polymyths.com, hyperkaon.com | All functionality in core; domains are frontends the agent builds | Separate runtimes per domain now |

### Senses and intelligence

| Decision | Why | Not chosen |
|---|---|---|
| agent-browser sessions S1-S8 plus a Feed Reader | Real pages visitors can watch, plus a reader that never misses a callout | Browser-only ingestion |
| Chain Reader on Pump.fun NATS, checked by RPC (Helius free tier first) | Decoded trades for free; RPC is truth for money | Decoding every trade ourselves |
| Providers are config | Swap any provider by env | Hard-coded providers |
| BettaFish synthesizes the callout feed; MiroShark simulates callers | Both run as System Two with env presets | Running them on every event |
| Jev as System One | 150 ms typed, calibrated answers at almost no cost | LLMs for fast judgments |
| Math in code | Reproducible | Models doing arithmetic |
| Paper forecasting from the start | Public, outside-verified record early | Waiting for capital |

### Mind and hands

| Decision | Why | Not chosen |
|---|---|---|
| Strategies as data in a Strategy Pool | They evolve all the time | A fixed list |
| One kernel with a hurdle | Same logic at every level | Separate allocators |
| Markouts first | Fastest truth about edge | PnL only |
| Deterministic Risk Gate | Models propose, code decides | Models placing orders |
| Honest trading code | Free market: disclose, post exits, no side wallets, no deception; follower PnL published, not a gate | Restricting exits |
| Close token accounts after exits | Recovers 0.0015 SOL rent per coin, which matters at 0.2 SOL | Leaving accounts open |
| Official Pump SDK and fun-block API; isolated Signer; Publisher in session S8 | Maintained tools; keys isolated; visible posting | A second stack; keys in core |

### Growth

| Decision | Why | Not chosen |
|---|---|---|
| Milestones Start, M1-M5 (docs/22) | Financial progress unlocks scope | Fixed roadmap dates |
| Social capital counted and allocated | Audience is how a public firm grows | Ignoring it |
| Bounties for work and audience | Humans do what the agent cannot; participants become followers | Hiring outside the system |
| Builder agent with sandbox and PRs | It must write code; proven through E2E suites | Unchecked self-modification |
| Only legal is a separate function | The agent runs everything else | Front, middle and back office split |

### Surface and process

| Decision | Why | Not chosen |
|---|---|---|
| Instrument design from the four reference videos | Field, Cortex, Lab (docs/12) | Mascot, generic dashboard |
| No hand-made 3D models | Generated from data (docs/19) | Asset pipeline |
| Visitors watch, no chat | No injection surface | Free-text input |
| TypeScript and Python only; E2E replay tests | docs/14 | A third language; unit tests |
| LangGraph JS; one agent, one job, one key | docs/18 | One all-powerful agent |
| Deploy profiles, same images everywhere | docs/15 | Lock-in |

## Not now

Holder payouts and seats (M5), live perps, child units, studios, the compute unit, the reserve domains, any chat with visitors.
