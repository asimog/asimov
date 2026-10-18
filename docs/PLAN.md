# Plan

The work between the code today and the design in the other docs, in order. This is the one plan: it replaces the archived fix plan of 2026-10-18, and every open row of that plan is here (Phase 3 in A, Phase 4 in C, Phase 5 in D, Phase 6 and 1.16 in F, 1.17 in A13). Each unit ends in a check. Security fixes are named here only in outline: the detailed audit notes stay in the gitignored `docs/.archive/`, because the repo is public. Live trading is the last step and never blocks a unit.

Checks per unit follow `OPS.md` section 9: typecheck, lint, `docs:check` and short replays. Full suites run only when the owner asks.

## Done

| Work | Commit |
|---|---|
| Fix plan Phase 0: safety lines and clean-up | 983a144 |
| Fix plan Phase 1: one position model for paper and live, except 1.16 and 1.17 | 897a50f |
| Fix plan Phase 2: the owner owns the config (99 defaults moved to `.env.example`, `ctl limits`, `ctl lists`) | 76fb5b4 |
| Phase 3 rows 3.1, 3.2, 3.4, 3.6, 3.10, 3.14, 3.17 (as-of reads, trade timing, tie breaks, history repeats, smart demotion, one trade key, timestamp checks) | c697309, 98d65c7 |
| Slow-mind phases P0 to P9: both engines inside the repo, Slow Bridge, report exchange, rooms | docs/.archive (24) |
| Docs converged into this set; catalogs generated (`npm run docs:gen`) | this change |

Pushed without a test run: 5.5 (cited, whole-word BettaFish stance) and 5.14 (stub model refused in live mode). Partly done: 3.7 (count dedupe; the cursor table is open) and 3.13 (one crash risk removed; the Scout wallet set still grows).

## Next, in order

### A. Finish as-of reads (fix plan Phase 3)

| # | Work | Check |
|---|---|---|
| A1 | Pre-call analyzer emits `precall.detected`; the desk consumes it; no lost wakes | A replay shows the same pre-call entries whatever the consumer order |
| A2 | Scores in day buckets with a trailing window | Brier rows carry a bucket; old rows leave the window |
| A3 | Feed cursor in a table | A restart does not re-walk the feed |
| A4 | A pre-call hit counts only when the buying caller calls; one sample per coin and caller | Hand-checked table for three callers |
| A5 | `risk.state` recomputed on every holder snapshot; creator restored after restart | Two snapshots give two risk values |
| A6 | Index numbers: `early_right` from the peak after the first buy, copy price survives a flush, copy value at a fixed horizon | Hand-computed wallet table matches |
| A7 | Small measurement mismatches (caller.dna exclusions, push-first handles, case file as-of, one median helper) | Ledger and dna agree on one fixture |
| A8 | Scout wallet set persisted, bounded hot set | Memory flat over a 30 min smoke |
| A9 | `Retry-After` dates honoured | Unit through `pump-http` |
| A10 | `coin.graduated` on the first AMM trade | Graduated fixture shows the event |
| A11 | `slow.as_of` on every engine run | A replay run reads no row after the replay clock |
| A12 | A second short fixture with a graduated called coin; trim fixtures to 1 to 2 minutes; keep one long fixture for milestones | Replays under 60 s |
| A13 | Replay steps every consumer to the same time (1.17) | Live-leg replay is deterministic |

### B. Filter at the door and data tiers

| # | Work | Check |
|---|---|---|
| B1 | Config module for `config/*.json` (feeds, filters, retention, schedules, models) with `config.loaded` | A bad file stops boot with the field named |
| B2 | Feed sources and filters (recent, hot, trending, follow, top traders; chain; minimum position; mcap at call) | A replay with filters stores only passing callouts; rejected ones counted and sampled |
| B3 | Launch filters (dev buy, block-0 snipers, bundles, blocklists) before promotion | Filtered launches never reach the watched set |
| B4 | `follow_wallets` list and the follow feed | A followed wallet's buy promotes its coin |
| B5 | Backfill fans out across providers in parallel and checks our rollups first | Fewer RPC calls for a coin we already rolled up |
| B6 | Tape partitions by hour and class; the archiver (export, verify, `tape.archived`, offset check, drop) with a 4 h hot window while testing; row UPDATE and DELETE refused | A smoke archives and drops one partition; replay from the file matches |
| B6b | Pluggable archive targets: local folder, S3-compatible bucket, git repository on a schedule | The same partition lands in two targets with matching checksums |
| B7 | Index rollup compaction (48 h hourly, then wallet x coin and wallet x day); leaderboards hourly; light rebuild every 12 h, full rebuild every 48 h, deeper refresh weekly; weekly versions kept | Leaderboards queryable after a raw partition is dropped |
| B8 | `ctl stats`: rows and bytes per tier, archive lag | Numbers in `ctl doctor` |

