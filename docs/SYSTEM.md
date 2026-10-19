# System

What Asimog is, how it is shaped, the nouns it reasons about and the rules that must always hold. This doc describes the target design. Where the code is not there yet, the gap is a row in `PLAN.md`. Catalogs (topics, tables, settings, signal kinds) are generated from code in `docs/generated/`.

## 1. The firm

Asimog is a near-autonomous AI firm on Pump.fun. It starts with a coin, a small machine and 0.2 SOL, and earns everything else.

- **Callouts are the centrepiece.** It reads every callout and trade, learns which callers and wallets move which coins, calls coins first with its position disclosed, and posts every exit as an update. These are Pump.fun native callouts, not Telegram calls.
- **It thinks at two speeds.** Plain math and Jev decide in about 150 ms on every event (System One). BettaFish, MiroShark and LLM agents think slowly, only when it pays (System Two).
- **It trades paper first, live last.** Every strategy trades on paper all the time. Live trading is the last step and never blocks building anything.
- **Everyone can watch.** The website shows the firm working, from real events only.
- **It grows by milestones.** Financial milestones unlock more scope (`LATER.md`).
- **Humans are partners.** The owner sets policy and is legal counsel. No visitor talks to the agent.

Who it is for:

| Audience | What they get |
|---|---|
| Pump.fun traders | Our callouts with entry, position, exits and the reason; a rug feed; the top-trader wiki |
| Holders of the coin | Full visibility into the books; payouts later (`LATER.md`) |
| Builders and other agents | Live rooms, public proofs, open docs |
| Spectators | The Field, the Cortex and the Lab, live |

Success measures:

| Measure | Target |
|---|---|
| Callouts ingested (after feed filters) | 99.5% within 30 s |
| Replay determinism | Same tape gives the same report hash |
| Books | Reconcile to the chain every hour, 0 lamports off |
| Edge | Median fee-adjusted 60 s markout at or above 0 over 100 live trades before sizes grow |

## 2. Principles

1. **One Tape, one Board, one gate.** Everything known is an event; everything believed is a signal; every order passes the Risk Gate.
2. **Nobody calls anybody.** Senses write input events, consumers read topics and write signals or decisions. Modules meet only on the Tape.
3. **Code decides, models propose.** Numbers are computed in code. Model output is data with a confidence, never an order or a post by itself.
4. **Cost before edge.** A curve round trip costs about 2.5% plus rent. Every claim of skill is net of costs at our size.
5. **Everything replays.** The same code runs live, paper and replay. Nothing reads past the Clock's now.
6. **Filter at the door.** Read everything in memory, store only what passes the filters, keep summaries of the rest.
7. **One home per setting.** Every setting has one default, one schema and one way to change it (`OPS.md`).
8. **Commit, then reveal.** Theses and forecasts are hashed before acting and revealed after.

## 3. Shape

### Processes

| Process | Language | Owns |
|---|---|---|
| `core` | TS | Tape writer, consumers, Memory, Index, System One analyzers, Jev Reflex, Strategy Pool, Risk Gate, Trader, Publisher, books, kill state, MCP server, `ctl` |
| `signer` | TS | Keys and the signing allowlist. Private network only |
| `slow-bridge` | TS | Jobs for the slow engines; maps their output to core MCP write tools |
| `slow-workers` | Python | BettaFish and MiroShark engines, vendored in `services/*/engine` |
| `agents` | TS | LangGraph thinking agents (Postmortem, Researcher, Ops, Reporter, Integrity writer, Wiki writer) |
| `relay` | TS | Read-only public fan-out to viewers |
| `web` | TS | Next.js rooms |
| Postgres 18 | | Tape, Memory, Board, Index, books, wiki, slow views |
| Neo4j 5 | | MiroShark graph memory |
| Archive storage | | Hourly Tape archive files (`OPS.md`) |

### The tower

Each layer reads from below and writes only its own outputs.

```
L7 Site      relay, web rooms                    reads projections
L6 Hands     Trader, Signer, Publisher, books    reads orders, posts     writes effects
L5 Mind      Strategy Pool, kernel, Risk Gate    reads the Board         writes intents, orders
L4 Analyzers System One math + Jev; System Two   reads Tape, Memory      writes signals
L3 Memory    projections, Index rollups, wiki    reads the Tape          writes projections
L2 Tape      append-only typed events            from senses and hands
L1 Senses    Feed, Reply, Chain, Scout, Backfill, X Reader
L0 World     pump.fun, Solana, X
```

Cross-cutting: Clock, budgets, kill state, Scorekeeper.

### The Tape

