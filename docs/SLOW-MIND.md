# Slow mind

BettaFish and MiroShark, built inside this repo, and how they feed the firm without ever blocking a trade. Target design; gaps are rows in `PLAN.md`.

## 1. What they are

| Engine | Upstream | In this repo | Gives |
|---|---|---|---|
| BettaFish | About 57k lines of Python: Insight, Query, Media, Forum and Report engines | `services/bettafish/engine` (vendored, `UPSTREAM` names the commit), worker `asimog_worker.py` | Cited synthesis of the callout feed and of one coin: narratives, stances, mood, suspicious patterns |
| MiroShark | About 105k lines: graph memory, personas, simulated platforms, beliefs, report agent | `services/miroshark/engine` with the `wonderwall/simulations/pumpfun/` module, worker `backend/asimog_worker.py` | Swarm simulation of callers and followers: wave chance, branch A (no house call) against B (with), belief drift, a SIMULATED report |

Both are integral parts of the repo, not forks or submodules. Licences (GPL-2.0, AGPL-3.0) are checked by the owner; credits come later. Crawlers, publishers and web enrichment of real people stay off.

## 2. Six rules

1. **Ingestion is independent.** Senses write the Tape and never call or wait for the engines. A dead engine changes nothing upstream.
2. **One read surface.** Both engines read the Postgres schema `slow`: read-only views over Memory, the Board and the Index, as role `slow_reader`, cut at `slow.as_of` so a replay never shows the future.
3. **One write door.** Engines write nothing directly. The Slow Bridge maps their output to core MCP write tools, where core checks citations (each cited id exists, was seen by now and is inside the window), recomputes numbers from raw counts, runs the public-text check and Jev `verify`.
4. **Reports are shared through the Tape.** Each finished report is `report.published` plus a row in `slow.reports`. Each engine reads the other's reports through the views. A run reads only reports published before it started.
5. **Each engine has its own lane.** BettaFish uses the `SYNTH` key and MiroShark the `SWARM` key, each with its own spend limit. Models come from `config/models.json`.
6. **Locked network.** The worker container gets a named list of secrets, never the whole `.env.local`, and reaches only the model API, the chosen search API, Postgres, Neo4j and the Bridge.

```
Senses ─► Tape ─► Memory, Board, Index ─► slow.* views ─► BettaFish, MiroShark
                                                              │
escalation gate ─► Slow Bridge (jobs, fan-out, mapper) ◄──────┘
                         │
                         └─► core MCP write tools (checks) ─► Tape ─► Board (slow signals)
```

## 3. The cascade

Engines take seconds to minutes; a Pump.fun trade often lasts minutes. So they start at the pre-call moment, run cheap by default and never block.

| Stage | Runs | Trigger | Target time | Cap |
|---|---|---|---|---|
| 0 | Math analyzers and Jev | Every event | under 200 ms | Jev budget |
| 1 | BettaFish nano: Insight only, one coin | `precall.detected` from a top-tier caller, or the hot set refresh | 5 to 15 s | `SLOW_STAGE1_USD_PER_RUN` |
| 2 | BettaFish lite plus a small MiroShark run | Stage 1 done and the gate says yes | 30 to 90 s | `SLOW_STAGE2_USD_PER_RUN` |
| 3 | Full engines | Owner preset only | minutes | `SLOW_STAGE3_USD_PER_RUN` |

Every stage also stops at `SLOW_USD_PER_DAY`. A run over its cap stops and returns a partial result marked `truncated`.

**The escalation gate** (numbers from code) escalates a coin one stage when all hold:

1. The coin is in play by `precall`, `smart_buy` or a callout in the last minute.
2. Fast signals are unsure: calibrated win chance between `ESC_P_LOW` and `ESC_P_HIGH` (0.35 and 0.65), or two fast signals disagree by more than `ESC_DISAGREE`.
3. Value of information beats cost: chance the decision changes times expected net change, above the stage's cost in SOL.
4. Quota and caps have room. A denied escalation is deferred, not dropped.

**The hot set.** The top `HOT_SET_SIZE` coins (5) by pre-call chance times caller quality get a stage 1 run every `HOT_SET_EVERY_S` (90), so a fresh result is usually on the Board when the callout lands. The Bridge emits `synthesis.partial` as soon as a first cited piece is ready.

**Proving value.** A stable hash of the coin sends half of the eligible coins to run and keeps half as control. After 50 escalations per stage, fee-adjusted markouts and net results of escalated coins are compared with control. A stage that does not beat its cost gets a quota of zero.

## 4. How strategies use slow signals

`synthesis.coin`, `swarm.wave_p` and `mood.feed` are System Two kinds in the signal catalog. Only `medium` and `slow` strategies may name them, always with `missing: skip`. A slow number reaches the Board only after core's checks. The report text is for the site (`/synthesis`, `/simulations`), never for decisions.

## 5. The Slow Bridge

`services/slow-bridge` (TypeScript) is the one adapter between core and the engines. It owns no business rules.

| Module | Job |
|---|---|
| scheduler | Feed runs on a timer; coin runs and swarms on escalations, on its own timer; a slot still running is skipped |
| jobs | `slow.jobs`: one row per run, idempotent by engine, kind, subject and slot; stale jobs re-queued |
| engines | Clients for the BettaFish worker and the MiroShark REST API; each worker requires a bearer token, caps concurrency, refuses duplicate ids and supports cancel |
| fan-out | One escalation can start both engines; in the `full` preset the swarm may wait for the BettaFish coin report |
| mapper | Engine output to core write tools; a zero-action swarm counts as failed; truncated samples are excluded from means |
| exchange | Reports both ways |
| health | Queue depth, real cost per lane and engine health for `ctl slow` and `ctl doctor` |

## 6. Presets

`BETTAFISH_PRESET` and `SWARM_PRESET` switch cost with one variable each: `nano`, `lite`, `full`. Presets set engines, forum rounds, agents, rounds, samples, graph memory and report mode. Engines report their real cost; the Bridge records it per lane. Defaults start at `nano` until spend is measured. The full knob tables live in `docs/generated/env.md`.

## 7. Ways it fails

| Risk | Defence |
|---|---|
| Engines invent a citation or borrow a real id | Markers are a separate field; feed claims must cite ids inside the window; core drops unsupported claims |
| A word like "rugged" marks a coin "avoid" | Stance only when a cited claim supports it |
| Strangers' text steers prompts | Callout text is fenced as data, trimmed, dropped if it looks like instructions |
| Simulated content mistaken for real | `simulated: true` everywhere, SIMULATED edges and labels, never mixed into the Index |
| Replays leak today's date into engines | `slow.as_of` on every run |
| Cost overrun | Per-run, per-stage and per-day caps; lane key limits as the hard stop |
| Upstream moves | Small named patches; suites after each merge |
