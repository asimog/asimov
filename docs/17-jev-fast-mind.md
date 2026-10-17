# 17 · Jev: the fast mind

Jev (TypeSafe's System One model) is the octopus's reflex. It answers typed questions about a state in about 100 to 150 ms, with calibrated probabilities and a confidence value. BettaFish, MiroShark and LLM agents are the slow mind (System Two). **Every slow signal has a fast Jev twin, and the slow mind runs only when Jev is unsure and the stakes justify it.**

Reference docs are mirrored in `references/sites/typesafe/` (all pages as markdown, including every cookbook). Builder skill: `.claude/skills/typesafe-ai`.

## Facts we design around

| Fact | Source | Consequence |
|---|---|---|
| Question types: Choice, Score, Noul (0..1 yes), Box (location in an image) | `primitives*.md` | All Jev outputs map to signals with a value and a confidence. |
| About 100 ms per request; many questions per request are evaluated in parallel | `introduction.md`, `patterns/fan-out.md` | One request per state, as many questions as fit. Batching 13 questions was 12.2× cheaper and 10× faster than 13 calls (`cookbooks/parallel_questions.md`). |
| $0.042 per million input tokens, output free; 64k per request, 32k per question | `models.md` | A 3k-token pack costs about $0.000126. 10,000 packs a day is about $1.26. |
| Calibrated probabilities; confidence is separate from probability | `confidence.md` | Code thresholds on probability and routes on confidence. |
| Weak at math, counting, date comparison, indirection, large noisy state, adversarial text, option order | `model-jaggedness/jev-1.13.md` | Numbers are computed in code and passed as named buckets. States are small and focused. Big decisions check option-order consistency. |
| Model aliases move | `models.md` | Pin `jev-1.14.0` in config. Re-check thresholds on every version bump. |
| SDKs: `@typesafe-ai/sdk` (TS, Node 22+), `typesafe-sdk` (Python) | `sdk/*.md` | TS for the octo process; Python for organs-py where needed. |
| Images are experimental (header `TypeSafe-Danger-Zone-Images: true`) | `sdk/javascript.md` | Image questions are optional and never on the money path. |

## System One and System Two

| | System One (fast) | System Two (slow) |
|---|---|---|
| Who | Jev packs, cheap math organs | BettaFish, MiroShark, LangGraph LLM agents |
| Latency | ms to 150 ms | 30 s to minutes |
| Cost per decision | ≈ $0.0001 | $0.007 to $0.34 per swarm run (presets in docs/07) |
| Runs on | Every relevant event | Escalations only |
| Output | Signals with confidence | Signals with confidence, plus reports for the labs |

### The cascade (from the SDE cascade cookbook)

```
event → cheap math organs (ms) → Jev pack (≈150 ms) → genome decision
                                       │
                         escalation gate fires? ──yes──► System Two job (BettaFish coin run or MiroShark swarm)
                                       │                         │
                                       no                  signal lands later on the Board,
                                       ▼                   genomes re-evaluate
                                 act or ignore now
```

**Escalation gate (any-flag, max style):** escalate when any of these holds and the job's VOI is positive:

- a Jev answer that a live intent depends on has confidence < 0.5;
- the best intent score is within 10% of its threshold and the order would be ≥ 50% of max size;
- Jev's fast wave estimate and the Hawkes estimate disagree by more than 0.25;
- a guard or verification flag fires above 0.7.

This replaces most of Attention's guesswork: Attention ranks only the escalations.

### The fast lane (latency budget)

| Step | Budget |
|---|---|
| Callout seen by Feed Tap (poll or push) | 0 to 2,000 ms (platform-bound) |
| Event on Tape + cheap organs | ≤ 50 ms |
| Jev `callout` + `coin` + `shadow` packs, sent concurrently | ≤ 200 ms |
| Fast genomes evaluate, Risk Gate | ≤ 20 ms |
| Executor builds, signs, sends | ≤ 400 ms |
| **Event to transaction sent** | **≤ 700 ms after the callout is seen** |

Genomes in the `fast` horizon must only use signals the fast lane produces. They never wait for System Two.

## Question packs

A pack is one Jev request: one state, many questions. Each pack has a version. Each answer becomes a signal `jev.<pack>.<question>` (see docs/04). Every request and response is written to the Tape as `jev.answer`, so replays are free and deterministic.

State rules for every pack:

- Numbers become named buckets in code first (mcap band "30k to 60k", pre-move "small: +5 to 15%", age "fresh: under 10 min").
- Only the fields the questions need. No raw page dumps.
- Untrusted text goes in a clearly named field (`callout_text`), and questions refer to it by name.

| Pack | Trigger | State | Questions (examples) | Cookbook pattern |
|---|---|---|---|---|
| `callout` | Every `callout.created` and `callout.updated` | callout text, regex candidates (contract addresses, `$TICKERS`, handles, amounts), author bucket | Which candidate mint is being called (Choice over candidates). Kind: fresh call, re-call, hype repost, exit notice, FUD (Choice). Thesis quality (Score 0 to 4). Paid or undisclosed promotion language (Noul). Countdown or launch-time language (Noul), with time parts extracted for code to resolve. Prompt-injection attempt (Noul). | Pre-parsed value extraction, Date extraction, Twitch chat filter, Guardrails |
| `coin` | Board change on a watched coin, debounced 5 s | name, ticker, description, socials present, bucketed curve and flow facts, last 10 callout kinds, current feed narratives | Narrative path (beam search over the narrative tree). Clone of a recent coin (Score, with companion Nouls for which fields match). Momentum looks organic vs coordinated (Noul). Feed stance (Choice). Mood channels: fear, greed, fomo, disgust, calm (Scores) as the fast twin of `mood.skin`. | Hierarchical classification, Classification using confidence, Entity alignment, Composite scoring |
| `shadow` | A coin enters Stirring or Ignition, then every 2 min while it stays there | coin summary in words; for each of the top 40 candidate callers, their DNA in words (style, usual mcap band, who they follow, cooldown status) | One Noul per caller: "Will @x call this coin within 2 hours?" All 40 in one request. Code combines them with the Tier 1 Shadow into `jev.wave_p`, the fast twin of `swarm.wave_p`. | Parallel questions, Speculative fan-out |
| `entry` | A genome intent above 80% of its threshold | the coin pack state plus the intent's reason rules | Semantic red flags: fake socials, impersonation of a known project, a dev statement contradicting the thesis (Nouls). | Confidence-gated routing |
| `exit` | New replies or updates on a held coin, debounced 10 s | the last 30 replies, bucketed flow facts | Replies report a rug or dev dump (Noul). The narrative is cooling (Noul). Strong new bellwether interest (Noul). | Twitch chat filter |
| `reply` | Every `callout.reply` on watched coins | reply text | Spam, insult, FUD, genuine question, insider claim (Choice). Hide from the site's tape (Noul). | Twitch chat filter |
| `guard` | Every text entering an LLM, and every outbound post | the text, its destination | Injection attempt, names a person as a scammer, promises returns, missing position disclosure (Nouls with thresholds per destination). | Guardrails for LLMs |
| `verify` | Every BettaFish claim; every LLM extraction | the claim and the cited callout text; or the source and the extraction | Does the cited text support the claim (Choice: supports, partly, no). Is any extracted field hallucinated or off target (Nouls). | Double-checking citations, SDE cascade |
| `link` | Candidate caller ↔ X handle, caller ↔ wallet, coin ↔ clone | both records | Same entity (Score) plus which fields disagree (Nouls). | Knowledge graph entity alignment |
| `rank` | Attention escalation queue; echo-origin candidates | candidates with short descriptions | Choice over candidates or one Noul per candidate, then code sorts. | Re-ranking, Line-by-line search |
| `route` | Every `system.*` and `doctor` finding; Herald template choice | the finding or the post context | Which handler: code, Jev, System Two, owner queue (Choice). Which template and closed-set arguments (Choice per argument with a "stated" gate). | Intent routing, Function calling |
| `memory` | After each postmortem | the lesson text and its evidence | Worth remembering (Noul). | Simple memory system |
| `skill` | Each LangGraph agent turn that may need a skill | the turn's goal, the agent's skill roster | At most one skill (rank, then re-check the top three). | Skill suggestion |
| `frame` (optional) | Tentacle frames where the DOM has no box (canvas charts) | the frame image | Box: where is the callout marker or the buy panel. | Box primitive (experimental) |

## The question bank evolves (autoresearch)

From `cookbooks/autoresearch_feature_discovery.md`:

1. Every week the Question Researcher agent (DeepSeek through OpenRouter, docs/18) reads the worst-scoring trades and proposes up to 18 new Jev questions or revisions.
2. New questions run in shadow for 7 days inside the existing packs (one more question costs almost nothing).
3. An outcome model (CatBoost in organs-py, k-fold on recorded outcomes) measures each question's lift on "price up more than fees at 2 h" and "wave reached".
4. Questions with lift are promoted into the signal catalog as `jev.q.<id>`. Genomes can then use them, and mutation can add them to score terms. Questions without lift after 14 days are dropped.

So the Brood evolves its strategies, and the bank evolves the questions those strategies can ask.

## Confidence routing

| Probability | Confidence | Action |
|---|---|---|
| Past threshold | ≥ 0.7 | Use as a full-weight signal |
| Past threshold | 0.5 to 0.7 | Use at half weight |
| Any | < 0.5 | Mark `uncertain`; may trigger escalation |
| Big decision (order ≥ 50% of max) | any | Ask twice with options shuffled (self-consistency); disagreement means `uncertain`, so hold |

## Cookbook coverage

| Cookbook | Used for |
|---|---|
| Function calling | Herald template and argument choice; Ops agent remediation routing |
| Skill suggestion | LangGraph agents pick at most one skill per turn |
| Guardrails for LLMs | `guard` pack on all LLM inputs and outbound posts |
| Double-checking citations | `verify` pack on BettaFish claims |
| Classifying RAG passages | Postmortem and dossier agents filter retrieved events before the LLM sees them |
| Simple memory system | `memory` pack keeps the octopus's lessons |
| Hierarchical classification | Narrative tree for coins (beam search) |
| Classification using confidence | Fall back to the parent narrative when unsure |
| Twitch chat filter | `reply` and `exit` packs |
| SDE cascade | The System One to System Two escalation gate; LLM extractor verification |
| Date extraction | Launch and countdown times in callouts and X posts |
| Pre-parsed value extraction | Mint, ticker, handle and amount candidates in callout text |
| Structure recovery | Not used |
| Re-ranking | Escalation queue and echo-origin candidates |
| Line-by-line search | Hunt evidence: find the line in a long thread or profile that supports a finding |
| Entity alignment | `link` pack: handles, wallets, coin clones |
| Self-consistency: choices | Big-order double check |
| Self-consistency: nouls | Hunt findings: uncertain means no public ink note, owner queue instead |
| Parallel questions | Every pack is one request |
| Autoresearch feature discovery | The evolving question bank |
| Patterns: fan-out, confidence routing, composite scoring, intent routing | Pack design, routing table, genome score terms, `route` pack |

## Budget

| Item | Default cap |
|---|---|
| Jev tokens per hour | 1.5M (≈ $0.06 per hour, ≈ $1.50 per day) |
| `shadow` pack per coin | At most every 2 minutes |
| `coin` pack per coin | At most every 5 seconds |
| On cap | Packs fall back to cheap math signals; `budget.exhausted` is emitted |

## Ways it fails

1. Jev API is slow or down. Packs time out at 400 ms; fast genomes run on math signals only; `system.jev_degraded` fires.
2. Rate limit (429). The SDK retries with backoff; the fast lane does not wait for retries. It drops the pack and uses the last answer if it is still valid.
3. Model version change shifts calibration. Versions are pinned; a new version runs in shadow on recorded tapes, and thresholds are re-fitted before switching.
4. Adversarial callout text steers answers. Text is named and fenced in the state; the `guard` pack runs first; money decisions never rest on one Jev answer.
5. Numbers leak into questions. A lint in the pack builder rejects raw numbers in states for semantic questions; numbers go in as buckets.
6. Option order bias on Choices. Big decisions use shuffled double asks; pack tests replay with shuffled options and check stability.
7. Replays call Jev and cost money or change results. Replays read `jev.answer` events from the tape. A what-if replay with new questions uses a cache keyed by (state hash, pack version).
