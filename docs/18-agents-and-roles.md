# 18 · Agents and roles

Every agent has one job, its own credentials and the smallest set of powers that job needs. Agents never call each other. They meet only on the Tape and the Board (docs/03). An agent that is fooled or broken can damage only its own lane.

## Three kinds of agent

| Kind | Brain | Where it runs | Examples |
|---|---|---|---|
| **Service agents** | Deterministic code | `octo`, `tentacles`, `signer`, `organs-py` | Watcher, Trader, Wallet, Risk, Treasurer |
| **Reflex agents** | Jev (System One) | `octo` | Reflex, Guard |
| **Thinking agents** | LLMs through OpenRouter (DeepSeek v4.1 Flash by default) | `bettafish`, `miroshark`, `agents` (LangGraph JS) | Synth, Simulator, Postmortem, Researcher, Ops, Reporter |

Only service agents touch money. No LLM ever holds a key, places an order, or changes a limit.

## Roster

| Agent | Kind | Process | Reads | Writes | Money power | Capability token |
|---|---|---|---|---|---|---|
| Watcher | service | tentacles | pump.fun feed endpoints | `callout.*`, `observation.raw` | none | `cap:sense.feed` |
| Tentacle Keeper | service | tentacles | pages via agent-browser | `tentacle.*`, extracted facts | none | `cap:sense.tentacle` |
| Chain Ear | service | octo | NATS, RPC websockets | `trade.*`, `curve.*`, `holders.*`, confirmations | none | `cap:sense.chain` |
| X Eye | service | octo | X via XActions | `x.post` | none | `cap:sense.x` |
| Memory | service | octo | Tape | `mem.*` projections | none | `cap:mem.write` |
| Organs (one each) | service | octo, organs-py | Tape, Memory | their signal kinds only | none | `cap:board.<organ>` |
| Reflex | reflex | octo | Board, Memory | `jev.*` signals, `jev.answer` | none | `cap:board.jev` + Jev key |
| Guard | reflex | octo | texts in transit | pass / block verdicts | none | `cap:guard` + Jev key |
| Attention | service | octo | Board, budgets | `attention.grant` | none | `cap:attention` |
| Brood | service | octo | Board | `intent.*`, ghost positions, `genome.*` | none | `cap:mind.brood` |
| Allocator | service | octo | genome scores | `allocation.set` | none | `cap:mind.alloc` |
| Risk | service | octo | intents, portfolio, limits | `order.created`, `order.rejected` | creates orders | `cap:risk` |
| Trader | service | octo | orders | `order.submitted/filled/failed`, positions | requests swap signatures | `cap:sign.swap` |
| Wallet | service | signer | signing requests | signatures, its own audit log | holds keys | (issues all `cap:sign.*`) |
| Herald | service + tiny LLM line + Guard | octo, tentacle T8 | queued posts | `post.*` | requests login signatures | `cap:sign.login`, `cap:post` |
| Treasurer | service | octo | fills, sweeps, holder samples, deposits | `fees.*`, `profit.*`, `distribution.*`, `seat.*` | requests treasury signatures | `cap:sign.treasury` |
| Scorekeeper | service | octo | Tape, Board | `outcome.*`, `score.*` | none | `cap:score` |
| Synth | thinking | bettafish | `bettafish` views | `synthesis.*` (through octo API) | none | `cap:board.synthesis` + OpenRouter key A |
| Simulator | thinking | miroshark | swarm seeds | `swarm.*` (through octo API) | none | `cap:board.swarm` + OpenRouter key B |
| Extractor | thinking | octo | unknown page text | extracted facts, confidence < 1, Jev-verified | none | `cap:sense.extract` + OpenRouter key C |
| Postmortem | thinking | agents | `octo why`, `board`, `brood show` | `octo propose` (ghost genomes only) | none | `cap:mind.propose` + key D |
| Question Researcher | thinking | agents | worst trades, question scores | new Jev questions in shadow | none | `cap:jev.propose` + key D |
| Ops | thinking | agents | `octo doctor`, `state`, `budget` | `octo pause`, `octo kill`, alerts | can stop, never start | `cap:ops.stop` + key E |
| Reporter | thinking | agents | ledger, scores, synthesis | the daily Tide Report draft | none | `cap:report` + key E |
| Hunter writer | thinking | agents | `hunt.finding` evidence | finding prose for `/hunt` (Guard-checked) | none | `cap:hunt.write` + key E |

