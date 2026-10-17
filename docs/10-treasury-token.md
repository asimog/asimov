# 10 · Treasury and token

All accounting is off-chain, in Postgres, published hourly with proofs. No smart contracts. No wallet connection anywhere. The rules below are the owner's product rules; this doc makes them exact.

## Money flows

```
creator fees ──(every 10 min)──► W_creator ──► 50% W_trade (war chest, base capital)
                                            └─► 50% ops: W_agent (x402, up to 30-day runway) then W_operator
W_trade trades ──► realized PnL ──(every hour)──► distributable profit (above high-water mark)
                                                   ├─► 50 points: stays in W_trade (the octopus)
                                                   └─► 50 points: W_dist ──► 1 point per seat, the rest to the top 50
```

Before the coin exists, W_trade is funded by the owner and nothing is distributed.

## Fee sweep (every 10 minutes)

1. `POST https://fun-block.pump.fun/agents/collect-fees` with our mint and W_creator (`encoding: base64`). The API detects graduation and sharing config.
2. Wallet agent `/sign/collect-fees`, send, confirm.
3. Measure SOL actually received (balance diff on the confirmed transaction).
4. `/sign/sweep-split`: half to W_trade; the other half to W_agent until it holds 30 days of measured LLM, Jev, RPC and API spend, and the rest to W_operator.
5. Emit `fees.swept`. The amount sent to W_trade is added to **base capital**.

Base capital is never profit and is never distributed.

## Profit (every hour, on the hour UTC)

- **Realized PnL** for the hour = realized gains and losses on sells (FIFO cost basis per genome sub-ledger), minus all fees, priority fees and tips paid in the hour. Unrealized gains do not count. Fee inflows do not count.
- **Cumulative PnL** = running sum of hourly realized PnL since launch.
- **High-water mark (HWM)** = the highest cumulative PnL at which we have paid out.
- **Distributable** = max(0, cumulative PnL − HWM). After paying, HWM = cumulative PnL.

A losing hour pays nothing, and losses must be earned back before the next payout.

## Profit split (points of distributable profit)

| Share | Points |
|---|---|
| The octopus (stays in W_trade, compounds) | 50 |
| Each active seat | 1 |
| Top 50 holders, pro rata | 50 − seats |

So with one seat: octopus 50%, top 50 holders 49%, the seat owner 1%. Each new seat takes its point from the top-50 share only. A seat owner who is also a top-50 holder gets both.

Example: distributable 10 SOL, 3 seats. Octopus keeps 5 SOL. Each seat gets 0.1 SOL. The top 50 share 4.7 SOL.

### Who counts as a top-50 holder

1. Four snapshots per hour at random minutes (seeded RNG; the seed is published after the hour).
2. **Excluded owners:** the bonding curve, all AMM pool vaults and LP accounts, any program-owned account, our own wallets, deposit addresses, the burn address.
3. **Clusters:** owners are grouped before ranking. Wallets count as one holder when they were funded by the same source wallet within 24 h, or moved our token between each other in the last 7 days. This stops one whale from splitting into 50 wallets to take every slot. The cluster map is in the hourly proof.
4. **Counted balance = the minimum across the four snapshots**, summed per cluster. Missing from one snapshot means 0.
5. The top 50 clusters by counted balance are paid pro rata to it. Inside a cluster, payout goes to its largest wallet.

Buying just before a snapshot does nothing; holding the whole hour does.

### Payouts

- Amounts below 0.001 SOL accrue in `money.accruals`. A recipient wallet with 0 SOL also needs the rent-exempt minimum (about 0.00089 SOL) before its first payout; until then it accrues.
- The Treasurer writes a manifest (recipient, SOL, reason), hashes it, registers the hash with the Wallet agent, moves the holder pool from W_trade to W_dist, then sends batched transfers from W_dist (about 20 per transaction).
- Payout runs only after the hour's holder snapshots and fills are `finalized`.

## Seats

Designed for scarcity, visible jumps and races.

