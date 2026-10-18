# 09 · Hands: Trader (Executor), Signer, Publisher

Hands are the only parts that move money or speak in public. Each consumes one kind of input and writes Effects as events. Each is idempotent: a restart never double-buys or double-posts.

## Wallets

| Wallet | Holds | Used by |
|---|---|---|
| **W_trade** | Trading capital (starts at 0.2 SOL) and all positions. It is also the Pump.fun account wallet: callouts require the posting wallet to hold the coin. | Trader, Publisher (login) |
| **W_creator** | Creator wallet of the given coin. Receives creator fees. | Treasury sweep |
| **W_agent** | Running costs: LLM, Jev, RPC, hosting, subscriptions, bounties, the hourly proof memo. Filled from the non-trading half of each sweep up to a 30-day runway of measured spend. | Treasurer, bounty adapter |
| **W_operator** | The human operator's wallet. Gets the rest of the non-trading half. | Owner |
| **Deposit addresses** | One per seat order, derived from a seed (`m/44'/501'/{index}'/0'`) | Treasury seats |

Only `signer` (the Signer, docs/18) holds keys or the seed. Each endpoint below accepts exactly one capability token.

## Executor

Input: `order.created`. Output: `order.submitted`, `order.filled` or `order.failed`, `position.changed`.

1. Re-read the Board quote. If it is older than 3 s, fail with `stale_quote` (the Risk Gate checks too; this is the second check).
2. Build the transaction with `POST https://fun-block.pump.fun/agents/swap` (`encoding: base64`, `slippagePct` from the order). For graduated coins the API builds the AMM route. If the API is down, build with `@pump-fun/pump-sdk` `buyInstructions` / `sellInstructions` (or pump-swap-sdk) locally.
3. Ask `signer` to sign. The signer checks the instructions against its allowlist.
4. Send through our RPC with `encoding: base64`. Use a Jito bundle when front-running protection is on in limits.
5. Confirm at `confirmed`. Parse the actual tokens and SOL from the transaction, not from the quote.
6. Emit `order.filled` and `position.changed`. For buys whose strategy has a call policy, the holding check for Publisher runs now.
7. After a full exit, close the now-empty token account through `/sign/close-account` so the rent (about 0.0015 SOL) returns to W_trade.

Idempotency key: `order_id` is stored in the transaction memo, and the Executor checks for an existing signature with that memo before any resend.

**Built (S6.2), `hands/trader.ts`.** Input is `order.created` from the live gate (`hands/order-gate.ts`): it turns a filled paper intent (`intent.ghost_filled`) of a strategy listed in `LIVE_STRATEGIES` (empty by default) into an order, only when `ASIMOG_MODE=live`, after the Risk Gate and the kill state say yes. The Trader runs in its own loop, re-clamps size and slippage to the owner limits, commits `submitted` with the signature before it waits for the confirm, and never rebuilds an order that has a signature. Its retry pass (`TRADER_RETRY_EVERY_MS`) confirms submitted orders, retries failed sells with backoff, and closes token accounts left `close_pending`. A full exit sells the on-chain balance. An event it cannot process goes to `hands.dead_letters`. Nothing else writes `order.created`. The Trader reads the chain through a `Chain` interface (simulate, send, confirm and parse, find by memo, balance) with one real implementation on the single endpoint `TX_SEND_URL` (the Gatekeeper or the FluxRPC Shield URL; `RpcPool` is never used to send and refuses `send*`). The route builder is the fun-block API (`FUN_BLOCK_URL`), with an adapter interface so tests use a fake. The Trader appends the order memo instruction, asks the Signer, simulates the signed transaction (`simulateTransaction`, `sigVerify: false`, base64), refuses if the simulated SOL change differs from the quote by more than the slippage, sends, confirms at `confirmed`, parses the real SOL and token change from the transaction metadata, and emits `order.filled`, `ledger.entry`, `position.changed`. After a full exit it builds a close-account transaction and emits another `ledger.entry` for the rent. Restart: before any send it looks in `hands.orders` and then searches recent signatures for the exact memo (`asimog:<order>`, or `asimog:<order>:r<n>` for retry n).

### Executor: ways it fails

1. The transaction lands but the confirm times out. Before retrying, search our recent signatures for the memo; never resend blindly.
2. Slippage exceeded on chain. `order.failed` with `retryable: true`; the strategy decides again on fresh signals (no automatic retry of the same order).
3. fun-block API returns a stale or wrong route. Simulate the transaction first (`simulateTransaction`); refuse if simulated output deviates more than slippage from the quote.
4. Token-2022 vs SPL token program. Always read the mint owner on chain; never trust the API's `token_program`.
5. Priority fee spikes. The cost goes into the fill and into the strategy's score; limits cap the priority fee per trade.

## Signer

A tiny HTTP service on the private network. No internet ingress. One endpoint per allowed action, with a strict check per endpoint.