## How separation is enforced

1. **Processes.** Service, reflex and thinking agents live in different processes (docs/02 adds `agents`). The Wallet agent runs alone in `signer`, with no public network and no LLM dependency installed.
2. **Capability tokens.** Every write to the octo API or the signer carries a token naming exactly one capability. The signer maps `cap:sign.swap` to `/sign/swap` only, `cap:sign.treasury` to the treasury endpoints only, `cap:sign.login` to `/sign/login` only. A token for one lane cannot open another.
3. **Database roles.** One Postgres role per process lane, with grants only on its tables. Thinking agents get no direct database access; they use the octo API.
4. **One OpenRouter key per thinking lane**, each with its own spend limit set in OpenRouter. A runaway agent hits its own wall.
5. **Tool allowlists.** Each LangGraph agent loads only its tools from the octo MCP server (`@langchain/mcp-adapters`), filtered by its capability.
6. **No supervisor with power.** Thinking agents are started by deterministic triggers (cron and events) through a Postgres job table. No agent decides which other agent runs.

## Thinking agents on LangChain

| Piece | Choice |
|---|---|
| Framework | LangGraph JS (`@langchain/langgraph`), one small graph per agent |
| Model access | `@langchain/openai` `ChatOpenAI` pointed at the OpenRouter base URL from config |
| Default model | `deepseek/deepseek-v4.1-flash` ($0.032 in / $0.144 out per million tokens, 1M context) |
| Fallback model | Next cheapest from config (for example `qwen/qwen3.7-flash` or `openai/gpt-oss-20b`) |
| Tools | octo MCP server through `@langchain/mcp-adapters`, filtered per agent |
| Memory | `@langchain/langgraph-checkpoint-postgres` for graph state; long-term lessons through the Jev `memory` pack |
| Skill choice | Jev `skill` pack picks at most one skill from `agent/skills` per turn, so context stays small |
| Input safety | Every retrieved text goes through the Jev `guard` pack; retrieved records are filtered with the RAG passage pattern before they reach the model |

Model names live in config, never in code (docs/15 provider profiles).

### Graph shapes

| Agent | Trigger | Graph |
|---|---|---|
| Postmortem | Each closed position with a loss, or a missed wave the octopus did not trade | load why-chain → filter evidence (Jev) → explain (LLM) → draft genome mutation (LLM, JSON schema) → validate (code) → `octo propose` |
| Question Researcher | Weekly | load worst 60 cases → propose ≤ 18 questions (LLM) → validate shapes (code) → register in shadow |
| Ops | Every `system.*` event, and every 15 min | `octo doctor` → route finding (Jev `route` pack) → known fix: run it (pause, restart request); unknown: alert owner |
| Reporter | Daily 00:05 UTC | gather ledger, scores, synthesis → write in caveman voice (LLM) → Guard → publish to `/reports` |
| Hunter writer | Each new `hunt.finding` ≥ 0.85 | evidence → plain description (LLM) → Guard (never names a person as a scammer) → `/hunt` |
| Extractor | Unknown page type in a tentacle read | cheap LLM extracts → Jev `verify` → escalate to a stronger model only if a flag fires (SDE cascade) |

## Wallet agent details

- Holds W_trade, W_creator, W_dist, W_agent (x402), W_operator (docs/09) and the deposit seed.
- Accepts requests only on the private network, only with a valid capability token, only for its allowlisted shapes (docs/09).
- Has no LLM, no web access, no dependency on any other agent's output beyond the request in front of it.
- Logs every request, accepted or refused, to its own append-only log, mirrored to the Tape as `wallet.audit`.