- One table `tape.events`, append-only. No row is ever updated or deleted. The only removal is the archiver dropping a whole hourly partition after its archive file is written and verified (`OPS.md`).
- Each event has `event_time` (when it happened) and `seen_time` (when we learned it), a `topic` and a body validated against its zod schema in `packages/contracts`.
- Consumers keep their own offset. The handler and the offset commit in one transaction, so a crash never applies a batch twice.
- Senses and Reflex write through the buffered Tape writer. Deciders write with `emitIn` inside their consumer transaction, so a decision and its offset commit together. A decision is stamped at least 1 ms after its cause. A projection that writes a Tape event gives it a dedupe key, so a rebuild never writes it twice.
- Each consumer draws randomness and ids from its own Clock stream (`clock.fork(name)`), so one consumer's draws never shift another's.
- The live loop never loses a wake: a NOTIFY that lands while a group is draining makes it drain again.
- **Inputs** (what the world told us) and **derived** topics (our decisions) are kept apart. A replay loads inputs and re-derives the rest.
- `ctl rebuild` clears projection consumers (flagged `projection: true`) and refills them from the Tape. Deciders are never re-run over old Tape.

### The Board

- `board.signals` keeps signal history; the Board is the latest live signal per `(kind, subject)`.
- A signal has a value, a confidence from 0 to 1, `produced_at`, `valid_until`, its inputs and `analyzer@version`.
- Past `valid_until` a signal is absent. Decisions treat absent as unknown and still work, so nothing waits for a slow analyzer. Ties break by id.

### Clock and modes

| Mode | Senses | Hands | Clock |
|---|---|---|---|
| `replay` | Tape file | Simulated | Virtual |
| `paper` | Live | Simulated | Wall clock |
| `live` | Live | Real | Wall clock |

All time comes from the Clock. The owner sets `ASIMOG_MODE` at start; code never switches mode.

### The command surface

`ctl` and the core MCP server expose the same commands to humans and agents: `state`, `tail`, `why`, `case`, `callers`, `coverage`, `index`, `house`, `slow`, `books`, `limits`, `lists`, `kill`, `resume`, `doctor`, `rebuild`, `export`. Each takes `--json`. Thinking agents get only the tools their capability token allows.

## 4. Contexts

A context owns one body of knowledge. It never writes another context's tables.

| Context | Owns | Folder |
|---|---|---|
| Sensing | What the world told us | `senses/` |
| Memory | Current views of callers, callouts, coins, bars | `memory/` |
| Index | 30-day wallet, coin, creator and caller records; leaderboards | `index/` |
| Intelligence | Signals with confidence and expiry | `analyzers/`, `reflex/`, `board/` |
| Mind | Strategies, decisions, paper book, evolution, kernel | `mind/` |
| Risk | The gate and the owner's limits and lists | `mind/risk.ts`, `hands/order-gate.ts` |
| Execution | Live orders, signatures, fills | `hands/trader.ts`, `services/signer` |
| Books | On-chain holdings, lots, realized results, sweeps, proofs | `treasury/` |
| Control | Mode, kill state, config versions | `treasury/kill.ts`, `cli/ctl.ts` |
| Publishing | House callouts, updates, bull posts | `hands/publisher.ts` |
| Scoring | Outcomes, Brier scores, caller ledger, calibration | `scorekeeper/` |
| Slow mind | Synthesis, swarms, reports | `services/slow-bridge`, `services/bettafish`, `services/miroshark` |
| Knowledge | Wiki pages | `memory/wiki` (PLANNED) |

## 5. Nouns

One term per thing. Code uses these names.

| Noun | Identity | Is |
|---|---|---|
| Coin | mint | A Pump.fun token, on the curve until it graduates to the AMM |
| Wallet | address | Anything that trades. May be a caller, creator, smart wallet, sniper, bundler or none |
| Caller | wallet | An account with at least one callout seen by now |
| Creator | wallet | The wallet that launched a coin |
| Callout | `callout_id` | A post naming a coin, made by a holder |
| Trade | signature + index | One buy or sell, with wallet, SOL, tokens, price, slot |
| Signal | kind, subject, time | A belief: value, confidence, expiry, inputs |
| Strategy | `sr_` | A rule set as data: universe, score, entry, size, exits, stop |
| Intent | `in_` | A strategy wants to buy or sell now |
| Decision | `ps_` | An entry that passed the gate and filled. Owns its legs and exits |
| Leg | decision + venue | One execution of a decision: `ghost` (fill model) or `live` (chain) |
| Order | `or_` | A live leg's instruction, approved by the live gate |
| Outcome | `oc_` | What happened at a horizon after a callout or fill |
| Score | kind, horizon | How good a signal, strategy or caller was |
| Limits | version | The owner's hard caps |
| List | kind, version | An owner set of wallets, creators or mints |
| Slow job | `sj_` | One BettaFish or MiroShark run at one stage |
| Wiki page | subject, version | A cited summary of a caller, wallet, creator, coin or narrative |

