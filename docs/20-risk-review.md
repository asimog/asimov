# 20 · Risk review: gaps, weaknesses, blind spots

A hard look at the whole plan. Each item: what can go wrong, how bad, and the fix (with the doc that now carries it). Severity: **H** can kill the product or lose real money; **M** hurts results or trust; **L** annoyance.

## Edge and trading

| # | Risk | Sev | Fix |
|---|---|---|---|
| 1 | **We are late to every callout.** Followers get push notifications instantly and sniper bots react in under a second. Our Feed Reader sees a callout 0 to 2 s late, then we need about 700 ms more. Pure "react to a call" strategies may always buy from faster bots. | H | Edge must come from anticipation (buying in Stirring before the wave), not reaction. The Scorekeeper tracks **entry rank** (how many buyers came before us after the trigger). Strategies whose median entry rank is worse than the crowd's lose fitness automatically. The Bellwether-follow family must prove itself in ghost mode before any capital. (docs/08, docs/17) |
| 2 | **Our own wallet is public.** KOL trackers watch wallets. Once we have a record, others will copy our buys and front-run our callouts and exits. | M | Post the callout seconds after the fill (Publisher priority). Exit ladders use bands, not exact multiples, with small random jitter inside the band. Measure "copied by" counts as a score. |
| 3 | **Exits right after our own callout look like a dump.** In a free market followers take their own risk, but hidden or deceptive selling would break trust and terms 7.1(d). | H | Honest trading code (docs/08): position disclosed in the callout, every exit posted as an update as it happens, no side wallets, no promises. Follower PnL and callout-to-exit time are published per callout, not used as gates. |
| 4 | **Multiple testing.** 128 strategies will produce lucky winners. | M | Fitness is a 90% LCB over trades after birth only, plus the probe stage at 0.05 SOL. Add: a strategy needs positive LCB in two separate time windows before full capital. (docs/08) |
| 5 | **Cold start.** Caller models, HMM and Hawkes need history. The feed backfill may not reach 48 h. | M | Weekend paper mode starts the record immediately. Models start with global priors and low confidence. No live capital until 2 weeks of tape exist. (docs/13) |
| 6 | **Holding threshold vs probe size.** If the platform's holding requirement is higher than a 0.05 SOL probe, probe strategies cannot call. | L | Probes run with `call.policy: silent` until they reach full capital. Phase 0 records the threshold. |
| 7 | **Callout cooldowns cap throughput.** If a new-callout cooldown is hours long, many good trades cannot be called. | M | Publisher queues calls by expected value; lower ones trade silently. The ledger shows called vs silent results separately. |
| 8 | **MEV and sandwiching** on our buys. | M | Tight slippage, simulate before send, `frontRunningProtection` with Jito tips when the order size passes a threshold. Costs go into fitness. |

## Data and platform

| # | Risk | Sev | Fix |
|---|---|---|---|
| 9 | **Undocumented endpoints.** The feed, the NATS stream and the posting flow can change or be blocked without notice. | H | Every source is an adapter with schema checks and a fallback (S1 DOM reads for the feed, RPC for trades). Schema drift stops one adapter, never the system. Keep the relationship with Pump.fun warm. (docs/06) |
| 10 | **Account ban** ends the voice. | H | Behave exactly as the terms and boundaries say. Paper and site keep running without the voice. A ban becomes a public event on the site, not a crash. |
| 11 | **Helius free tier limits** (about 10 requests per second, monthly credits, no gRPC stream on free). | M | Default Chain Reader uses RPC websockets (`accountSubscribe`, `signatureSubscribe`, `logsSubscribe`) and pump.fun NATS. The RPC budget is a metered analyzer; holder snapshots use DAS when available. gRPC turns on by config when a paid plan exists. (docs/06, docs/15) |
| 12 | **Transaction landing on free RPC.** Free endpoints can drop sends under load. | M | Send through the configured RPC plus the public Jito block engine when tipping; confirm by signature subscription; measure land rate per route and pick the best route automatically. |
| 13a | **One collector is not the market.** Two pump.fun collectors in one study shared 5 of 2,360 mints (arXiv:2609.18975). Our trade watch starts at the first callout, so pre-call flow is unobserved (44 of 53 coins on the first tape). | H | Coverage is an output: `system.gap`, a coverage status on every outcome, exclusions counted by reason, `ctl coverage`. RPC backfill (S2.7) adds a second collector and its overlap is reported. (docs/07) |
| 13b | **Peaks read as profits.** Peak multiples are what callers and datasets publish; they are not reachable exits. | H | `net_multiple` at our order size through the fill model is always shown with the peak; the peak never appears alone. (docs/07) |
| 13c | **Caller features leak the future.** `caller.dna` read pump.fun's later-updated `max_multiple` (found 2026-10-17). | M | Caller features read only our outcomes resolved before the callout; the no-lookahead check covers them through signal inputs. |
| 13d | **Indicators read as accusations.** Wash trades, bundles and ticker collisions have innocent explanations. | H | Case files keep evidence classes apart, list other explanations and limits for every indicator, and never use the words scam, insider or manipulation. Callout posts never name a person (AGENTS.md). |
| 13 | **Replay non-determinism** from external models (Jev, LLMs). | M | Every Jev and LLM answer is recorded on the Tape. Replays read recorded answers. What-if replays use a keyed cache. (docs/14, docs/17) |

## Treasury and token (payouts and seats apply from M5)

