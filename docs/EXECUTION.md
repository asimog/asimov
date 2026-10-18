# Execution

The hands: wallets, the Trader, the Signer, the Publisher, theses, and the books. Hands are the only parts that move money or speak in public. Each consumes one kind of input, writes effects as events, and is idempotent: a restart never double-buys or double-posts. Target design; gaps are rows in `PLAN.md`.

Live trading is the last step. Everything here is built and tested on paper and on a mocked chain first. The first real trade is one `live-*` test at 0.01 SOL, after the paper side is complete, fix 1.16 is done and `live-roundtrip` passes on a mock chain.

## 1. Wallets

| Wallet | Holds | Used by |
|---|---|---|
| W_trade | Trading capital (starts at 0.2 SOL) and all positions; also the Pump.fun account | Trader, Publisher login |
| W_creator | Creator wallet of our coin; receives creator fees | Treasurer sweep |
| W_agent | Running costs (models, Jev, RPC, hosting), filled to a 30-day runway | Treasurer |
| W_operator | The human operator's share | Owner |

Only the Signer holds keys. Every wallet is in the public disclosure registry.

## 2. Trader

Input: `order.created` from the live gate. Output: `order.submitted`, `order.filled` or `order.failed`, `ledger.entry`, `position.changed`.

1. Re-read limits; clamp size and slippage.
2. Build the swap with the fun-block API (an adapter, so tests use a fake), append the memo `asimog:<order>`.
3. Ask the Signer to sign; simulate the signed transaction; refuse if the simulated SOL change differs from the quote by more than the slippage.
4. Commit `submitted` with the signature, then send through the one send endpoint `TX_SEND_URL` (never the RPC pool).
5. Confirm at `confirmed`; parse real SOL and tokens from the transaction.
6. A full exit sells the on-chain balance, then closes the token account so rent returns; a failed close stays `close_pending` for the retry pass.
7. The retry pass confirms submitted orders, retries failed sells with backoff, and gives up after `TRADER_GIVE_UP_MS`.
8. An event it cannot process goes to `hands.dead_letters`. The Trader and the kill consumer run in their own loops.

Ways it fails: confirm times out (look up the stored signature, never rebuild); slippage on chain (`order.failed`, the strategy decides again); stale route (simulation refuses); Token-2022 (read the mint owner on chain); priority fee spikes (capped by limits, counted in the fill).

## 3. Signer

A tiny HTTP service bound to a private address. It refuses to start on a public address or a taken port. One endpoint per allowed action, one capability token each, compared in constant time.

| Endpoint | Token | Signs only if |
|---|---|---|
| `/sign/swap` | `cap:sign.swap` | Fee payer and only signer is W_trade; programs on the allowlist (Pump, Pump AMM, Pump Fees, Compute Budget, Associated Token, System, Token, Token-2022, Memo); pump and AMM instructions on a named list with the base and quote token accounts pinned; buy SOL at most the order cap and `SIGNER_MAX_ORDER_SOL`; sell size bounded; memo starts with `asimog:` |
| `/sign/close-account` | `cap:sign.swap` | Closes an empty W_trade token account, rent to W_trade |
| `/sign/collect-fees`, `/sign/sweep-split`, `/sign/memo` | `cap:sign.treasury` | Our coin, W_creator, the split rule, the proof memo |
| `/sign/login` | `cap:sign.login` | A message matching the pump.fun login pattern; never a transaction |

The Signer reads the kill file on every request: no file means running, `exit_only` refuses buys, anything else refuses everything. Its audit log is append-only and hash-chained, mirrored to the Tape. Three refusals in 10 minutes move the kill state to `exit_only`. It authenticates before rate-limiting and `/health` returns only `{ok: true}`.

## 4. Thesis

Every house callout starts as a thesis formed in code at our fill: claims labelled by evidence class, a prediction with its horizon, the plan (entry, size, exit bands, stop, hold limit) and what invalidates it. It is committed (`commit.made`) before the callout is queued and revealed when the house position closes. No LLM writes it.

## 5. Publisher

We speak only under coins we hold. Pump.fun allows replies only from holders, and we never buy bad launches, so we never comment under them.

| Trigger | Post |
|---|---|
| First live entry with a call policy, holding confirmed | Callout, position disclosed |
| Later entries, exits, stops, thesis changes | Updates on that callout, merged inside the cooldown |
| A held coin worth a word | One bull post reply under our own held coin |
| Combined position closed | Final update with the result |

Every text passes one public-text check in core (the Jev `guard` pack when available, plus code rules): position disclosed on a callout, no emojis, no dashes, no promise words, no handles or wallet addresses, at most 280 characters, `PAPER.` first on paper. A failed check refuses the post and records the rule. On paper, `post.queued` carries `paper: true` and nothing is posted. The voice follows `agent/skills/voice-terse`: answer first, exact numbers, no hype.

Risk evidence about coins we do not hold goes to the public rug feed room on the site, never into replies.

Ways it fails: session expired (re-login once, retry once); moderation refuses (keep it on our ledger); cooldown blocks an update (merge into the next window); layout change (alert, keep queued 10 min, then refuse); a model thesis line breaks a rule (fall back to the template).

## 6. Books

| Piece | Rule |
|---|---|
| Ledger | Double entry, a projection of `ledger.entry` events; every transaction's legs sum to zero; rebuildable from the Tape |
| Reconciliation | Every hour each wallet's ledger balance equals the chain to the lamport; a mismatch moves the kill state to `exit_only` |
| Realized PnL | FIFO per strategy and day, net of every fee, tip and unrecovered rent |
| NAV | SOL balances plus open lots marked at the Board price |
| Fee sweep | Every 10 minutes: collect creator fees, then 50% to W_trade (base capital, never profit), 50% to W_agent up to its runway, the rest to W_operator; idempotent by sweep id |
| Proofs | One JSON segment per hour chained by the previous hash, an on-chain memo from W_agent; anyone can check it |
| Deposits | `ctl books deposit <wallet> <lamports> <sig>` |

Ways it fails: a sweep collects 0 (record 0, wait); a transfer half-lands (resume only what is missing); a ledger bug (the hourly chain comparison is trusted, not the code).
