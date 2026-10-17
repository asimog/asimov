# 10 · Treasury and books

Now: the fee sweep, the books and the proofs. Holder payouts and seats come at milestone M5 and are only outlined here.

## Wallets (docs/09)

| Wallet | Holds |
|---|---|
| W_trade | Trading capital. Starts at 0.2 SOL. Also the Pump.fun account for callouts. |
| W_creator | The given coin's creator wallet; receives creator fees |
| W_agent | Running costs: LLM, Jev, RPC, hosting, bounties (x402 where supported) |
| W_operator | The human operator's share |

Every wallet is listed publicly on `/charter` (disclosure registry). No other wallets exist.

## Fee sweep (every 10 minutes)

1. Build the collect transaction with `POST https://fun-block.pump.fun/agents/collect-fees` (mint, W_creator, `encoding: base64`).
2. Sign with the Signer (`/sign/collect-fees`), send, confirm.
3. Measure the SOL actually received from the confirmed transaction.
4. Split: 50% to W_trade; 50% to W_agent until it holds 30 days of measured running costs, the rest to W_operator.
5. Emit `fees.swept`. The amount sent to W_trade is **base capital**: it is never counted as profit.

If a sweep collects nothing, it records 0 and waits for the next one. No estimates.

## Books

| Piece | Rule |
|---|---|
| Ledger | Double-entry, built as a projection of Tape events (fills, sweeps, transfers, fees, rent paid and refunded). Rebuildable from the Tape at any time. |
| Reconciliation | Every hour, ledger balances per wallet must equal on-chain balances to the lamport. A mismatch emits `books.reconciled` with `ok: false`, pauses the Trader and alerts the owner. |
| NAV | Daily and on demand: SOL balances plus open positions marked at the curve or pool price. |
| Realized PnL | FIFO cost basis per strategy, net of every fee, tip and unrecovered rent. |
| Markouts | 1 s, 10 s, 60 s, 5 min after each fill (`markout.measured`). |
| Costs | Every model, Jev, RPC and hosting charge, attributed to the job that caused it. |

## Proofs

Every hour the Treasurer publishes one JSON segment: sweeps, fills, transfers, balances, the reconciliation result, and the commit hashes made that hour. Each segment includes the sha256 of the previous one. An hourly on-chain memo from W_agent carries the latest segment hash. `/treasury` shows the chain; anyone can download and check any segment.

## Later (milestone M5): payouts and seats

Rules already agreed, to be specified in full when M5 approaches:

- Profit split per hour of realized profit above a high-water mark: 50% stays in the firm, 49% to the top 50 holders, 1% per seat owner (each seat takes its point from the top-50 share).
- Holder ranking: minimum balance across random snapshots, with curve and pool accounts excluded and related wallets clustered.
- Seats: a limited number, bought with tokens sent to a per-order deposit address (no wallet connection), burned on receipt, perpetual.

## Ways it fails

1. Collect transaction fails or returns 0: record 0, retry next sweep.
2. RPC rate limit on reconciliation: retry within the hour; if still failing, mark the hour `degraded` and pause new orders.
3. A transfer partly lands: transfers are idempotent by sweep id; resend only what is missing after checking signatures.
4. Rent not refunded because an account was left open: the Trader closes empty token accounts after each full exit; the hourly check lists any open empty accounts and closes them.
5. Ledger bug: the ledger is rebuilt from the Tape and compared with chain balances every hour; the comparison, not the code, is trusted.