| # | Risk | Sev | Fix |
|---|---|---|---|
| 14 | **Whale splits into many wallets to take all top-50 slots.** Pro rata within the top 50 means a whale with 50 wallets just above the 51st holder captures the whole 49 points. | H | Owners are grouped into **clusters** before ranking: wallets funded from the same source within 24 h, or moving the token between each other, count as one holder. Clustering rules and the cluster map are published in each hourly proof. (docs/10) |
| 15 | **Rent-exempt minimum.** A SOL payout to an empty wallet below about 0.00089 SOL fails. | L | Accrue until the payout is ≥ 0.001 SOL and, for empty recipients, ≥ the rent-exempt minimum. (docs/10) |
| 16 | **Deposit seed loss.** Without the seed we cannot refund or burn from deposit addresses. | M | Seed backed up offline by the owner (two copies). The signer refuses to start without a verified backup flag. |
| 17 | **Seat price race and the premium.** Two people paying for the same seat price after a sale. | L | Reservations hold one seat number per order; the quote is locked for 15 minutes; the cap counts reserved seats. (docs/10) |
| 18 | **Profit accounting disputes.** Holders will check the numbers. | M | Hourly hash-joined proofs with every fill signature; an independent recompute before payout. (docs/10) |

## Agents, LLMs and cost

| # | Risk | Sev | Fix |
|---|---|---|---|
| 19 | **Prompt injection** through callout text, replies, X posts or pages reaching an LLM that can act. | H | No thinking agent can trade, sign or post directly. The Jev `guard` pack screens every input to an LLM and every outbound post. Thinking agents get only their own tools. (docs/18) |
| 20 | **Cheap models write bad JSON or wrong claims.** | M | Schema validation in code, Jev `verify` on claims, escalation to a stronger model only when a flag fires (SDE cascade). |
| 21 | **Runaway spend.** A loop of agent calls or swarm runs. | M | One OpenRouter key per thinking lane with a hard spend limit in OpenRouter, plus our own hourly caps. Swarm presets default to `lite`. (docs/15) |
| 22 | **Simulation quality.** Cheap models may act out of character in MiroShark. | M | Swarm outputs are scored like any other analyzer; low Brier means lower weight automatically. Jev `callers` pack is the default fast twin and costs almost nothing. |

## Security

| # | Risk | Sev | Fix |
|---|---|---|---|
| 23 | **S8 wallet shim abuse.** A page script could ask the shim to sign something. | H | S8 runs with agent-browser `--allowed-domains pump.fun,*.pump.fun`. The shim only forwards `signMessage`; the signer only signs messages matching the recorded login pattern; `signTransaction` always rejects. |
| 24 | **Signer reachable from the internet** through a misconfigured deploy. | H | The signer has no public domain on any profile; the Coolify and Railway profiles both bind it to the private network only; `ctl doctor` probes the public address and fails loudly if it answers. |
| 25 | **Secrets in logs or prompts.** | M | Log redaction for known key formats; the Jev `guard` pack also flags key-like strings in outbound text. |

## Operations and scale

| # | Risk | Sev | Fix |
|---|---|---|---|
| 26 | **Viral traffic hits the core.** Thousands of viewers on SSE and frames would load the `core` process. | M | A separate `relay` service fans out SSE and frames; the core process serves the relay only. Behind Cloudflare. Per-viewer frame rate drops under load. (docs/02, docs/15) |
| 27 | **Eight Chrome sessions cost money.** About 8 GB RAM. | L | `SESSIONS` count is config. Budget profile runs 3 (S1 feed, S2 research, S8 voice). |
| 28 | **Postgres growth** from trades. | L | Trades stay hot 90 days, then archive; partitioning by month. |
| 29 | **Single region, single database.** | M | Daily backups and point-in-time recovery; the tape archive in object storage can rebuild everything except money tables, which also export hourly in proofs. |

## Product blind spots

| # | Risk | Sev | Fix |
|---|---|---|---|
| 30 | **The site looks dead when nothing happens** (quiet market hours). | M | The sessions always have work (S1 reads the feed, Attention sends others to callers and coins), so session frames always change for real reasons; the Lab keeps committing and resolving forecasts. The Strategy Pool ghosts trade all the time. Quiet periods show the agent studying, never faked activity. |
| 31 | **Visitors cannot tell what is simulated.** | M | SIMULATED stamps, hatched frames and a separate color (umber) for all MiroShark content. |
| 32 | **The record is too short at launch.** | M | Launch gate requires 3 weeks of live record. (docs/13) |
| 33 | **The fly loses money in public.** | L | It is a capped 1% sleeve and the joke depends on honesty. |

## Firm-level risks (current scope)

| # | Risk | Sev | Fix |
|---|---|---|---|
| 34 | **The agent grades its own exam.** It edits its soul, strategies and code; if it could edit milestone checks or the books, it could promote itself. | H | Milestone checks, books, the Signer and the constitution are protected files; the Builder's guard refuses PRs touching them (docs/22, docs/13 S10.3). |
| 35 | **Costs eat a 0.2 SOL bankroll.** About 2.5% per round trip plus 0.0015 SOL rent per new coin (docs/21 §5). | H | Close token accounts after exits; cost-floor term in every strategy; max 5 open; 0.1 SOL always free. |
| 36 | **Builder ships plausible but wrong code.** | M | Sandbox, E2E suites, PRs merged by the owner until M2, 24 h notice after. |
| 37 | **Bounties attract spam or low-quality work.** | M | Clear acceptance rules per bounty; Guard on submissions; small budgets; payouts only from published results. |
| 38 | **X automation gets the account limited.** | M | Low posting rate, Guard on every post, no follows or likes, read-heavy use. |
| 39 | **Commit-reveal leaks edge** if reveals come too soon. | L | Reveal at resolution or after a fixed delay per strategy family. |
| 40 | **Free-tier providers throttle the fast lane.** | M | Measure in S6; upgrade by config; the fast lane degrades to math-only signals when Jev or RPC is slow. |
