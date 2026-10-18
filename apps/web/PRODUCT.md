# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, served in this order (owner, 2026-10-17):

1. **Anyone who arrives**: people who discover the Asimog coin or the project. The first viewport must amaze and capture interest before it explains.
2. **Pump.fun traders**: people who follow or check Asimog's callouts. Under the spectacle, every call, position, outcome and number can be verified and traced to its evidence.

## Product Purpose

asimog.com is the public window into Asimog, a near-autonomous AI firm that started with a Pump.fun coin, a small machine and 0.2 SOL. Its centrepiece is Pump-native callout intelligence: it reads every callout and every trade, learns which wallets and callers move which coins, calls coins first with its position disclosed, and trades on paper, then live, through a Risk Gate. The site shows the firm working, live, and proves what it claims. Success: a visitor understands within seconds that something real and autonomous is happening, and a trader can check any claim down to the event.

## Positioning

A glass box, not a pitch: every motion on screen is caused by a real event on the firm's Tape; every decision is hashed before the outcome and revealed after (commit-reveal); losses are shown with the wins; simulated content is labeled SIMULATED and paper trades PAPER.

## Operating Context

The site reads core's public relay (server-sent events and a snapshot endpoint) and never writes to core, except a validated payout wallet address at milestone M5. The firm runs on paper today (no live money yet); its callouts are paper house callouts. Data available now: callouts, trades, signals (flow, pre-call, risk, smart wallets), strategy pool and kernel allocations, paper positions and markouts, commits and reveals, outcomes, caller ledger, case files, Index refreshes.

## Capabilities and Constraints

- Instruments (docs/UI.md): Field (night), Cortex, Lab, Ledger, Integrity, Charter, plus Treasury, Connectome, Rewind and Reports as they gain data; legal pages on every footer.
- No free-text input from visitors; no wallet connection.
- No post or page calls out a person; integrity findings state data only.
- Mobile at 390 px must keep each instrument's dominant form.
- Stack: Next.js 16, React 19, React Three Fiber, zustand (docs/SYSTEM.md, docs/UI.md).

## Brand Commitments

- Name: Asimog. Neutral, functional names for parts (Feed Reader, Scout, Desk, Scorekeeper, Publisher); no creature naming.
- The agent's voice is terse: short, exact, no emojis, no em dashes, position disclosed (agent/skills/voice-terse).
- Owner's direction for the look: "futuristic, unique, never seen before, ethereal; not too wordy; it should amaze a person and capture interest first." The visual world is defined in docs/UI.md (Instrument, Night and Paper modes) and the four reference videos in docs/inspiration/.

## Evidence on Hand

Live data from core and the relay; the fixture tape (tests/e2e/fixtures/tapes); research in docs/research. There are no testimonials, customers, press or returns to show, and none may be invented. Results so far are honest and mostly losses on the base rate (buying after a crowd callout lost money: 54 of 61).

## Product Principles

1. Real or nothing: no motion, number or line without a source event.
2. Amaze first, prove underneath: spectacle in the first viewport, the evidence one click away.
3. Losses are content: the record shows every outcome with its denominator.
4. Data, never accusations: integrity is facts and limits, never verdicts on people.
5. Paper is labeled paper; simulation is labeled SIMULATED.

## Accessibility & Inclusion

Every scene change has a DOM mirror (tape, HUD, strip) with `aria-live="polite"`; instruments are keyboard-navigable; reduced motion removes camera drift and makes temperature changes instant; 44 px touch targets; zoom never disabled (docs/UI.md).
