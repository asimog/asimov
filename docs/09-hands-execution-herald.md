# 09 · Hands: Executor, Signer, Herald

Hands are the only parts that move money or speak in public. Each consumes one kind of input and writes Effects as events. Each is idempotent: a restart never double-buys or double-posts.

## Wallets

| Wallet | Holds | Used by |
|---|---|---|
| **W_trade** | War chest operating balance and all positions. It is also the Pump.fun account wallet: callouts require the posting wallet to hold the coin. | Executor, Herald (login) |
| **W_creator** | Creator of our coin. Receives creator fees. | Treasury sweep |
| **W_dist** | Hourly holder-pool payouts | Treasury distribution |
| **W_agent** | The agent's x402 wallet. Pays LLM, Jev, RPC and API costs and subscriptions. Filled from the non-trading half of each sweep up to a 30-day runway of measured spend. | Agents (pay-only, via x402) |
| **W_operator** | The human operator's wallet. Gets the rest of the non-trading half. Also pays fees for burns and refunds. | Owner |
| **Deposit addresses** | One per seat order, derived from a seed (`m/44'/501'/{index}'/0'`) | Treasury seats |

Only `signer` (the Wallet agent, docs/18) holds keys or the seed. Each endpoint below accepts exactly one capability token.

## Executor

Input: `order.created`. Output: `order.submitted`, `order.filled` or `order.failed`, `position.changed`.

1. Re-read the Board quote. If it is older than 3 s, fail with `stale_quote` (the Risk Gate checks too; this is the second check).
2. Build the transaction with `POST https://fun-block.pump.fun/agents/swap` (`encoding: base64`, `slippagePct` from the order). For graduated coins the API builds the AMM route. If the API is down, build with `@pump-fun/pump-sdk` `buyInstructions` / `sellInstructions` (or pump-swap-sdk) locally.
3. Ask `signer` to sign. The signer checks the instructions against its allowlist.
4. Send through our RPC with `encoding: base64`. Use a Jito bundle when front-running protection is on in limits.
5. Confirm at `confirmed`. Parse the actual tokens and SOL from the transaction, not from the quote.
6. Emit `order.filled` and `position.changed`. For buys whose genome has a call policy, the holding check for Herald runs now.

Idempotency key: `order_id` is stored in the transaction memo, and the Executor checks for an existing signature with that memo before any resend.

### Executor: ways it fails

1. The transaction lands but the confirm times out. Before retrying, search our recent signatures for the memo; never resend blindly.
2. Slippage exceeded on chain. `order.failed` with `retryable: true`; the genome decides again on fresh signals (no automatic retry of the same order).
3. fun-block API returns a stale or wrong route. Simulate the transaction first (`simulateTransaction`); refuse if simulated output deviates more than slippage from the quote.
4. Token-2022 vs SPL token program. Always read the mint owner on chain; never trust the API's `token_program`.
5. Priority fee spikes. The cost goes into the fill and into the genome's score; limits cap the priority fee per trade.

## Signer

A tiny HTTP service on the private network. No internet ingress. One endpoint per allowed action, with a strict check per endpoint.

| Endpoint | Signs only if |
|---|---|
| `/sign/swap` | Every instruction belongs to Pump, Pump AMM, Pump Fees, Compute Budget, Associated Token, System (fee transfers to known fee recipients), Token programs; signer = W_trade; SOL out ≤ order size + fees. |
| `/sign/collect-fees` | Built for our coin's mint; signer = W_creator; destination = W_creator. |
| `/sign/burn` | SPL burn of our coin from a deposit address, amount ≤ its balance. |
| `/sign/refund` | Transfer from a deposit address back to the sender recorded on the deposit, amount ≤ received. |
| `/sign/distribution` | SOL transfers from W_dist exactly matching a manifest whose sha256 the Treasury registered, total ≤ the hour's holder pool. |
| `/sign/sweep-split` | Transfer from W_creator: 50% to W_trade; the other 50% to W_agent up to its runway target, the rest to W_operator. |
| `/sign/x402` | A payment from W_agent to an allowlisted x402 payee (LLM, Jev, RPC providers), under a daily cap. |
| `/sign/login` | A message matching the pump.fun login pattern recorded in Phase 0 (domain, nonce format, expiry). Never a transaction. |