### C. Strategy layer (fix plan Phase 4)

| # | Work | Check |
|---|---|---|
| C1 | No pool wipe: idle counts active minutes; one living strategy per niche | A replay with a 3 h gap keeps every niche |
| C2 | In-play reasons `smart_buy` and `scout` recorded on every decision | `launch_scan` decisions in a replay with no callouts |
| C3 | Calibration maps and the new sizing | Each family prints its map with counts; no Kelly before calibration |
| C4 | Honest promotion (family held-out window, correlated trades once, corrected bound) | Random-score pool promotes none |
| C5 | Fee-adjusted markouts drive retirement | A fee-losing strategy retires |
| C6 | Every exit gets the Board; trailing stop and caller-sold exits | Exit replays fire on the right condition |
| C7 | Refuse buys with no `risk.state` (4.7) | A fixture with rug checks keeps the desk trading |
| C8 | AMM impact term; graduated coins stay ghost until then | AMM fills move price with size |
| C9 | Index features: creator launches and rug rate, funder links, bundler and copier archetypes | Mass deployer refused with its reason |
| C10 | Rebuilt `pre_call` score and caller record fields | Hand-checked records for three callers |
| C11 | Jev guard pack, fenced symbols, `budget.exhausted` | Guard refuses a test injection |
| C12 | `config/limits.default.json` replaces limit defaults in code | `ctl limits show` reads the file defaults |

### D. Slow mind behind a real gate (fix plan Phase 5)

| # | Work | Check |
|---|---|---|
| D1 | Escalation gate, stages 0 to 3, hot set, control split; slow kinds in the catalog | Stage 1 lands on the Board within 15 s in a smoke |
| D2 | Per-run, per-stage, per-day USD caps; engines report real cost | A run over its cap stops `truncated` |
| D3 | One public-text check in core for every MCP write; citation markers as a separate field | A borrowed id does not survive; 0 text violations |
| D4 | Prompt fencing, worker hardening, required env per engine | Worker suites refuse bad requests |
| D5 | Bridge on its own timer, deferred escalations, empty swarms fail, real round numbers | Bridge suite passes |
| D6 | Core recomputes swarm and mood numbers; mood emitted or removed; Brier readers fixed | Board values equal raw-count recompute |
| D7 | Re-run 5.5 and 5.14 checks | Their suites pass |

### E. Public features

| # | Work | Check |
|---|---|---|
| E1 | Publisher speaks only under held coins: callouts are bull posts after our buy, replies under other callouts only while we hold the coin, data replies removed | A reply on an unheld coin is refused |
| E2 | Rug feed room from scraped comments and `risk.state`, evidence classes kept apart | `verify-asimog` screenshots and page text |
| E3 | Wiki: pages from the Index and ledger, Wiki writer agent for prose, versioned rows, `/wiki` room, export to a pluggable wiki target (bucket or GitHub docs) | A page rebuilds byte-identical from the same data |
| E5 | Embeddings in the agent runtime: OpenRouter embedding model, pgvector table with model and `seen_at`, as-of search; used for callout copies and narratives, reply rug reports, wiki and report retrieval | A replay search returns nothing seen after its time; spend metered |
| E4 | `config/models.json` with per-agent models and the free fallback chain on `LLM_FALLBACK_KEY` | A failing primary falls back in a smoke |

### F. Hardening and truth (fix plan Phase 6)

| # | Work | Check |
|---|---|---|
| F1 | Database roles, password, the Tape trigger | A write as a read role fails |
| F2 | MCP, relay, Signer and HTTP server hardening (limits, timeouts, auth order, caps), per the private audit notes | Hardening suites pass |
| F3 | Signer pins pump and AMM token accounts and bounds sells (1.16) | `signer-refuses` gains the new shapes |
| F4 | Unused write tools get consumers or are deleted; one token per Bridge engine | No tool without a reader |
| F5 | CI: typecheck, lint, `docs:check`, short replays | Green on a branch |
| F6 | Consumers: duplicate names refused; senses meet on the Tape, not callbacks; Index rollup becomes a consumer | `runtime.ts` has one list, no callbacks |

### G. Evals

| # | Work | Check |
|---|---|---|
| G1 | `evals/` layout and runner writing the suite artifact format | One eval runs end to end |
| G2 | Claim and stance evals for BettaFish, prose evals for wiki and rug feed, owner-labelled calibration set | Criteria in `OPS.md` section 10 reported |
| G3 | Point-in-time backtests on archive files per family | Net after costs and calibration per family |

### H. Live, last

| # | Work | Check |
|---|---|---|
| H1 | `live-roundtrip` passes on a mock chain | Suite green |
| H2 | One 0.01 SOL `live-*` test, run by hand | Books reconcile to the lamport |

## Pending owner decisions

None. Recorded in `docs/DECISIONS.md` on 2026-10-19.
