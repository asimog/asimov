# 25 · Domain model

This doc names the things Asimog reasons about, who owns each one, the states each one can be in, and the rules that must always hold. Read it before changing the mind, the hands, the Index or the slow mind. docs/03 says how the parts talk (the Tape and the Board). This doc says what the parts are.

Every item carries a status word:

- **SHIPPED**: the code does this today at `263edab`.
- **PARTIAL**: the code does part of it; the gap is named.
- **PLANNED**: the code does not do this yet. The fix plan or docs/26 schedules it.

A "domain model" here means the set of nouns, their states and their rules. When code and this doc disagree, one of them is a bug. Fix the one that is wrong in the same change.

## 1. The firm in one paragraph

Senses see **callouts** and **trades** on Pump.fun **coins**. Memory and the **Index** turn them into what we know about **callers**, **wallets** and coins. Analyzers write **signals** on the **Board**. **Strategies** read the Board, and when one wants to act, the **Risk Gate** decides. An accepted entry becomes a **decision** with a paper **leg** and, for live strategies, a live leg. The Trader and the Signer act for the live leg. The **Scorekeeper** measures every outcome, and the **kernel** gives capital to what earns it. The owner sets **limits**, **lists** and the **mode**. Everything that happens is an event on the **Tape**.

## 2. Contexts

A context is one body of knowledge with one owner. Code in one context never writes another context's tables. Contexts meet on the Tape and the Board (docs/03).

| Context | Owns | Folder | Writes | Status |
|---|---|---|---|---|
| Sensing | What the world told us, as input events | `senses/` | `callout.*`, `trade.*`, `coin.*`, `holders.snapshot`, `observation.raw` | SHIPPED |
| Memory | Current views of callers, callouts, coins, bars | `memory/` | `mem.*` | SHIPPED |
| Index | 30-day records of wallets and coins, copy scores, archetypes | `index/` | `idx.*`, `index.refreshed` | PARTIAL: runs on a 1-day window from `.env.example`; Scout flushes it on a timer, so it is not a consumer |
| Intelligence | Beliefs about subjects, with confidence and expiry | `analyzers/`, `reflex/`, `board/` | `board.signals`, `jev.answer` | SHIPPED; lookahead gaps listed in section 9 |
| Lists | Owner-supplied wallet, creator and mint sets | none yet | `lists.*` | PLANNED (section 6) |
| Mind | Strategies, decisions, the paper book, evolution, allocation | `mind/` | `strategy.*`, `intent.*`, `kernel.allocation`, `position.closed`, `markout.measured`, `mind.*` | SHIPPED for paper |
| Risk | The gate function and the owner's limits | `mind/risk.ts`, `hands/order-gate.ts` | `order.created`, `order.rejected` | PARTIAL: limits have no writer; the gate reads mints only, no wallets or creators |
| Execution | Live orders, signatures, fills | `hands/trader.ts`, `services/signer/` | `order.submitted`, `order.filled`, `order.failed`, `signer.refused` | PARTIAL: built on a mocked chain; see section 5.3 |
| Books | What we own on chain, lots, realized results, sweeps, proofs | `treasury/` | `ledger.entry`, `books.reconciled`, `fees.swept`, `proof.published` | SHIPPED on a mocked chain |
| Control | Mode, kill state, limits versions | `treasury/kill.ts`, `cli/ctl.ts` | `kill.changed` | PARTIAL: see section 5.4 |
| Publishing | House callouts, updates, data replies | `hands/publisher.ts`, `hands/replies.ts` | `post.queued`, `commit.*` | SHIPPED for paper |
| Scoring | Outcomes at horizons, Brier scores, caller ledger | `scorekeeper/` | `outcome.measured`, `score.updated`, `mind.scores` | PARTIAL: no time window on scores |
| Slow mind | Feed synthesis, coin synthesis, swarm runs | `services/slow-bridge/`, `services/bettafish/`, `services/miroshark/` | through core MCP tools only | PARTIAL: only the feed timer triggers runs; strategies cannot read the results |

## 3. Nouns

One term per thing, as in `GLOSSARY.md`. These are the nouns the code must use.

