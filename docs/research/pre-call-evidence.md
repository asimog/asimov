# Pre-call evidence: callers buy before they call

Measured 2026-10-17 on the fixture tape `discovery-10m` (replay database `asimog_e2e_main_mvc6kt4p`) and a 15 s live probe of the NATS trade firehose. Queries are in this file so anyone can rerun them.

## 1. A callout is announced by its author's own buy

Pump.fun requires the posting wallet to hold the coin. The fixture confirms it: **356 of 381 callouts (93%)** carry `author_position.amount_held > 0` at call time.

So the author buys first, then posts. When the coin is already watched, the buy is on the Tape before the callout:

| Measure | Value |
|---|---|
| Callouts with any trade on the coin seen before the callout | 93 |
| ... where the author's own buy is on the Tape before the callout | 57 (61%) |
| ... with a price after that buy (usable) | 54 |
| Lag from the author's first buy to the callout (p10, p25, p50, p75, p90) | 13 s, 21 s, 57 s, 110 s, 170 s |
| Price at the callout / price at the author's buy (median, mean) | 1.025, 1.054 |
| Price 1 min after the callout / price at the author's buy (median) | 1.03 |
| Price 3 min after the callout / price at the author's buy (median) | 0.79 |
| Peak within 3 min after the callout / price at the author's buy (median) | 1.30 |
| Callouts whose 3-minute peak is more than 5% above the author's buy price | 36 of 54 (67%) |

Reading: the callout itself is the pump, and it fades within minutes (the base rate in docs/PIPELINE.md: 54 of 61 fully measured callouts lost money at 5 min after costs). Buying **after** the callout buys the top of the pump. Buying **at the author's buy**, a median 57 s earlier, buys before it, and selling into the callout spike is the trade.

Limits, stated plainly:

- 54 callouts on one 10-minute tape. Small sample, one time of day.
- Selection: these coins were already watched because of an earlier callout, so most are second or later callouts on a coin. First callouts on unwatched coins are not in the sample. The Scout (docs/PIPELINE.md) removes this bias by watching every caller's buys on every coin.
- The peak is a ceiling, not a payout (docs/PIPELINE.md). Strategies are judged on net results through the fill model, never on peaks.
- The author must be a caller we already know (a wallet with a past callout in `mem.callers`). On a 10-minute tape most callers are new; with the Feed Reader's 48 h backfill live, the known set is large.

```sql
with c as (select callout_id, mint, wallet, seen_at from mem.callouts),
t as (select subject mint, body->>'wallet' w, body->>'side' side, seen_time, (body->>'price_sol')::float p
      from tape.events where topic in ('trade.curve','trade.amm') and (body->>'price_sol')::float > 0),
ab as (select c.callout_id, c.mint, c.seen_at, min(t.seen_time) buy_at from c
       join t on t.mint = c.mint and t.w = c.wallet and t.side = 'buy' and t.seen_time < c.seen_at group by 1, 2, 3)
select count(*), percentile_cont(0.5) within group (order by extract(epoch from seen_at - buy_at)) lag_s from ab;
```

### The reverse direction is weak

"Most callouts are preceded by the author's buy" does not mean "most buys by callers are followed by a callout". On the fixture, known callers (a callout seen earlier on the tape) bought coins they had not called **34 times on 9 coins (22 wallets)**, and only **2** of those buys were followed by the same wallet's callout within 5 minutes (6%). Callers also trade.

So `precall.callout_p` starts at the population rate (about 0.06 on this tape) and rises only for a caller whose own record shows buy-then-call. The `pre_call` seeds enter only when the score clears the cost floor, so on this tape they stay out. That is the intended behaviour: the edge must come from the callers who do call what they buy, and the Brier score of `precall.callout_p` tells us whether the record finds them.

```sql
with t as (select subject mint, body->>'wallet' w, seen_time from tape.events where topic in ('trade.curve','trade.amm') and body->>'side' = 'buy'),
k as (select wallet, min(seen_at) first_call from mem.callouts group by 1)
select count(*), count(*) filter (where exists (select 1 from mem.callouts c where c.wallet = t.w and c.mint = t.mint
  and c.seen_at > t.seen_time and c.seen_at <= t.seen_time + interval '5 min'))
from t join k on k.wallet = t.w and k.first_call < t.seen_time
where not exists (select 1 from mem.callouts c where c.wallet = t.w and c.mint = t.mint and c.seen_at <= t.seen_time);
```

## 2. The whole market fits in memory

A 15 s probe of `unifiedTradeEvent.lite.>` (every pump.fun trade, 2026-10-17 10:05 UTC):

| Measure | Value |
|---|---|
| Trades per second | 232 |
| Bandwidth | 131 KB/s |
| Distinct coins traded in 15 s | 314 |

That is cheap for one process to scan in memory on a small VM, as long as it writes to the Tape only for coins it decides to watch. This is the Scout (docs/PIPELINE.md).

## 3. What this changes

| Before | After |
|---|---|
| The watch starts at a coin's first callout | The Scout watches every caller wallet on every coin, and promotes a coin when a known caller buys it or its flow heats up |
| Strategies enter only after a callout | `pre_call` strategies enter on a known caller's buy and sell into the callout (docs/STRATEGY.md) |
| Our callout is a template line after a ghost fill | A thesis is formed, committed and posted as a PAPER house callout; the house is scored in the caller ledger like any caller (docs/EXECUTION.md) |
| Pre-call flow is invisible | The RPC backfill (S2.7) reads the coin's history when it enters the watched set |
