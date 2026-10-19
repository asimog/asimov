# Plan

The work between the code today and the design in the other docs, in order. This is the one plan: it replaces the archived fix plan of 2026-10-18, and every open row of that plan is here (Phase 3 in A, Phase 4 in C, Phase 5 in D, Phase 6 and 1.16 in F, 1.17 in A13). Each unit ends in a check. Security fixes are named here only in outline: the detailed audit notes stay in the gitignored `docs/.archive/`, because the repo is public. Live trading is the last step and never blocks a unit.

How a row is worked is in `WORKFLOW.md`: one row per session, its task file in `docs/tasks/`, its check from the cheapest tier in `OPS.md` section 9. A row is done when its suite passed on the commit that closes it (`npm run checks:status`).

## Done

| Work | Commit |
|---|---|
| Fix plan Phase 0: safety lines and clean-up | 983a144 |
| Fix plan Phase 1: one position model for paper and live, except 1.16 and 1.17 | 897a50f |
| Fix plan Phase 2: the owner owns the config (99 defaults moved to `.env.example`, `ctl limits`, `ctl lists`) | 76fb5b4 |
| Phase 3 rows 3.1, 3.2, 3.4, 3.6, 3.10, 3.14, 3.17 (as-of reads, trade timing, tie breaks, history repeats, smart demotion, one trade key, timestamp checks) | c697309, 98d65c7 |
| Slow-mind phases P0 to P9: both engines inside the repo, Slow Bridge, report exchange, rooms | docs/.archive (24) |
| Docs converged into this set; catalogs generated (`npm run docs:gen`) | ca65ab1 |
| A2 score day buckets and trailing window; A3 feed cursor table; A4 pre-call hit only on the buying caller's own call, one sample per coin and caller; A5 `risk.state` on every holder snapshot, creator restored; A6 `early_right`, copy price, copy value at a fixed horizon; A9 `Retry-After` dates; A11 `slow.as_of` pinned on every BettaFish run. Each passed its check (`precall-replay`, `feed-cursor`, `index-rows`, `pump-http`, `bettafish-insight`) | Section A commit |

Pushed without a test run: 5.5 (cited, whole-word BettaFish stance) and 5.14 (stub model refused in live mode).

## Next, in order

### A. Finish as-of reads (fix plan Phase 3)

Every row is built and pushed (2cf6401). A1, A7, A10, A12 and A13 passed their checks on 2026-10-19 (A7, A13 on the 10-minute tape); `npm run checks:status` marks them pending only until they re-run on the current commit. A8's code is done; only its 30-minute soak is unrun. The old tapes were deleted on 2026-10-19 (owner), so every replay re-run and the soak wait for G0.

| # | Work | Task |
|---|---|---|
| A1 | The desk wakes on `precall.detected` whatever the consumer order (order proof passed); restart proof passed 2026-10-19 | `docs/tasks/A1-restart.md` |
| A7 | caller.dna and the ledger agree | `docs/tasks/A7.md` |
| A8 | Scout bounded (passed); rollup capped at `INDEX_MAX_COINS` (`rollup-bounded` passed; 30-min soak not run) | `docs/tasks/A8-heap.md` |
| A10 | `coin.graduated` derived on the first AMM trade after curve trades | `docs/tasks/A10.md` |
| A12 | 2-minute fixtures replay in under 60 s, measured idle | `docs/tasks/A12.md` |
| A13 | Live-leg replay is deterministic | `docs/tasks/A13.md` |

**Resume here.** Read `docs/WORKFLOW.md`, then the B rows in order. B0 and B1 are done (`tape-durable`, `config-load` passed). Follow-ups noted for later rows: the Scout's trigger trade has an unknown phase (C8); `strategies-replay`, `callout-case-replay` and the site suites run in G0 on new tapes.

**How B to F are tested (owner, 2026-10-19).** Each task records the smallest real slice it needs from pump.fun (HTTP and NATS) or RPC first (`scripts/pump-sample.ts`, from B2), and codes against those real shapes and values, never guessed ones. Its check is a small run: a fast suite on that slice or on synthetic rows, a fresh database, no tape. Replays, soaks and long tapes wait for G0, after everything is coded. Filter numbers are owner settings in `config/filters.json`, tuned by editing the file and restarting.

### B. Filter at the door and data tiers

Order: B1 first (every filter and window reads its config). Then B2, B3, B4 in a chain (shared `filters.ts`). B5 and B6-partitions are independent and can run beside the chain. B6-archiver after B6-partitions; then B6b, B7 and B8, which do not touch each other's files.