Other terms:

| Term | Means |
|---|---|
| Callout desk | The trading desk built on callouts |
| House callout | Our own callout after our fill, position disclosed; scored as the caller `house` |
| Pre-call | A known caller has bought a coin and has not called it yet |
| In play | A coin the desk evaluates; reasons `callout`, `precall`, `smart_buy`, `scout` |
| Watched set | Coins whose every trade is recorded on the Tape |
| Markout | Price move 1 s, 10 s, 60 s and 5 min after a fill, after fees |
| Net multiple | SOL back over SOL spent for a round trip of `OUTCOME_REF_SOL` through the fill model. The only multiple that counts as a result |
| Coverage | What a collector actually saw; every outcome carries `ok`, `no_entry`, `no_trades` or `gap` |
| Gap | An interval a sense knows it missed, written as `system.gap` |
| Kernel | The one allocation rule (Thompson sampling over a lower confidence bound) |
| Calibration map | Per family: score to measured win chance and mean net |
| Cascade stage | 0 to 3: how much slow-mind work a coin gets |
| Rug feed | The public room of risk evidence from scraped comments and risk signals |
| Lane | One agent's area of power, opened by one capability token |

## 6. Time

| Time | Means | Field |
|---|---|---|
| Happened at | When it happened in the world | `event_time` |
| Seen at | When Asimog learned it | `seen_time`, `seen_at` |
| Now | The Clock's time, live or replay | `clock.now()` |

1. **As-of rule.** A decision at `now` reads only rows seen by `now`.
2. **Order rule.** "Did A happen before B" compares happened-at times. For backfilled trades that is `event_time`.
3. **Final-state rule.** A row updated in place (followers, counts) is never a feature. Features come from append-only rows.
4. **Versioned reads.** Index scores, limits, lists, config and calibration maps are versioned. A decision reads the version active at its time.

## 7. Lifecycles

Each lifecycle is a state machine: one field, named states, listed moves only.

**Strategy.** `born (ghost)` to `probe` after 30 trades with the lower bound above the hurdle in both halves; `probe` to `full` after 20 more; any stage to `retired` on a negative lower bound after 50, drawdown, bad fee-adjusted markouts, real idle time or the pool cap. Every niche keeps one living strategy. A retired strategy never trades again and stays in the lineage.

**Decision and legs.**

```
intent ─paper gate─► rejected
   └─accepted─► ghost leg filled ─► open ─exit fires─► exiting ─all legs closed─► closed
                    └─ live strategy, live mode ─live gate─► order created ─► submitted ─► filled
                                                                         └─► failed (retry or give up)
```

1. A live leg exists only after its ghost leg filled (the live gate reads `intent.ghost_filled`).
2. Exits are decided once per decision and reach the live leg as a sell of a share of what it still holds.
3. A failed sell retries with backoff. A full exit sells the on-chain balance, then closes the token account.
4. One decision per strategy per coin. Several strategies may hold a coin; the wallet holds one combined position and Publisher posts one callout per coin.

**Order.** `created` to `submitted` (signature committed before the confirm wait) to `filled` or `failed`. An order with a signature is only confirmed again, never rebuilt. The memo `asimog:<order>` is the idempotency key.

**Kill state.** One field in `ops.kill`:

| State | Buys | Sells | Entered by |
|---|---|---|---|
| `running` | yes | yes | `ctl resume` with the admin token |
| `exit_only` | no | yes | live daily loss stop, books mismatch, signer refusals, feed gap, fill drift, Ops stop request |
| `halted` | no | no | `ctl kill` (no token needed) |

Only live events move it. `ctl kill` writes the kill file itself, so it works with core down.

**Callout.** `seen` to Jev answered to outcomes at 1, 3 and 5 min to ledgered. A callout seen from history feeds the Index, never an entry.

**Pre-call watch.** A known caller buys a coin they have not called: `watching` for `PRECALL_HORIZON_MIN`, then `hit` if that same caller calls, else `miss`. The analyzer emits `precall.detected` on the Tape.

**Slow job.** `queued` to `running` to `done`, `failed` or `truncated`, at a cascade stage, under a USD cap.

## 8. Lists

The owner's sets, empty by default, loaded only by `ctl lists load <kind> <file>` with the admin token. Each load writes a version and `lists.loaded` (kind, version, count, file hash). A list member changes which rule applies, never a number.