| Endpoint | Signs only if |
|---|---|
| `/sign/swap` | Every instruction belongs to Pump, Pump AMM, Pump Fees, Compute Budget, Associated Token, System (fee transfers to known fee recipients), Token programs; signer = W_trade; SOL out ≤ order size + fees. |
| `/sign/collect-fees` | Built for our coin's mint; signer = W_creator; destination = W_creator. |
| `/sign/close-account` | Close an empty token account owned by W_trade; rent returns to W_trade. |
| `/sign/bounty` | SOL transfer from W_agent to a bounty winner recorded in a published bounty result, under the bounty's budget. |
| `/sign/memo` | An on-chain memo from W_agent carrying the latest proof hash. |
| `/sign/sweep-split` | Transfer from W_creator: 50% to W_trade; the other 50% to W_agent up to its runway target, the rest to W_operator. |
| `/sign/x402` | A payment from W_agent to an allowlisted x402 payee (LLM, Jev, RPC providers), under a daily cap. |

Payout and seat endpoints (burn, refund, distribution) are added at milestone M5 (docs/10).
| `/sign/login` | A message matching the pump.fun login pattern recorded in Phase 0 (domain, nonce format, expiry). Never a transaction. |

Everything else is refused and logged. The signer rate-limits each endpoint and keeps its own audit log.

**Built (S6.1), `services/signer`.** Details the table above leaves open:

- **Keys.** Only the Signer process reads `SIGNER_KEYPAIR_TRADE`, `SIGNER_KEYPAIR_CREATOR`, `SIGNER_KEYPAIR_AGENT` (each a path to a keypair JSON file the owner puts on the signer host). Public keys come from the files; `WALLET_OPERATOR` (public) is read by the Signer and the Treasurer. A missing key disables its endpoints; the Signer never prints a key.
- **Tokens.** `SIGNER_TOKENS=cap:sign.swap=<secret>,cap:sign.treasury=<secret>,cap:sign.login=<secret>`. `cap:sign.swap` opens `/sign/swap` and `/sign/close-account`; `cap:sign.treasury` opens `/sign/collect-fees`, `/sign/sweep-split` and `/sign/memo`; `cap:sign.login` opens `/sign/login`. Compared in constant time. Wrong token: 401 and an audit line.
- **No public route.** The Signer binds `SIGNER_HOST` (default `127.0.0.1`) and refuses to start on a public address. `/sign/bounty`, `/sign/x402` and `/sign/login` answer `endpoint_not_enabled` until S8 and S9.
- **Request.** `{tx: base64 transaction (unsigned), ctx}`. The Signer reads the transaction itself; `ctx` only supplies caps (`max_lamports`, `order_id`, `total_lamports`, `agent_room_lamports`) and the Signer also holds its own caps (`SIGNER_MAX_ORDER_SOL`, default 0.05, `SIGNER_MAX_PRIORITY_LAMPORTS`). The reply is the signed transaction and its signature. Nothing is sent by the Signer.
- **Swap checks.** Fee payer and the only required signer is W_trade. Allowed programs: Pump, Pump AMM, Pump Fees, Compute Budget, Associated Token, System, Token, Token-2022, Memo. Pump and AMM instructions must be on a named list (buy, sell and their v2/v3 and exact-in variants, `extend_account`, volume accumulator init and sync); the SOL a buy may spend is read from the instruction data and must be at most `max_lamports`. System: Transfer only, from W_trade, to W_trade or a fee recipient in `SIGNER_FEE_RECIPIENTS`, total within `max_lamports`. Token: CloseAccount (destination and owner W_trade), SyncNative, InitializeAccount3. ATA create only for W_trade. Compute-unit price times limit at most `SIGNER_MAX_PRIORITY_LAMPORTS`. Memo must start with `asimog:`. Anything else: refused with a reason code.
- **Kill.** If the file `artifacts/KILL` exists (written by `ctl kill`), a `/sign/swap` that contains a buy instruction is refused with `kill_switch` even if the core is compromised; sells still sign, so open positions can exit. Treasury and close-account stay open.
- **Audit log.** `artifacts/signer-audit.jsonl`, append-only, one line per request (accepted or refused): time, endpoint, capability name, outcome, reason, transaction sha256, signature, and the hash of the previous line. Tokens and keys are never written.
- **Rate limit.** `SIGNER_RATE_PER_MIN` per endpoint (default 30).
- **Auto kill input.** The core counts `signer_refused` replies; three in 10 minutes trips the kill switch (docs/15).

## Thesis

Every callout we make starts as a thesis: the claim, why we believe it, what would prove it wrong, and the plan. It is formed in code from the Board and the strategy's spec at the moment of our (ghost or live) fill. No LLM writes it.

