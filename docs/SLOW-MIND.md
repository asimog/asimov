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

How spend is counted and stopped: each worker meters every chat call it makes through the OpenAI client (token usage times `LLM_PRICE_IN_PER_M` and `LLM_PRICE_OUT_PER_M`, both required at boot) and reports the sum as `cost_usd` on every status poll. The Bridge sends each job's `usd_cap` (its stage's `SLOW_STAGE<n>_USD_PER_RUN`; a feed run takes the cap of its preset's size: `nano` 1, `lite` 2, `full` 3). Before each call the worker checks the cap: once spend is past it, BettaFish stops the engine and keeps the paragraphs it finished, MiroShark stops at the next round and writes the numbers-only report. The job records the engine's last reported spend, even when the run fails. The Bridge sums that engine's `cost_usd` for today (UTC, by when each run finished); at or past `SLOW_USD_PER_DAY` new and claimed jobs wait as `deferred` with the reason `day_cap`, and run once a new day has budget unless they expire first. `ctl slow` prints today's spend per engine and stage. The lane keys' own provider limits stay the hard stop.

**The escalation gate** (numbers from code) escalates a coin one stage when all hold:

1. The coin is in play by `precall`, `smart_buy` or a callout in the last minute.
2. Fast signals are unsure: calibrated win chance between `ESC_P_LOW` and `ESC_P_HIGH` (0.35 and 0.65), or two fast signals disagree by more than `ESC_DISAGREE`.
3. Value of information beats cost: chance the decision changes times expected net change, above the stage's cost in SOL.
4. Quota and caps have room. A denied escalation is deferred, not dropped.

The gate is the core consumer `attention` (`services/core/src/mind/escalate.ts`); it writes only `jev.escalated` (`stage`, `arm`, `deferred`, `gate_reasons`, `voi`) and the desk never waits for it. Its numbers:

- In play: a `precall.detected`, a `coin.watched` from a smart or followed wallet within `ENTRY_WINDOW_MIN`, or a live callout within the last minute. One stage 1 grant per coin per window.
- p: the highest calibrated win chance over live strategies (each one's score read through its family's map, once the map has enough bins); without maps, the mean of the fast chances `precall.callout_p.p`, `callers.wave_p.p`, `hawkes.wave_p.p`. Disagreement is the spread of those fast chances.
- VOI = P(change) x stake, with P(change) = 1 - |2p - 1| and stake = the owner's `max_order_sol`. Cost = `SLOW_STAGE<n>_USD_PER_RUN` / `SOL_USD`. A grant needs VOI above cost.
- Room is the Bridge's alone (section 5): per-hour quotas and the day cap. The gate grants at most once per coin per `ENTRY_WINDOW_MIN`.
- Stage 1 is job `synthesis_coin` (BettaFish `nano`); a `synthesis.coin` on a coin with a stage 1 run grant re-runs the test for stage 2, job `swarm_run` (BettaFish `lite` plus a small swarm). Stage 3 is never automatic.
- Control: `sha256(mint)` mod 2 puts half the coins in `control`; they get the same event with `arm: control`, `job: null` and no run. The hot set grants go through the same split, run on fixed `HOT_SET_EVERY_S` buckets of Tape time, and skip a coin granted within `ENTRY_WINDOW_MIN`.

**The hot set.** The top `HOT_SET_SIZE` coins (5) by pre-call chance times caller quality get a stage 1 run every `HOT_SET_EVERY_S` (90), so a fresh result is usually on the Board when the callout lands. The Bridge emits `synthesis.partial` as soon as a first cited piece is ready.

**Proving value.** A stable hash of the coin sends half of the eligible coins to run and keeps half as control. After 50 escalations per stage, fee-adjusted markouts and net results of escalated coins are compared with control. A stage that does not beat its cost gets a quota of zero.

## 4. How strategies use slow signals

`synthesis.coin`, `swarm.wave_p` and `mood.feed` are System Two kinds in the signal catalog. Only `medium` and `slow` strategies may name them, always with `missing: skip`.

