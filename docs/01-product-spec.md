# 01 · Product spec

## One line

Asimog is a near-autonomous AI firm. It starts with a coin, a small machine and 0.2 SOL, trades Pump.fun callouts honestly in public, and grows by milestones into forecasting, BTC and ETH, its own code and its own audience. Everyone can watch it work.

## Who it is for

| Audience | What they want | What they get |
|---|---|---|
| Pump.fun traders | Know which calls are early and real | The agent's own callouts with entry, position, exits and the reason |
| Holders of the coin | A firm worth holding | Full visibility into the books now; profit payouts at milestone M5 |
| Builders and other agents | Something real and new | Live instruments, public proofs, open docs, bounties to work on |
| Spectators | A thing worth sharing | The Field, the Cortex and the Lab, live |

## The centrepiece at the start: callouts in, callouts out

1. **In.** Every Pump.fun callout is ingested within seconds: coin, author, market cap at call, text, media, updates, replies, reposts, the author's trades.
2. **Understood in 150 ms.** Opportunity age, echo score, caller record, cascade forecast and a Jev reading (which coin it names, kind of call, thesis quality, promotion language, which callers will likely follow).
3. **Synthesized and simulated when it matters.** BettaFish writes the feed synthesis; MiroShark simulates callers; both on escalation.
4. **Out.** When a strategy decides, the agent buys, confirms, posts its callout with the position disclosed, and posts each exit as an update.

The callouts are the wow factor that pulls people in. From there they explore the deeper system: the Lab's committed forecasts, the Cortex, the books, the Builder's work.

## What a visitor sees

Visitors watch, scrub and read. They cannot talk to the agent. Instruments are specified in `11-ui-spec.md`:

| Route | Instrument | In one line |
|---|---|---|
| `/` | **Field** | Markets as clouds, positions as filaments, the firm's health and social capital in one HUD line |
| `/cortex` | **Cortex** | The agent's lanes as lobes of a brain, lit when they work |
| `/lab` | **Lab** | Committed hypotheses and forecasts on an arc, evidence threads, outcomes, synthesis, simulations (SIMULATED), Builder history |
| `/ledger` | Ledger | Every trade, callout, update, markout and cost; follower PnL published |
| `/treasury` | Treasury | Fee sweeps, balances, reconciliation, the proof chain |
| `/charter` | Charter | Constitution, soul versions, disclosure registry |
| `/integrity`, `/connectome`, `/rewind`, `/reports` | Integrity, Connectome Lab, Rewind, Daily Reports | Patterns with evidence, the fly sleeve, time travel, the daily report |

Visitors can orbit the Field and the Cortex, drag the Lab arc, open any why-chain, scrub Rewind, verify any commit hash or hourly proof, and share a call card. No accounts, no wallet connection, no chat.

## The agent on Pump.fun

| Action | Rule |
|---|---|
| Callout | After a confirmed buy that meets the holding threshold. One active callout per coin. Short terse-voice thesis. Position disclosed. |
| Update | Every exit step, stop and thesis change, batched inside the platform's update cooldown. |
| Data reply | One factual note under someone else's callout when Integrity evidence is strong. Never names anyone a scammer. |
| Never | Likes, follows, reposts, quotes, groups, a second account. |

## The coin

| Item | Now |
|---|---|
| Coin | Already created; the creator wallet is handed to the agent |
| Creator fees | Swept every 10 minutes: half to trading capital, half to running costs and the operator (docs/10) |
| Holder payouts and seats | At milestone M5 (docs/10, docs/22) |
| Wallet connection | Never |

## Success measures

| Measure | Target |
|---|---|
| Callouts ingested vs feed | ≥ 99.5% within 30 s |
| Replay determinism | Same tape → same report hash, every run |
| Books | Reconcile to the chain every hour, zero lamport difference |
| Markouts | Median 60 s markout reported for every live trade; ≥ 0 over 100 live trades before sizes grow |
| Public forecasts | 200 resolved paper forecasts with a public Brier score |
| Builder | At least one merged PR, then the cancerhawk.org rebuild |
| Social capital | Followers, engagement and visitors grow week over week |