| Part | Holds |
|---|---|
| `kind` | `pre_call` (formed on a known caller's buy, before any callout from them) or `post_call` |
| `claims[]` | One line each, labelled with its evidence class (docs/03): `observed` (flow numbers, curve), `computed` (signal values as named buckets, docs/17), `ai_judgment` (Jev answers, with model) |
| `prediction` | P(a callout on the coin within the horizon) for `pre_call`, or the strategy's win chance for `post_call`, with the horizon |
| `plan` | Entry price and size, the exit ladder (bands, not exact levels), the stop, the hold limit |
| `invalidation[]` | What ends the thesis early: the stop, the hold limit, no callout within the horizon (pre-call) |

The thesis is committed (`commit.made`, kind `hypothesis`, `reveal_after` = the hold limit) before the callout is queued, and revealed when the house position closes. `thesis.formed` carries the content and the commit id.

## Publisher

Input: house positions (ghost fills and closes on the paper desk; `order.filled` live). Output: `thesis.formed`, `post.queued`, and live only `post.published` or `post.refused`.

**Paper mode (built, S6.0).** On paper the Publisher (`hands/publisher.ts`) writes `post.queued` with `paper: true` and never posts. The first fill of a calling strategy (`call.policy` not `silent`) on a coin with no open house callout becomes the **house position** and its callout. Exits of the house position become updates; its close becomes the final update and reveals the thesis. Fills of other strategies on that coin stay on their own ghost books and are not posted (one coin, one callout). Every paper text starts with `PAPER.` The Scorekeeper scores house callouts as the caller `house` (docs/07). A text that fails a check is not queued; `system.note` (kind `post_refused`) records the rule.

**Live mode (S6.3).** `post.queued` without `paper` is what S8 posts, with the eligibility checks below.

### What it posts

| Trigger | Post |
|---|---|
| First live entry with a call policy, holding confirmed | **Callout** on the coin |
| Any later entry or exit, stop, or thesis change | **Update** on that callout |
| Combined position closed | Final **update** with the result |
| Integrity finding ≥ 0.85 confidence with 3 or more evidence events | One **reply** (data reply) under the relevant callout. Never a callout. |

### Eligibility checks before posting

1. Holding ≥ the platform's threshold (Phase 0 records the value). If not, wait for confirmation up to 60 s, then refuse with `holding_below_threshold`.
2. No active callout of ours on this coin (else this is an update).
3. Callout cooldown and update cooldown windows. Updates that land inside one cooldown window are merged into one update.
4. Text passes the Jev `guard` pack (outbound thresholds) and our code checks (`hands/text-checks.ts`, run on paper too): position disclosed (`Bought <size> SOL` on a callout), no emojis, no em or en dashes, no promise words, no handles or wallet addresses (never call out a person), at most 280 characters, and `PAPER.` first in paper mode. A failed check refuses the post with `text_check:<rule>`.

### How it posts

S8 is the Voice session: a real pump.fun session logged in as W_trade.

- Login: an init script (`agent-browser addinitscript`) adds a minimal Wallet Standard provider named "Asimog". `connect` returns W_trade's public key. `signMessage` forwards the message to `signer /sign/login`. `signTransaction` always rejects.
- Posting: S8 opens the coin page or callout thread, types the text, attaches the card image, and submits. Visitors watch it happen on the S8 plate.
- If Phase 0 finds a clean posting endpoint, Publisher may call it directly with S8's session token, and S8 still navigates to the published post so it shows on the site.

### Media cards

Each callout and final update gets an original image: the call card rendered by the web app at `/cards/{post_id}` with `next/og` (an image response, no browser needed). It shows ticker, entry mcap, opportunity age, the key signals and the exit ladder. Media must be ours (`create_media_not_owned` rule).

### The voice: terse

The agent speaks in the terse style (`agent/skills/voice-terse`): answer first, short words, every number exact, no hype words, no emojis.

| Post | Example |
|---|---|
| Callout | `Bought 0.02 SOL at 41k mc. Coin 11 min old, +9% since first call. 3 clean callers, no echo. Wave odds 0.64 in 2h. Ladder: 25% at 2x, 25% at 3x, rest on crowd. AI caller.` |
| Update (exit) | `Sold 25% at 2.1x. Hold 75%. Callers still coming: 5 of 6 expected.` |
| Update (stop) | `Out. Flow flipped, early wallets selling. -18% on this one.` |
| Final | `Closed. 2.6x on 0.02 SOL. Thesis held. Ladder done.` |
| Data reply (reply) | `Data: this call came +180% after first call. 4 of 6 earlier calls trace to one origin.` |

Templates come first. The Jev `route` pack picks the template and its closed-set arguments (function-calling pattern). The cheap LLM (`LLM_MODEL_CHEAP`) writes only the short thesis line, under a 60-token cap, and the result must pass the checks above.

### Publisher: ways it fails

1. Session expired. Re-login once via the signer; retry once; else `post.refused: session`.
2. Moderation refuses the post. Keep it on our own ledger and site; do not retry the same text.
3. Cooldown blocks an exit update. Merge into the next allowed update; the ledger shows the exact times.
4. The page layout changes and the type-and-submit flow breaks. Detect by no published post within 30 s; alert; keep the post queued for 10 min, then mark refused.
5. A thesis line from the LLM breaks a text rule. Fall back to the template without a thesis line.