| # | Work | Check |
|---|---|---|
| B0 | Done 2026-10-19. The Tape never drops an accepted event silently (`docs/tasks/B0.md`) | `tape-durable`: database stopped mid-run, zero dropped |
| B1 | Done 2026-10-19. Config module for `config/*.json` (feeds, filters, retention, schedules; `models.json` comes with E4) with `config.loaded` (`docs/tasks/B1.md`) | `config-load`: a bad field stops boot naming `launch.max_dev_buy_sol`; `config.loaded` carries each file hash |
| B2 | Done 2026-10-19. Feed sources (`recent`, `hot`, `follow`; every chain read, `solana` stored) and configurable callout filters (chain, minimum position, mcap at call), from the recorded real slice (`docs/tasks/B2.md`) | `feed-filters` passed on the slice: only passing callouts stored; rejected counted by reason and chain and sampled; a threshold change needs no code |
| B3 | Done 2026-10-19. Launch filters (dev buy, block-0 snipers, bundles, blocklists) before promotion, facts from NATS then the RPC pool then the pump.fun API, with a rule for unknown (`docs/tasks/B3.md`) | `launch-filters` passed: filtered launches never reach the watched set |
| B4 | Done 2026-10-19. `follow_wallets` list and the follow feed (`docs/tasks/B4.md`) | `follow-wallets` passed: a followed wallet's buy promotes its coin |
| B5 | Done 2026-10-19. Backfill fans out across providers in parallel and checks our rollups first (`docs/tasks/B5.md`) | `backfill-rollup` passed: fewer RPC calls for a coin we already rolled up; calls spread and fall back |
| B6 | Done 2026-10-19. Tape partitions by hour and class; the archiver (export, verify, `tape.archived`, offset check, drop) with a 4 h hot window while testing; row UPDATE and DELETE refused (`docs/tasks/B6-partitions.md`, `docs/tasks/B6-archiver.md`) | `tape-partitions` and `tape-archive` passed: a test-clock run archives and drops one partition; replay from the file matches |
| B6b | Done 2026-10-19. Pluggable archive targets: local folder, S3-compatible bucket by SigV4, git repository on a schedule (`docs/tasks/B6b.md`) | `archive-targets` passed: the same partition lands in three targets with matching checksums |
| B7 | Done 2026-10-19. Index rollup compaction (48 h, then wallet x coin and wallet x day); leaderboards hourly; light rebuild every 12 h, full rebuild every 48 h, deeper refresh weekly; weekly versions kept (`docs/tasks/B7.md`) | `index-compact` passed: leaderboards queryable after the raw rows are gone; scores equal |
| B8 | Done 2026-10-19. `ctl stats`: rows and bytes per tier, archive lag; `doctor` warns past one hour (`docs/tasks/B8.md`) | `ctl stats` printed every tier and `archive lag: 0 s` on a fresh slice; `doctor` reported the lag |

### C. Strategy layer (fix plan Phase 4)

| # | Work | Check |
|---|---|---|
| C1 | Done 2026-10-19 (`docs/tasks/C1.md`). No pool wipe: idle counts active minutes; one living strategy per niche | `evolve-floor` passed: a 3 h gap keeps 24 of 24 niches |
| C2 | Done 2026-10-19. In-play reasons `smart_buy` and `scout` recorded on every decision (`docs/tasks/C2.md`) | `desk-in-play` passed: `launch_scan` decides with no callouts; every intent tagged |
| C3 | Calibration maps and the new sizing | Each family prints its map with counts; no Kelly before calibration |
| C4 | Done 2026-10-19 (`docs/tasks/C4.md`). Honest promotion (family held-out window, correlated trades once, corrected bound) | `promote-honest` passed: 0 of 960 random-score strategies promoted (old kernel: 11) |
| C5 | Fee-adjusted markouts drive retirement | A fee-losing strategy retires |
| C6 | Every exit gets the Board; trailing stop and caller-sold exits | Small exit runs fire on the right condition |
| C7 | Done 2026-10-19. Refuse buys with no `risk.state` (4.7) (`docs/tasks/C7.md`) | `riskgate-refuses`, `owner-config` passed: no risk state refused, clean rug checks still trade |
| C8 | AMM impact term; graduated coins stay ghost until then | AMM fills move price with size |
| C9 | Index features: creator launches and rug rate, funder links, bundler and copier archetypes | Mass deployer refused with its reason |
| C10 | Rebuilt `pre_call` score and caller record fields | Hand-checked records for three callers |
| C11 | Jev guard pack, fenced symbols, `budget.exhausted` | Guard refuses a test injection |
| C12 | Done 2026-10-19. `config/limits.default.json` replaces limit defaults in code (`docs/tasks/C12.md`) | `owner-config` passed: limits show reads the file defaults |

### D. Slow mind behind a real gate (fix plan Phase 5)

| # | Work | Check |
|---|---|---|
| D1 | Escalation gate, stages 0 to 3, hot set, control split; slow kinds in the catalog | Stage 1 lands on the Board within 15 s in a short run |
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
| E4 | `config/models.json` with per-agent models and the free fallback chain on `LLM_FALLBACK_KEY` | A failing primary falls back in a short run |

### F. Hardening and truth (fix plan Phase 6)

| # | Work | Check |
|---|---|---|
| F1 | Database roles, password, the Tape trigger | A write as a read role fails |
| F2 | MCP, relay, Signer and HTTP server hardening (limits, timeouts, auth order, caps), per the private audit notes | Hardening suites pass |
| F3 | Signer pins pump and AMM token accounts and bounds sells (1.16) | `signer-refuses` gains the new shapes |
| F4 | Unused write tools get consumers or are deleted; one token per Bridge engine | No tool without a reader |
| F5 | CI: typecheck, lint, `docs:check`, the fast tier | Green on a branch |
| F6 | Consumers: duplicate names refused; senses meet on the Tape, not callbacks; Index rollup becomes a consumer | `runtime.ts` has one list, no callbacks |

### G. Evals

| # | Work | Check |
|---|---|---|
| G0 | Record fresh tapes (2-minute discovery, 2-minute graduation, one long); run every replay suite, the A8 soak, A7, A13 and the milestone suites on one commit (`docs/tasks/G0.md`) | `npm run checks:status` PASSED for every A and B task |
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