| Noun | Identity | Is | Owner |
|---|---|---|---|
| Coin | mint address | A Pump.fun token. It is on the curve until it graduates to the AMM. | Sensing, Memory |
| Wallet | base58 address | Anything that trades. A wallet can be a caller, a creator, a smart wallet, a sniper or none. | Index |
| Caller | the wallet that posted | An account that posts callouts. A caller is a wallet with at least one callout seen by now. | Memory |
| Creator | the wallet that created the coin | The wallet that launched a coin. One creator can launch many coins. | Index |
| Callout | `callout_id` | A post naming a coin, made by a holder. Has text, author, time, and later engagement. | Sensing, Memory |
| Trade | transaction signature plus index | One buy or sell on the curve or the AMM, with wallet, SOL, tokens, price, slot. | Sensing |
| Signal | `(kind, subject, produced_at)` | A belief about a subject: a value, a confidence from 0 to 1, a time it stops being valid, and the inputs it came from. | Intelligence |
| Strategy | `sr_` id | A strategy as data: universe, score, entry threshold, size, exits, stop (docs/08). | Mind |
| Intent | `in_` id | A strategy wants to buy or sell now. Not yet approved. | Mind |
| Decision | `ps_` id today (the paper position) | An entry that passed the gate and filled. It owns its legs and its exits. | Mind |
| Leg | decision id plus venue | One execution of a decision on one venue: `ghost` (the fill model) or `live` (the chain). | Mind, Execution |
| Order | `or_` id | A live leg's instruction to the Trader, approved by the live gate. | Risk, Execution |
| Fill | event id | What a leg got: tokens, SOL, price, fees, slippage. | Mind (ghost), Execution (live) |
| Outcome | `oc_` id | What happened at a horizon after a callout or a fill. | Scoring |
| Score | `(kind, horizon)` | How good a signal, strategy or caller was. | Scoring |
| Limits | version number | The owner's hard caps for the gate. | Control |
| List | `(kind, version)` | An owner-supplied set of wallets, creators or mints with one meaning each. | Lists |
| Slow job | `sj_` id | One run of BettaFish or MiroShark at one stage. | Slow mind |

Today the code has no separate Decision or Leg type. The paper position plays the Decision, and the live side keeps its own lots per mint. Section 5.2 is the target and the reason.

## 4. Time

There are three times. Most lookahead bugs come from mixing them.

| Time | Means | Field |
|---|---|---|
| Happened at | When it happened in the world | `event_time` |
| Seen at | When Asimog learned it | `seen_time` (Tape), `seen_at` (Memory) |
| Now | The Clock's current time, live or replay | `clock.now()` |

Rules:

1. **As-of rule.** A decision or a signal made at `now` may read only rows with `seen_at <= now`. SHIPPED in the pre-call analyzer and the desk. PARTIAL elsewhere: `analyzers/cheap.ts` bounds by `created_at`, and reads final-state `mem.callers` fields (section 9).
2. **Order rule.** To ask "did A happen before B", compare happened-at times, and for backfilled trades (source `rpc`) the happened-at time is `event_time`, not the time we fetched them. PARTIAL: the scorekeeper does this; the pre-call analyzer, the caller ledger and the case file do not.
3. **Final-state rule.** A projection row that is updated in place (followers, last call, engagement counts) is never a feature. Features come from append-only rows filtered by the as-of rule. PLANNED.

The lever for these rules is a `no-lookahead` replay suite: replay one tape whole and again cut at time T, and require every signal produced before T to be identical. PLANNED (fix plan Phase 3).

## 5. Lifecycles

Each lifecycle is a state machine. A state machine means the thing is in exactly one named state, and only the listed moves are allowed. Code should hold the state in one field, not in several booleans that must agree.

### 5.1 Strategy

```
born (ghost) ──30 trades, LCB > hurdle in both halves, drawdown ok──► probe ──20 more trades──► full
    │                                                                   │                        │
    └────────────── LCB < 0 after 50, drawdown, bad markout, idle, pool cap ─────────────────────┴──► retired
```

- SHIPPED: the stages and the retirement reasons (`mind/kernel.ts:53-60`, `mind/evolve.ts:71-78`).
- PARTIAL: the stage changes the allocator's share, but no order reads the share (`desk.ts:454-456`), so probe and full trade the same size.
- Defect: `idle` retires every strategy after a 2-hour quiet spell, and a pool with zero living strategies is never re-seeded. Target: idle time counts market activity, and each niche keeps at least one living strategy (docs/26 section 5).
- Invariant: a retired strategy never trades again, and stays in the lineage forever.

### 5.2 Decision and its legs

SHIPPED on a mocked chain (fix plan Phase 1):

```
intent ──paper gate──► rejected
   │
   └─accepted──► ghost leg filled ──► open ──exit rule fires──► exiting ──all legs closed──► closed
                     │
                     └─ live strategy and live mode ──live gate──► live leg: order created ──► submitted ──► filled
                                                                                     └──► failed (retry or give up)
```

Rules:

1. A live leg exists only if its ghost leg filled: the live gate reads `intent.ghost_filled`.
2. Exits are decided once per decision, by the desk on the ghost leg, and reach the live leg as a sell intent. `fraction` is the share of the tokens still held, so the live leg sizes its own sell from its own holding.
3. A failed sell is retried with backoff (`TRADER_SELL_ATTEMPTS`, `TRADER_RETRY_BASE_MS`) until it closes or runs out of attempts. `halted` holds it.
4. A full exit (fraction 0.999 or more) sells the on-chain balance, then closes the token account. A failed close keeps `close_pending` and the Trader's retry pass closes it.
5. One decision per strategy per coin at a time. SHIPPED (`desk.ts:452`).
6. Several strategies can hold one coin. The wallet holds one combined position, and Publisher posts one callout per coin with updates (docs/08 "One coin, one callout"). SHIPPED for paper.

### 5.3 Order (live leg)

```
created ──signed, sent──► submitted (signature stored, committed) ──confirmed──► filled
                                │
                                └──not confirmed in time──► look up the stored signature, never rebuild ──► filled | failed
```

- Idempotency key: the order id and attempt, both in the memo (`asimog:<order>` then `asimog:<order>:r<n>`), matched exactly. The `submitted` row and its signature commit on their own before the confirm wait, and an order with a stored signature is only confirmed again, never rebuilt. Past `TRADER_GIVE_UP_MS` the signature has expired and the order counts as failed. SHIPPED.
- One bad `order.created` goes to `hands.dead_letters` instead of blocking every later order. SHIPPED.
- Every order passes the live gate. No other path writes `order.created`. SHIPPED.
- The Signer caps every swap at `SIGNER_MAX_ORDER_SOL` whatever the request says. SHIPPED.

### 5.4 Kill state

SHIPPED (fix plan Phase 1). One field in `ops.kill`, `state`:

| State | Buys | Sells | Entered by |
|---|---|---|---|
| `running` | allowed | allowed | `ctl resume` with the admin token |
| `exit_only` | refused | allowed | daily loss stop on the live book, books mismatch, signer refusals, feed gap, fill drift |
| `halted` | refused | refused | `ctl kill` with the admin token only |

Rules:

1. Only live events move the state. A paper rejection never does.
2. The kill file that the Signer reads is written by `ctl`, so it works when the core is dead. The core rewrites it after each state change commits. It holds the state name; any other content reads as `halted`.
3. The Signer refuses every endpoint in `halted`, and only buys in `exit_only`.
4. Trip counters live in `ops.kill_counts`, not in process memory. `ctl kill` needs no token (stopping must be easy); `ctl resume` needs the admin token.

### 5.5 Callout

```
seen ──► Jev answered (optional, fast) ──► outcomes at 1, 3 and 5 min ──► ledgered (cl1 methodology)
```

- SHIPPED. Outcomes use our fill model at `OUTCOME_REF_SOL`.
- A callout seen from history (`via: history`) feeds the Index, never an entry. SHIPPED in the desk. The caller ledger still ranks history rows when it looks for repeat calls (`scorekeeper/ledger.ts:72`).

### 5.6 Pre-call watch

A pre-call watch starts when a known caller buys a coin they have not called.

```
caller buy seen ──► watching (horizon PRECALL_HORIZON_MIN) ──same caller calls the coin──► hit
                                                          └──horizon passes──────────────► miss
```

- SHIPPED: detection and the signal `precall.callout_p` (`analyzers/precall.ts`).
- Defects: the hit is scored when anyone calls the coin, not the caller who bought. The desk learns about the watch by searching Board rows, which depends on the order the live loop drains consumers. Target: the analyzer emits `precall.detected` on the Tape and the desk consumes it (PLANNED topic).

### 5.7 Slow job

```
queued ──► running ──► done | failed | truncated
```

Each job has a stage (docs/26 section 9): 0 math and Jev, 1 nano synthesis, 2 lite synthesis plus a small swarm, 3 full runs. PARTIAL: the job states exist (`slow.jobs`); stages, a per-run USD cap and partial results do not.

## 6. Lists

Lists are the owner's supplied sets. The code ships with every list empty. Wallet lists, private keys and callout tapes arrive later from the owner. Keys never go in a list: only the Signer holds keys.

Status: PARTIAL (fix plan Phase 2). `ctl lists load` stores every kind in `mind.lists` and the Risk Gate reads `blocked_creators`, `blocked_wallets` (as the caller of the coin), `blocked_mints` and `own_mints`. The Index and pre-call analyzer do not read `smart_wallets` or `caller_wallets` yet, and `blocked_wallets` does not raise `risk.state` yet.