| Kind | Meaning | Read by |
|---|---|---|
| `smart_wallets` | Wallets the owner trusts; still scored by the Index | Index, Scout |
| `caller_wallets` | Extra wallets of a known caller | Pre-call analyzer |
| `follow_wallets` | Accounts we follow for wallet tracking (the follow feed) | Feed Reader, Scout |
| `blocked_creators` | Mass deployers and serial ruggers | Risk Gate, launch filters |
| `blocked_wallets` | Known bundlers and scam funders | Risk signals, Risk Gate |
| `blocked_mints` | Coins never to buy | Risk Gate, filters |
| `own_mints` | Our own coin; never traded | Risk Gate |

## 9. Invariants

| # | Invariant | Enforced by |
|---|---|---|
| I1 | The Tape is append-only; only the archiver drops verified partitions | A trigger refusing row UPDATE and DELETE; the archiver's verify step |
| I2 | Every order passes the live gate | Only `hands/order-gate.ts` writes `order.created` |
| I3 | A live leg exists only after its ghost leg filled | Live gate reads `intent.ghost_filled` |
| I4 | A paper event never changes live state | Paper and live gates write different sources |
| I5 | Limits, lists and config come from the owner, never from code | `ctl` admin path, versioned reads |
| I6 | Nothing reads past the Clock's now | As-of queries, the `no-lookahead` replay check |
| I7 | Thinking agents never trade, sign, post or change limits | MCP capability check on every call |
| I8 | Every public text passes one deterministic check | One public-text check in core for every field |
| I9 | A malformed setting stops boot | The config module names the bad key |
| I10 | A strategy pool is never empty | One living strategy per niche |
| I11 | Every slow run has a USD cap that stops it | Bridge and worker caps |
| I12 | Keys never share a process with untrusted text or an LLM | Only the Signer holds keys |
| I13 | We speak only under coins we hold | Publisher eligibility check |

## 10. Evidence classes

Everything said in public belongs to one class, and pages keep them apart.

| Class | Is | May be stated as |
|---|---|---|
| Observed | An input event with its source and times | a fact about what we saw |
| Computed | A number from observed events, with a method version | a fact, with its denominator and coverage |
| AI judgment | A recorded model answer | "the model judged ..." |
| Hypothesis | A claim committed before its outcome | "we expect ...", revealed later |
| Outcome | What happened afterwards | a fact, with corrections kept |

An AI judgment never becomes a computed fact. An indicator is never called proof. A wallet is never called a person. No post calls out a person.

## 11. Agents

Every agent has one job, one capability token and the fewest powers that job needs. Agents never call each other.

| Kind | Brain | Examples | Money power |
|---|---|---|---|
| Service | Deterministic code | Senses, Memory, analyzers, Strategy Pool, Risk, Trader, Treasurer, Scorekeeper | Trader asks for swap signatures; Treasurer for treasury signatures |
| Reflex | Jev | Reflex packs, Guard | none |
| Thinking | LLMs through OpenRouter, one key per lane | BettaFish (`SYNTH`), MiroShark (`SWARM`), Postmortem and Researcher (`THINK`), Ops, Reporter, Integrity writer, Wiki writer (`OPS`) | none |

Separation: separate processes, capability tokens checked on every call, one Postgres role per lane, one OpenRouter key per lane with its own spend limit, tool allowlists per agent, and no supervisor agent. Thinking agents start from deterministic triggers through a job table. Models per agent type and the free fallback chain come from `config/models.json` (`OPS.md`).

| Thinking agent | Trigger | Writes |
|---|---|---|
| Postmortem | A losing close or a missed wave | Ghost strategy proposals |
| Question Researcher | Weekly | Jev questions in shadow |
| Ops | Every `system.*` event, every 15 min | Alerts, pause, stop request |
| Reporter | Daily | The daily report draft |
| Integrity writer | A strong risk finding | Rug feed prose (Guard-checked) |
| Wiki writer | A weekly Index rebuild, a pruned window | Wiki page prose, labelled AI judgment |

## 12. Contracts

Topic schemas live in `packages/contracts/src/index.ts` (`TOPICS`), validated on every write. Tables live in `services/core/src/sql/schema.sql`. Their lists are generated: `docs/generated/topics.md`, `docs/generated/tables.md`, `docs/generated/signals.md`, `docs/generated/env.md`. A new topic is added to contracts in the same change that first emits it, then `npm run docs:gen`.

ID prefixes: `ev_` event, `ob_` observation, `cl_` caller, `cn_` coin, `sg_` signal, `in_` intent, `or_` order, `ef_` effect, `oc_` outcome, `sc_` score, `sr_` strategy, `ps_` decision, `sj_` slow job. IDs are prefixed ULIDs.