Everything else is refused and logged. The signer rate-limits each endpoint and keeps its own audit log.

## Herald

Input: `post.queued`. Output: `post.published` or `post.refused`.

### What it posts

| Trigger | Post |
|---|---|
| First live entry with a call policy, holding confirmed | **Callout** on the coin |
| Any later entry or exit, stop, or thesis change | **Update** on that callout |
| Combined position closed | Final **update** with the result |
| Hunt finding ≥ 0.85 confidence with 3 or more evidence events | One **reply** (ink note) under the relevant callout. Never a callout. |

### Eligibility checks before posting

1. Holding ≥ the platform's threshold (Phase 0 records the value). If not, wait for confirmation up to 60 s, then refuse with `holding_below_threshold`.
2. No active callout of ours on this coin (else this is an update).
3. Callout cooldown and update cooldown windows. Updates that land inside one cooldown window are merged into one update.
4. Text passes the Jev `guard` pack (outbound thresholds) and our code checks: no person named as a scammer, no promises of returns, position disclosed, no emojis or em dashes.

### How it posts

T8 is the Voice tentacle: a real pump.fun session logged in as W_trade.

- Login: an init script (`agent-browser addinitscript`) adds a minimal Wallet Standard provider named "OCTOPUS". `connect` returns W_trade's public key. `signMessage` forwards the message to `signer /sign/login`. `signTransaction` always rejects.
- Posting: T8 opens the coin page or callout thread, types the text, attaches the card image, and submits. Visitors watch it happen on the T8 plate.
- If Phase 0 finds a clean posting endpoint, Herald may call it directly with T8's session token, and T8 still navigates to the published post so it shows on the site.

### Media cards

Each callout and final update gets an original image: the call card rendered by the web app at `/cards/{post_id}` with `next/og` (an image response, no browser needed). It shows ticker, entry mcap, opportunity age, the key signals and the exit ladder. Media must be ours (`create_media_not_owned` rule).

### The voice: caveman

The octopus speaks in the caveman style (`agent/skills/octopus-voice-caveman`): answer first, short words, every number exact, no hype words, no emojis.

| Post | Example |
|---|---|
| Callout | `Bought 0.4 SOL at 41k mc. Coin 11 min old, +9% since first call. 3 clean callers, no echo. Wave odds 0.64 in 2h. Ladder: 25% at 2x, 25% at 3x, rest on crowd. AI caller.` |
| Update (exit) | `Sold 25% at 2.1x. Hold 75%. Callers still coming: 5 of 6 expected.` |
| Update (stop) | `Out. Flow flipped, early wallets selling. -18% on this one.` |
| Final | `Closed. 2.6x on 0.4 SOL. Thesis held. Ladder done.` |
| Ink note (reply) | `Data: this call came +180% after first call. 4 of 6 earlier calls trace to one origin.` |

Templates come first. The Jev `route` pack picks the template and its closed-set arguments (function-calling pattern). The cheap LLM (`LLM_MODEL_CHEAP`) writes only the short thesis line, under a 60-token cap, and the result must pass the checks above.

### Herald: ways it fails

1. Session expired. Re-login once via the signer; retry once; else `post.refused: session`.
2. Moderation refuses the post. Keep it on our own ledger and site; do not retry the same text.
3. Cooldown blocks an exit update. Merge into the next allowed update; the ledger shows the exact times.
4. The page layout changes and the type-and-submit flow breaks. Detect by no published post within 30 s; alert; keep the post queued for 10 min, then mark refused.
5. A thesis line from the LLM breaks a text rule. Fall back to the template without a thesis line.