| Kind | Members | Meaning | Who reads it |
|---|---|---|---|
| `smart_wallets` | wallet | Wallets the owner believes trade well. They join the Index seed with source `owner`, so the Index still scores them on what we could copy. They never skip scoring. | Index, Scout promotion |
| `caller_wallets` | wallet, optional caller handle | Extra wallets that belong to a known caller (linked wallets). A buy by any of them counts as the caller's buy for pre-call. | Pre-call analyzer |
| `blocked_creators` | wallet | Mass deployers and serial ruggers. A buy of a coin they created is refused. | Risk Gate |
| `blocked_wallets` | wallet | Wallets whose presence among early buyers marks a coin as unsafe (known bundlers, scam funders). Raises `risk.state`. | Index signals, Risk Gate |
| `blocked_mints` | mint | Coins never to buy. Replaces `Limits.blocklist`. | Risk Gate |
| `own_mints` | mint | Our own coin. Never traded. Replaces `Limits.own_mints`. | Risk Gate |

Rules:

1. A list is loaded only through the admin path: `ctl lists load <kind> <file> --token <admin>`. The file is one address per line; `#` starts a comment. Each load writes a new version and emits `lists.loaded` with the kind, version, count and file hash, never the members.
2. Every address is validated as base58 on the ed25519 curve or as a mint address before loading. A file with an invalid line is refused whole and the line is named. (The curve check is not built; the format check is.)
3. A list member never changes a number in code. It changes which rule applies. Blocked means refused. Smart means scored with a lower evidence floor, never trusted unscored.
4. Lists are read as of the decision time, so a replay uses the list version that was active then.
5. Refreshing from outside sources (leaderboards, public APIs) writes to a separate kind with its own `source`, never into the owner's lists.

## 7. Invariants

Rules that must always hold. "Enforced by" names the check that makes them true today, or says none.

| # | Invariant | Enforced by | Status |
|---|---|---|---|
| I1 | The Tape is append-only. | Convention only. No trigger or role refuses `UPDATE` or `DELETE`. | PARTIAL |
| I2 | Every order passes the live gate. | Only `hands/order-gate.ts` writes `order.created`; no MCP tool can. | SHIPPED |
| I3 | A live leg exists only after its ghost leg filled. | The live gate reads `intent.ghost_filled`, not `intent.created` (`kill` suite). | SHIPPED |
| I4 | A paper event never changes live state. | The paper desk writes source `riskgate.paper`; the kill consumer trips on `riskgate.live` only (`kill` suite). | SHIPPED |
| I5 | Limits and lists come from the owner's admin path, never from code. | `ctl limits set` and `ctl lists load` with the admin token; `loadLimits` reads them as of the decision time; `DEFAULT_LIMITS` fills only unset keys (`owner-config` suite). | SHIPPED |
| I6 | Nothing reads a row seen after the Clock's now. | Partly; see section 4. | PARTIAL |
| I7 | Thinking agents never trade, sign, post or change limits. | MCP capability check on every call; no tool writes `order.*`. | SHIPPED |
| I8 | Every public text passes one deterministic check. | Per tool; several fields skip it. | PARTIAL |
| I9 | Every malformed config value stops boot. | Every key has one default in `.env.example`; `env.num`, `env.int`, `env.bool` and `env.str` throw on a missing or malformed value and name the key; the Signer does the same (`owner-config` suite). | SHIPPED |
| I10 | A strategy pool is never empty. | None. | PLANNED |
| I11 | Every slow run has a USD cap that stops it. | None in code. | PLANNED |
| I12 | Keys never share a process with untrusted text or an LLM. | `docker-compose.yml` gives the engine container `.env.example` and a named list of the secrets it needs. | SHIPPED |

## 8. Planned topics

These topics do not exist yet. Each is added to `packages/contracts` and docs/04 in the same change that first emits it, per AGENTS.md.

| Topic | Written by | Read by | For |
|---|---|---|---|
| `precall.detected` | pre-call analyzer | desk, Slow Bridge | Section 5.6, docs/26 section 9 |
| `slow.escalated` | the escalation gate | Slow Bridge | docs/26 section 9 |
| `synthesis.partial` | Slow Bridge | analyzers.slow | docs/26 section 9 |

## 9. Where the code differs today

A short map for the next engineer. The owner keeps the audit notes of 2026-10-18 with the evidence and line numbers in `docs/audits/`, which is gitignored.

- The live side mirrors paper intents, not paper positions. Sections 5.2 and 5.3.
- The kill switch is several checks in several places. Section 5.4.
- `analyzers/cheap.ts` reads callouts by creation time and caller fields by final state. Section 4.
- `idx.*` tables are current-state tables, not versioned. The smart set rides on `index.refreshed` bodies, which replays can read; the other `idx.*` fields cannot be replayed.
- `ctl rebuild` does not rebuild `analyzers.precall` and `analyzers.index` signals, because the list of projection consumers is kept by hand in `lib/db.ts`.
- Strategies cannot name slow signals: the signal catalog in `mind/dsl.ts` has no `synthesis.*`, `swarm.*` or `mood.*` kinds.