Every slow number is core's own arithmetic. MiroShark sends raw counts per sample (`branch`, `callers`, `actions`, `net_lamports`, `truncated`; the schema refuses any other field, so an engine-sent `wave_p` is refused). Core keeps full samples only: `wave_p` is the share of full branch A samples with at least `SWARM_WAVE_CALLERS` callers (the same setting the Scorekeeper's hit uses), `d_callers` and `d_net_sol` are B's mean minus A's, `samples` counts full A samples and `truncated` says one was cut. `mood.feed` is computed by core from each kept `synthesis.feed`: the distinct callouts cited by bullish stances against those cited by bearish or avoid stances; `mood` = (bull - bear) / (bull + bear), `bull_share` = bull / (bull + bear), labelled fearful or greedy past a third of the way to either end; no cited stance, no mood. A slow number reaches the Board only after core's checks. The report text is for the site (`/synthesis`, `/simulations`), never for decisions.

## 5. The Slow Bridge

`services/slow-bridge` (TypeScript) is the one adapter between core and the engines. It owns no business rules.

| Module | Job |
|---|---|
| scheduler | Two loops with their own busy flags: escalations and the feed slot every `SLOW_SCHEDULE_S` (5 s), runs every `SLOW_TICK_S` (and at once when a tick queued something), so a long run never delays reading a grant. Stage 1 queues a BettaFish `nano` coin run; stage 2 BettaFish `lite` and a MiroShark `nano` swarm; stage 3 the owner's presets; a `control` grant queues nothing |
| jobs | `slow.jobs`: one row per run, idempotent by engine, kind, subject and slot; stale jobs re-queued. A grant with no room (core marked it `deferred`, or the per-hour quota is spent) waits as `deferred` with its reason; each schedule tick first expires deferred jobs older than `SLOW_DEFER_MAX_MIN` (`failed: expired`), then promotes the oldest while quota allows |
| engines | Clients for the BettaFish worker and the MiroShark REST API; each worker requires a bearer token, caps concurrency, refuses duplicate ids and supports cancel |
| fan-out | One escalation can start both engines; in the `full` preset the swarm may wait for the BettaFish coin report |
| mapper | Engine output to core write tools; a zero-action swarm finishes `failed: empty_swarm` and writes nothing; core leaves truncated samples out of every mean (MiroShark's `summarize` does the same for its report text only); forum lines carry the engine's own round |
| exchange | Reports both ways |
| health | Queue depth, real cost per lane and engine health for `ctl slow` and `ctl doctor` |

## 6. Presets

`BETTAFISH_PRESET` and `SWARM_PRESET` switch cost with one variable each: `nano`, `lite`, `full`. Presets set engines, forum rounds, agents, rounds, samples, graph memory and report mode. Engines report their real cost; the Bridge records it per lane. Defaults start at `nano` until spend is measured. The full knob tables live in `docs/generated/env.md`.

## 7. Ways it fails

| Risk | Defence |
|---|---|
| Engines invent a citation or borrow a real id | Markers are a separate field (`cites`); the worker strips them from every text and core never parses ids out of prose. A cited callout counts only when it was seen inside the run's window (`window_min` before the Bridge's `as_of`, never after now); core drops unsupported claims and counts them |
| Engine text names a person or promises | One public-text check (`publicText` in `hands/text-checks.ts`: hidden characters removed, NFKC, the prose Guard) runs on every text field of every MCP write. A refused field drops its claim (feed, coin claims, swarm posts) or refuses the call (forum line, coin narrative, report summary and Markdown, drafts, alerts, job events) |
| A word like "rugged" marks a coin "avoid" | Stance only when a cited claim supports it |
| Strangers' text steers prompts | Callout text is fenced as data, trimmed, dropped if it looks like instructions. Inside the workers, callouts, replies, handles, web results, coin names and the other engine's reports enter prompts only inside core's `<<< >>>` fence (hidden characters removed, NFKC, fence marks stripped), and every prompt says fenced text is data; a coin symbol is reduced to a plain ticker |
| A stranger reaches a worker | Each worker answers only the Bridge's bearer token (401 otherwise), checks every request (400 with the reason), never starts a known job id twice (409), caps concurrent runs (429), and refuses to boot without each required key, naming it. The container's network lock is an open item for G0 |
| Simulated content mistaken for real | `simulated: true` everywhere, SIMULATED edges and labels, never mixed into the Index |
| Replays leak today's date into engines | The Bridge sends `as_of` (the job's slot) with every run; every BettaFish read pins `slow.as_of` to it, and a read without one fails. MiroShark reads only through core tools, which use core's Clock |
| Cost overrun | Per-run, per-stage and per-day caps; lane key limits as the hard stop |
| Upstream moves | Small named patches; suites after each merge |
