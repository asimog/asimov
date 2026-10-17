# 01 · Product spec

## One line

OCTOPUS is an autonomous AI trader that lives inside Pump.fun callouts. It reads every callout, simulates every caller, buys before the wave, calls it, calls its exits, and shares its profit with holders. You watch it work.

## Who it is for

| Audience | What they want | What they get |
|---|---|---|
| Pump.fun traders | Know which calls are early and real | The octopus's own callouts, with entry, exits and the reason, on Pump.fun where they already are |
| Token holders | A reason to hold | Hourly SOL share of trading profit (top 50) and perpetual seats |
| Spectators, crypto X | A thing worth screenshotting | A live 3D creature crawling real pages, labs that think out loud, a fruit fly managing 1% of the money |

## The centrepiece: callouts in, callouts out

1. **In.** Every Pump.fun callout is ingested within seconds, with its coin, author, market cap at call, text, media, updates, replies, reposts, and the author's trades.
2. **Understood in 150 ms.** Each callout gets an opportunity age, an echo score, a caller record, a place in a cascade forecast, and a Jev reading: which coin it really names, what kind of call it is, thesis quality, promotion language, and which tracked callers are likely to follow.
3. **Synthesized.** BettaFish writes a running synthesis of the whole feed: narratives, heat, who is moving, what is fake. Jev gives its fast version on every event.
4. **Simulated.** MiroShark runs simulated callers and followers forward to estimate the wave, with and without an octopus call, when the fast mind is unsure.
5. **Out.** When a genome decides, the octopus buys, confirms the holding, posts its callout, then posts each exit as an update.

## What a visitor sees

Visitors only watch, scrub and read. They cannot talk to the octopus.

### Rooms

| Route | Room | What happens there |
|---|---|---|
| `/` | **The Tank** | The 3D octopus with up to 8 tentacles. Each tentacle reaches into a glass plate showing a real page it is reading right now: the callout feed, a callout thread, a caller profile, a coin page, an X post. Suckers land on the exact elements being read. The mind strip shows current beliefs; the tape shows events as they happen. |
| `/synthesis` | **BettaFish Lab** | The live BettaFish forum: Insight, Query and Media agents and the host debating the callout feed, with every claim linked to the callouts it cites. The latest feed synthesis report. Narrative currents. |
| `/simulations` | **MiroShark Lab** | Running swarms. A simulated callout feed of simulated characters, clearly labeled as simulated. Branch A (no octopus call) vs Branch B (octopus calls) as fan charts. |
| `/brood` | **The Brood** | Every strategy genome alive: lineage tree, ghost PnL, live capital, births and deaths. |
| `/ledger` | **The Ledger** | Every buy, callout, update, exit and miss. Octopus PnL and follower PnL side by side. |
| `/calls/[id]` | Call dossier | One octopus callout: why-chain, entry context, exits, result, the signals that drove it. |
| `/callers/[id]` | Caller dossier | A caller's record: lead time, opportunity age, echo links, Shadow fidelity. Read only. |
| `/hunt` | **Hunt Board** | Echo rings, late callers, dump patterns, each with evidence and confidence. |
| `/treasury` | **Treasury** | Fee sweeps every 10 minutes, war chest, hourly distributions, burn log, proofs. |
| `/seats` | **Seats** | Buy a seat: see the price curve, enter a payout wallet, get a deposit address. |
| `/fly` | **Fly Lab** | The fruit-fly brain in 3D, its spikes, its 1% portfolio, its record. |
| `/rewind` | **Rewind** | Scrub any past moment. See only what the octopus knew then. |
| `/reports` | Tide Reports | The daily report written by the Reporter agent. |
| `/terms`, `/privacy`, `/disclosures` | Legal | Written by the owner. Linked from every page footer. |

### What visitors can do

- Orbit and zoom the tank (desktop drag, mobile pinch).
- Tap a tentacle to bring its page forward.
- Open any event, signal, callout or trade and see its why-chain.
- Scrub Rewind.
- Buy a seat through the deposit flow.
- Share a call card (an image the site renders from the canonical record).

That is all. No accounts, no wallet connection, no chat, no comments on the site.

## The octopus on Pump.fun

| Action | Rule |
|---|---|
| Callout | Only after a confirmed buy and the holding threshold is met. One active callout per coin. Short caveman-voice thesis. Position disclosed (terms 5.2(c)). |
| Update | Every exit step, every stop, every thesis change. Respects the platform's update cooldown; steps inside one cooldown window are batched into one update. |
| Reply (ink note) | One factual data note under someone else's callout, only when the Hunt evidence is above threshold. Never names the author as a scammer. Never more than one per callout. |
| Never | Likes, follows, reposts, quotes, groups, a second account, callout posts aimed at a person. |

## The token (after launch)

| Rule | Value |
|---|---|
| Supply | 1,000,000,000 (Pump.fun standard) |
| Creator fee sweep | Every 10 minutes |
| To war chest | 50% of each sweep. Base capital. Never distributed. |
| To operator and agent | The other 50% of each sweep: the agent's x402 wallet (LLM, API, subscriptions) up to a 30-day runway, the rest to the human operator |
| Profit | Realized trading PnL above the high-water mark, per hour |
| Profit split | 50 points to the octopus (stays in the war chest), 50 points to holders |
| Seats | 1 point each, perpetual, paid to the registered payout wallet. Taken out of the top-50 share. |
| Top 50 holders | (50 minus seat count) points, pro rata by balance. One seat: 49. A seat owner may also be a top-50 holder and gets both. |
| Seat price | Floor of seat n = 1,000,000 × 1.15^(n−1) tokens, plus a premium of 50% right after each sale that fades (×(1 + 0.5·e^(−hours/12))). Burned on receipt. |
| Seat cap | 21 seats. All 21 burn about 118.8M tokens. Top 50 keep at least 29 points. |
| Seat FOMO | Live lifetime earnings per seat on `/seats`; each sale announced on the site with the new price jump |
| Wallet connection | Never. Deposit addresses only. |

Details and edge cases: `10-treasury-token.md`.

## Before the coin

The full system runs for weeks before launch: paper first, then small live trades and real callouts, so the record is public before the coin exists. Launch line: "It was calling for weeks before it had a coin."

## Success measures

| Measure | Target before launch |
|---|---|
| Callouts ingested vs feed | ≥ 99.5% within 30 s |
| Tentacle uptime | ≥ 95% of 8 sessions live |
| Ghost Brood | ≥ 300 resolved ghost trades per active genome family |
| Live record | ≥ 3 weeks, positive octopus PnL and positive follower PnL after fees |
| Wave forecast | Beats Hawkes-only and TimesFM baselines on Brier score |
| Replay determinism | Same tape → same report hash, every run |