| Rule | Value |
|---|---|
| Cap | **21 seats** |
| Floor price of seat n | 1,000,000 × 1.15^(n−1) tokens |
| Live price | floor × (1 + 0.5 · e^(−h/12)), where h = hours since the last seat sold |
| Seat 1 / 7 / 14 / 21 floors | 1.00M / 2.31M / 6.15M / 16.37M tokens |
| Premium after a sale | +50% now, +39% after 3 h, +18% after 12 h, +7% after 24 h, about 0 after 48 h |
| All 21 seats | about 118.8M tokens burned (11.9% of supply) |
| Entitlement | 1 point of distributable profit per hour, forever |
| Payment | Our coin, sent to a unique deposit address |
| Tokens received | Burned on grant |
| Quote lock | 15 minutes |

Why this drives FOMO:

- Every sale is a public moment: the price jumps 50% and the site shows "Seat 8 taken. Seat 9 now 4.6M."
- The premium fades on a visible curve, so people watch for the dip and race each other to it.
- Only 21 exist, and the count is always on screen.
- `/seats` shows each seat's lifetime SOL earned, live, so a seat's value is proven by numbers, not promises.
- Every seat burns supply, and the burn total is on the treasury page.

### Buying a seat (no wallet connection)

1. On `/seats` the visitor types a **payout wallet** (base58, checked on curve). Nothing else.
2. The server creates a deposit order: reserves the lowest free seat number, quotes its live price, derives a fresh deposit address (`m/44'/501'/{index}'/0'`), and sets a 15-minute expiry. Max 3 open reservations at a time; the cap counts granted plus reserved.
3. The page shows the deposit address (copy button and QR), the exact amount, the seat number and a countdown.
4. The visitor sends tokens from any wallet they control.
5. Chain Ear sees the deposit:
   - received ≥ quote before expiry → **grant**: burn the quoted amount, refund any excess to the sender, emit `seat.granted`, reset the premium clock.
   - received < quote → wait until expiry for top-ups, then refund everything to the sender(s).
   - deposit after expiry → refund.
6. If a reservation expires, its number goes back to the pool and the next order takes the lowest free number.

W_operator is the fee payer for burns and refunds, so deposit addresses never need SOL.

### Changing a seat's payout wallet

The current payout wallet sends a tiny SOL transfer (refunded) to the seat's control address (its original deposit address) with memo `seat:<n>:<new_wallet>`. Chain Ear checks that the transaction's signer is the current payout wallet, then updates the seat. No wallet connection needed.

## Proofs

Every hour the Treasurer publishes one JSON segment: fee sweeps and splits, fills, realized PnL, HWM, holder snapshots with the RNG seed, the cluster map, the manifest, payout signatures, seat changes and burns. Each segment includes the sha256 of the previous segment (chainplot's hash-join pattern). `/treasury` shows the chain and lets anyone download any segment.

## Treasury: ways it fails

1. Fee collect fails or returns 0. Retry next sweep; emit `fees.swept` with 0; never estimate.
2. A snapshot fails (RPC limit). Retry within the same minute window; a missing sample marks the hour `degraded` in the proof and it pays on the samples taken.
3. W_dist has less SOL than the manifest. The move from W_trade to W_dist happens before signing, and the Wallet agent checks totals.
4. A payout transaction partly lands. Batches are idempotent by manifest hash and batch index; resend only missing batches after checking signatures.
5. Two deposits race for the last seat. Reservations make this impossible.
6. Wrong token or SOL sent to a deposit address. Refund to the sender, minus network fee, and log it.
7. Sent from an exchange. Refunds go to the sender address as the rules say; the page warns "send from a wallet you control".
8. Profit math bug. Hourly numbers are recomputed from fills by an independent query before payout; a mismatch blocks the payout and alerts.
9. Clustering wrongly merges two real holders. The rules are published; the cluster map is in every proof; the owner can add an override with the admin token, which is logged.
10. A whale sybils with wallets funded from different sources. Clustering will not catch all of it; the proof shows balances, so the community can flag it, and new rules apply from the next hour.
