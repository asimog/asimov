# 18 · Agents and roles

Every agent has one job, its own credentials and the smallest set of powers that job needs. Agents never call each other. They meet only on the Tape and the Board (docs/03). An agent that is fooled or broken can damage only its own lane.

## Three kinds of agent

| Kind | Brain | Where it runs | Examples |
|---|---|---|---|
| **Service agents** | Deterministic code | `core`, `sessions`, `signer`, `analyzers-py` | Watcher, Trader, Wallet, Risk, Treasurer |
| **Reflex agents** | Jev (System One) | `core` | Reflex, Guard |
| **Thinking agents** | LLMs through OpenRouter (DeepSeek v4.1 Flash by default) | `bettafish`, `miroshark`, `agents` (LangGraph JS) | Synth, Simulator, Postmortem, Researcher, Ops, Reporter |

Only service agents touch money. No LLM ever holds a key, places an order, or changes a limit.

## Roster

| Agent | Kind | Process | Reads | Writes | Money power | Capability token |
|---|---|---|---|---|---|---|
| Watcher | service | sessions | pump.fun feed endpoints | `callout.*`, `observation.raw` | none | `cap:sense.feed` |
| Session Keeper | service | sessions | pages vian agent-browser | `session.*`, extracted facts | none | `cap:sense.session` |
| Chain Reader | service | core | NATS, RPC websockets | `trade.*`, `curve.*`, `holders.*`, confirmations | none | `cap:sense.chain` |
| X Reader | service | core | X via XActions | `x.post` | none | `cap:sense.x` |
| Memory | service | core | Tape | `mem.*` projections | none | `cap:mem.write` |
| Analyzers (one each) | service | core, analyzers-py | Tape, Memory | their signal kinds only | none | `cap:board.<analyzer>` |
| Reflex | reflex | core | Board, Memory | `jev.*` signals, `jev.answer` | none | `cap:board.jev` + Jev key |
| Guard | reflex | core | texts in transit | pass / block verdicts | none | `cap:guard` + Jev key |
| Attention | service | core | Board, budgets | `attention.grant` | none | `cap:attention` |
| Strategy Pool | service | core | Board | `intent.*`, ghost positions, `strategy.*` | none | `cap:mind.strategies` |
| Allocator | service | core | strategy scores | `allocation.set` | none | `cap:mind.alloc` |
| Risk | service | core | intents, portfolio, limits | `order.created`, `order.rejected` | creates orders | `cap:risk` |
| Trader | service | core | orders | `order.submitted/filled/failed`, positions | requests swap signatures | `cap:sign.swap` |
| Wallet | service | signer | signing requests | signatures, its own audit log | holds keys | (issues all `cap:sign.*`) |
| Publisher | service + tiny LLM line + Guard | core, session S8 | queued posts | `post.*` | requests login signatures | `cap:sign.login`, `cap:post` |
| Treasurer (sweeps and books) | service | core | fills, sweeps, transfers, chain balances | `fees.*`, `books.reconciled`, `nav.daily`, `markout.measured`, proofs (payouts and seats at M5) | requests treasury signatures | `cap:sign.treasury` |
| Milestone engine | service (protected code) | core | NAV, runway, reconciliation results, Signer incidents | `milestone.changed` | none | `cap:milestone` |
| Counsel adapter | human adapter (legal only) | core | counsel requests | `counsel.decision` (signed by counsel's key) | can pause the firm | counsel's own key |
| Scorekeeper | service | core | Tape, Board | `outcome.*`, `score.*` | none | `cap:score` |
| Synth | thinking | bettafish | `bettafish` views | `synthesis.*` (through core API) | none | `cap:board.synthesis` + OpenRouter key A |
| Simulator | thinking | miroshark | swarm seeds | `swarm.*` (through core API) | none | `cap:board.swarm` + OpenRouter key B |
| Extractor | thinking | core | unknown page text | extracted facts, confidence < 1, Jev-verified | none | `cap:sense.extract` + OpenRouter key C |
| Postmortem | thinking | agents | `ctl why`, `board`, `strategies show` | `ctl propose` (ghost strategies only) | none | `cap:mind.propose` + key D |
| Question Researcher | thinking | agents | worst trades, question scores | new Jev questions in shadow | none | `cap:jev.propose` + key D |
| Ops | thinking | agents | `ctl doctor`, `state`, `budget` | `ctl pause`, `ctl kill`, alerts | can stop, never start | `cap:ops.stop` + key E |
| Reporter | thinking | agents | ledger, scores, synthesis | the Daily Report draft | none | `cap:report` + key E |
| Integrity writer | thinking | agents | `integrity.finding` evidence | finding prose for `/integrity` (Guard-checked) | none | `cap:integrity.write` + key E |
| Builder | thinking | agents + sandbox | repo checkout in a sandbox, tasks, suite results | branches and pull requests with artifacts | none | `cap:build` + GitHub bot token + key F |
| Social | thinking | agents | social ledger, Daily Report, bounty results | X posts, bounty postings (Guard-checked) | requests bounty payouts | `cap:social`, `cap:sign.bounty` + key E |

## How separation is enforced

1. **Processes.** Service, reflex and thinking agents live in different processes (docs/02 adds `agents`). The Signer runs alone in `signer`, with no public network and no LLM dependency installed.
2. **Capability tokens.** Every write to the core API or the signer carries a token naming exactly one capability. The signer maps `cap:sign.swap` to `/sign/swap` only, `cap:sign.treasury` to the treasury endpoints only, `cap:sign.login` to `/sign/login` only. A token for one lane cannot open another.
3. **Database roles.** One Postgres role per process lane, with grants only on its tables. Thinking agents get no direct database access; they use the core API.
4. **One OpenRouter key per thinking lane**, each with its own spend limit set in OpenRouter. A runaway agent hits its own wall.
5. **Tool allowlists.** Each LangGraph agent loads only its tools from the core MCP server (`@langchain/mcp-adapters`), filtered by its capability.
6. **No supervisor with power.** Thinking agents are started by deterministic triggers (cron and events) through a Postgres job table. No agent decides which other agent runs.

## Thinking agents on LangChain

| Piece | Choice |
|---|---|
| Framework | LangGraph JS (`@langchain/langgraph`), one small graph per agent |
| Model access | `@langchain/openai` `ChatOpenAI` pointed at the OpenRouter base URL from config |
| Default model | `deepseek/deepseek-v4.1-flash` ($0.032 in / $0.144 out per million tokens, 1M context) |
| Fallback model | Next cheapest from config (for example `qwen/qwen3.7-flash` or `openai/gpt-oss-20b`) |
| Tools | core MCP server through `@langchain/mcp-adapters`, filtered per agent |
| Memory | `@langchain/langgraph-checkpoint-postgres` for graph state; long-term lessons through the Jev `memory` pack |
| Skill choice | Jev `skill` pack picks at most one skill from `agent/skills` per turn, so context stays small |
| Input safety | Every retrieved text goes through the Jev `guard` pack; retrieved records are filtered with the RAG passage pattern before they reach the model |

Model names live in config, never in code (docs/15 provider profiles).

### Lanes, keys and tools (as built)

| Lane (`LLM_KEY_<LANE>`) | Agents | Capability | Core MCP tools |
|---|---|---|---|
| `SYNTH` (A) | BettaFish | `cap:board.synthesis` | read: `callouts_window`, `coin_dossier`; write: `emit_synthesis_feed`, `emit_synthesis_coin`, `emit_forum_line` |
| `SWARM` (B) | MiroShark | `cap:board.swarm` | read: `coin_dossier`; write: `emit_swarm_result` |
| `THINK` (D) | Postmortem | `cap:mind.propose` | read: `events_since` (`position.closed`), `why`, `strategies_list`; write: `propose_strategy` |
| `THINK` (D) | Question Researcher | `cap:jev.propose` | read: `worst_cases`, `scores`; write: `propose_question` |
| `OPS` (E) | Ops | `cap:ops.stop` | read: `doctor`, `state`, `events_since` (`system.*`); write: `ops_alert`, `ops_stop` (pause or kill only) |
| `OPS` (E) | Reporter | `cap:report` | read: `state`, `ledger_summary`, `scores`, `soul_read`; write: `draft_report` |
| `OPS` (E) | Integrity writer | `cap:integrity.write` | read: `board_signals` (`integrity.finding`), `integrity_evidence`; write: `write_integrity_text` |
| none | Soul editor (the agent's reflection step, S10+) | `cap:soul.update` | `soul_read`, `soul_update` |

Every lane may also call `job_event`. Core checks the token on every call, so a graph that tries a tool outside its list gets `out_of_lane` and the refusal is logged as `system.note`. Each lane's model is limited by `LLM_USD_HOUR_<LANE>` (checked before each call, kept in `agents.spend`) on top of the spend limit set in OpenRouter. Tokens come from `MCP_TOKENS` (`cap=token` pairs, comma-separated, in `.env.local`).

Text that reaches a model is fenced (`<untrusted>`) and trimmed. Text that leaves a model passes the prose Guard in core (`checkProse`: no emoji, no dash, no promise, no person) before it is written; the Jev `guard` and `route` packs replace the deterministic checks when they exist.

### Graph shapes

| Agent | Trigger | Graph |
|---|---|---|
| Postmortem | Each closed position with a loss, or a missed wave the agent did not trade (`missed_waves`: a 5 min `outcome.measured` with coverage ok and net multiple at or above `POSTMORTEM_MISSED_MULT`, default 2, on a coin with no position) | load why-chain → filter evidence (Jev) → explain (LLM) → draft strategy mutation (LLM, JSON schema) → validate (code) → `ctl propose` |
| Question Researcher | Weekly | load worst 60 cases → propose ≤ 18 questions (LLM) → validate shapes (code) → register in shadow |
| Ops | Every `system.*` event, and every 15 min | `ctl doctor` → route finding (a code table now; the Jev `route` pack later) → known fix: run it (pause on a stalled tape, restart request on consumer lag, `ops.restart_requested`); unknown: alert owner |
| Reporter | Daily 00:05 UTC | gather ledger, scores, synthesis → write in terse voice (LLM) → Guard → publish to `/reports` |
| Integrity writer | Each new `integrity.finding` ≥ 0.85 | evidence → plain description (LLM) → Guard (never names a person as a scammer) → `/integrity` |
| Builder | Each task in the build queue | read task → plan → code in sandbox → run suites → fix until green or give up → open PR with artifacts → Lab entry |
| Social | Daily, and on notable events | read social ledger → pick posts and bounty campaigns (kernel social level) → write (LLM, terse voice) → Guard → post; pay bounty winners from published results |
| Extractor | Unknown page type in a session read | cheap LLM extracts → Jev `verify` → escalate to a stronger model only if a flag fires (SDE cascade) |

## Signer details

- Holds W_trade, W_creator, W_dist, W_agent (x402), W_operator (docs/09) and the deposit seed.
- Accepts requests only on the private network, only with a valid capability token, only for its allowlisted shapes (docs/09).
- Has no LLM, no web access, no dependency on any other agent's output beyond the request in front of it.
- Logs every request, accepted or refused, to its own append-only log, mirrored to the Tape as `wallet.audit`.
