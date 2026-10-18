# RED-REJECT-2026-v2: rejected coins and what they did next

Dataset note, written 2026-10-17. Local copy: `.upstream/RED-REJECT-2026-v2_v2.3/` (read-only). All numbers below were computed by my own DuckDB queries on the main file; the denominator is given with each one.

Integrity: `sha256sum -c SHA256SUMS` passed, 32 of 32 files OK (data, scripts, docs). No text in the pack was aimed at an AI agent.

## 1. What it is

- A public research corpus. Someone ran a paper-trading bot fleet on Pump.fun coins. Its filters turned many coins down ("rejections"). A tracker then re-checked each rejected coin's price every few minutes, then hourly, for about 24 hours. The question it answers: did the rejected coin pump anyway?
- Author: Arati Uday Kamat, independent researcher. Version v2.3 (2026-09-25). License CC-BY-4.0 (reuse freely, give credit). Cite: "Kamat, A. U. RED-REJECT-2026-v2 (v2.3), doi:10.5281/zenodo.21402476, CC-BY-4.0".
- Size: 716,762 rows (one per follow-up sample), 18,237 rejection events, 4,635 coins (mints). Span 2026-04-11 to 2026-07-16 (96 days).
- The filter is the author's bot fleet, not ours. It has 8 rules (section 4). Data comes from DEX Screener (price, liquidity, volume) and Helius.

The 29 fields, grouped:

| Group | Fields | Meaning and example |
|---|---|---|
| Row ids | `row_id_original`, `schema_variant`, `producer_family`, `source_pseudonym`, `normalization_status` | Bookkeeping. Which of 10 old file layouts produced the row (`2`), family 1 or 2, an opaque source label (`producer_a_v1`) |
| Keys | `event_id`, `sample_id`, `mint`, `symbol` | `event_id` = one rejection (hash of mint, reject time, reason). `mint` = coin address, `...pump` suffix. `symbol` e.g. `Peepa` |
| Rejection | `rejectTs_utc_iso`, `rejectTs_utc_ms`, `rejectReason`, `alphaScoreSoFar`, `regime` | When and why it was rejected. `alphaScoreSoFar` is the bot's own score, filled on 5.7% of rows. `regime` is BTC price, fear and greed index, filled on 83.8% |
| Sample time | `sampleTs_utc_iso`, `sampleTs_utc_ms` | When this follow-up check happened |
| Market state | `priceUsd`, `priceChange5m/1h/24h`, `liquidity`, `volume24h` | Price in USD (e.g. 0.0002317), price change in percent, pool liquidity and 24h volume in USD, all at sample time |
| Venue | `dexId`, `pairAddress` | Where it trades: `pumpswap` 91.8%, `meteora`, `raydium`, `pumpfun` (still on the bonding curve) 1.8%, null 1.2% |
| Age | `ageMin_original`, `ageMin_recomputed_min`, `ageMin_delta_min` | Minutes between rejection and sample, not the coin's age |
| Other | `classification`, `symbol_redacted` | `classification` exists only in the older family 2 layout. `symbol_redacted` is always false |

Missing on purpose or by design: no market cap field, no holder counts, no creator, no text, no wallets, no price AT rejection (see section 2).

## 2. Point in time: what is known when

- Recorded at rejection: `rejectTs`, `rejectReason`, `mint`, `alphaScoreSoFar` (when present). That is all.
- Recorded at each later sample: price, liquidity, volume, price changes, venue, `ageMin`. There is no market state at the exact rejection moment. The first sample comes a median 3.3 minutes after it (10th to 90th percentile 0.5 to 9.1 min, 18,224 events with a priced sample). I use that first sample as the "entry price".
- Lookahead risk for us:
  1. Every price field belongs to its sample time. If we tune the Scanner with sample N's liquidity or `priceChange1h` to predict a win seen at sample N+k, that is fine only when k comes after N. Never mix a field from a later sample into the "at rejection" picture.
  2. `priceChange1h/24h` look back from the sample, so they are safe as "what we could see then". The outcome (later price) is the label. Keep the two strictly apart.
  3. Survivorship: events with a single sample (8,402 of 18,224, 46%) have no outcome. Tokens that died or left the aggregator drop out. Winners are likely over-counted among the observed, so treat the shares below as upper-leaning (lower bound if all unobserved lost: 1,045 of 18,224 = 5.7%).
  4. Reasons were tuned by the author over time (two rules started 18 and 23 April). Any rule may have been designed after seeing winners.

## 3. Bias

- The filter is not ours. The numbers describe what the author's 8 rules turned away, not what our Scanner would reject. There are no accepted coins in the file, so there is no "control" group: I cannot say how many coins in general double, only compare rules with each other.
- Population: coins the fleet saw and rejected, mostly graduated pumpswap coins (16,404 of 18,224 first samples, 90%). Only 251 first samples are on the bonding curve (`pumpfun`). Our Scanner targets fresh launches near 6K market cap; this file barely covers them.
- Producer identity is pseudonymized into 6 opaque labels (`producer_a_v1..v4`, `producer_b_v1..v2`). Fine for us; the labels carry no meaning, 13.8% of rows have none.
- Venues: 4,278 events have more than one `(dexId, pairAddress)`, mostly because older rows have a null venue (4,190); 88 truly trade on two or more pools. Prices come from DEX Screener, a delayed aggregator, not from our execution venue.
- Collection gap: no rejection events 3 June 06:35Z to 24 June 16:34Z, no samples 4 June 06:32Z to 24 June 16:38Z (about 20 days). It is a gap in the file, so nothing is invented; monthly 2x share by rejection month is stable: Apr 9.5%, May 10.2%, Jun 12.3% (only 1,136 events), Jul 11.1%.
- Duplicates: 0 duplicate sample ids. But 3,253 coins have more than one event, so events are not independent (the first event per coin gives 11.6% 2x, 4,634 coins, close to the all-event number).

## 4. Findings

Setup (my definitions, not the author's):
- Entry = first priced sample of the event. Evaluable event = at least one later priced sample: 9,822 of 18,224 events with a priced sample (54%). Averages and shares use evaluable events as the denominator.
- Horizon: follow-up ends about 24 h after rejection. From entry, median last sample 16.3 h, 99th percentile 23.8 h, max 24.0 h. Samples per event: 39.3 on average over all events, 72.0 over evaluable ones.
- "2x" = a later sample at or above 2 times the entry price. "Clean 2x" = 2x came before any sample at or below 0.7 times the entry price (a 30% fall from entry, not from the peak). Samples are discrete, so both are lower bounds on the true path. Median time to 2x is minutes from entry.

Query logic (DuckDB, `s` = all rows with price above 0):
```
base  = first row per event_id ordered by sampleTs_utc_ms        -- entry price bp, time bst
later = rows of the same event with sampleTs_utc_ms > bst
t2x   = min(sampleTs) of later where priceUsd >= 2 * bp
tdd   = min(sampleTs) of later where priceUsd <= 0.7 * bp
evaluable = count(later) > 0;  win2x = t2x is not null;  clean = t2x is not null and (tdd is null or t2x < tdd)
share = count(win) / count(evaluable) per rejectReason;  median(t2x - bst)
mcap proxy = bp * 1e9  (Pump.fun coins have 1,000,000,000 supply; only mints ending "pump", 87% of events)
```

Per rejection reason (events = all events; eval = evaluable; samples/event over all events):

| Reason | Events | Eval | Samples/ev | 2x | Clean 2x | Median to 2x |
|---|---:|---:|---:|---:|---:|---:|
| downtrend_24h | 9,870 | 5,272 | 40.7 | 10.2% (536) | 6.1% (320) | 320 min |
| marketcap_out_of_range | 4,670 | 2,345 | 32.8 | 9.5% (222) | 7.0% (164) | 90 min |
| multi_tf_fade | 1,736 | 1,141 | 49.5 | 14.2% (162) | 10.6% (121) | 150 min |
| timeSlot_not_strong | 972 | 512 | 38.1 | 11.5% (59) | 7.6% (39) | 270 min |
| hour_blacklist | 454 | 263 | 37.2 | 10.3% (27) | 7.6% (20) | 200 min |
| ultra_fast_reject_exit | 225 | 164 | 52.2 | 16.5% (27) | 14.0% (23) | 80 min |
| utc_hour_blocked | 222 | 81 | 29.8 | 9.9% (8) | 7.4% (6) | 125 min |
| h6_sellers_dominating | 88 | 44 | 33.6 | 9.1% (4) | 4.5% (2) | 200 min |
| All | 18,237 | 9,822 | 39.3 | 10.6% (1,045) | 7.1% (695) | 200 min |

Reading it:
- Overall about 1 in 9 rejected coins later doubled (10.6%); 1 in 14 doubled before a 30% dip (7.1%). Half of the 2x hits came within 200 min of entry; 156 of 1,045 within 30 min, 266 within an hour. 51% of evaluable coins hit -30% from entry at some point (4,356 fell 30% and never doubled).
- 95% intervals (Wilson) for 2x: downtrend 9.4 to 11.0; multi_tf_fade 12.3 to 16.3; ultra_fast 11.6 to 22.9; utc_hour 5.1 to 18.3; h6_sellers 3.6 to 21.2. Rules with fewer than 100 evaluable events (utc_hour_blocked, h6_sellers_dominating) are noise: do not trust them either way.
- Good rejections (fewer winners than average): downtrend_24h on clean wins (6.1%, tight interval 5.5 to 6.7) and, by point estimate only, h6_sellers_dominating (too few events). Rejected coins in `downtrend_24h` have a median 24h change of -63%, and the winners there are slow (median 320 min).
- Costly rejections (many missed winners): `ultra_fast_reject_exit` (1 in 6 doubles, 14% clean) and `multi_tf_fade` (1 in 7, 10.6% clean). These two reject coins already rising (median 1h change +17 to +20%): the filter fades momentum that sometimes continues.
- Middle, within noise of average: marketcap_out_of_range, timeSlot_not_strong, hour_blacklist.
- Clock rules (`hour_blacklist`, `timeSlot_not_strong`, `utc_hour_blocked`) show no clear edge over price-based rules at these sample sizes. Do not copy them.
- Robustness: dropping 13 hits that went above 1000x (price glitches) leaves 1,032 of 9,822 (10.5%). Requiring 2 samples at or above 2x leaves 765 (7.8%). Treat 8% to 10.6% as the honest range for "2x in 24 h".

Market cap and holders at rejection:
- Holders: not in the file. Nothing to say.
- Market cap: not a field. Proxy = entry price x 1e9, for `pump` mints only (18,224 events, 87% pump mints). Median proxy about 20K USD, so small caps are common here.
- Evaluable pump events by proxy band, with 2x and clean 2x: under 6K: 1,736 events, 11.5% and 6.8%. 6K to 15K: 1,758, 9.8% and 4.7%. 15K to 60K: 2,997, 10.2% and 7.4%. 60K to 250K: 1,325, 11.9% and 8.7%. 250K and up: 777, 11.6% and 9.4%.
- Coins rejected at proxy 6K or above (6,857 evaluable of 12,942): 725 doubled (10.6%), 494 clean (7.2%), median 160 min. By reason (2x / clean, evaluable): downtrend 9.1 / 5.4 (3,148), marketcap_out_of_range 9.6 / 7.1 (1,859), multi_tf_fade 15.0 / 11.3 (978), timeSlot 12.5 / 8.4 (415), hour_blacklist 10.7 / 7.9 (215), ultra_fast 19.3 / 17.0 (135), utc_hour 12.1 / 9.1 (66), h6_sellers 9.8 / 4.9 (41).
- Same, 6K to 60K band only (4,755 evaluable): 478 doubled (10.1%), 306 clean (6.4%). The sweet spot of our Scanner sits at the weakest clean-win rate (6K to 15K: 4.7%). So a mere "above 6K market cap" gate is not a winner signal on this data.
- Liquidity at entry (evaluable): under 10K 10.3%, 10 to 30K 10.8%, 30 to 100K 12.3%, over 100K 7.4% (326 events). Slightly better with deeper pools; weak.

Caveats on all of the above: no control group; DEX Screener prices lag; the entry is 3 minutes late; a 2x on a 6K coin is a few hundred dollars of liquidity moving, so it may not be tradeable at 0.02 SOL.

## 5. What it can teach Asimog (0 to 3)

| | Score | Why |
|---|:---:|---|
| (a) Callers | 0 | No caller, creator or post data. Producer labels are the bot's feeds, not people |
| (b) Wallet behaviour | 0 | Only coin and pool addresses. No wallets, no holders, no buyers |
| (c) Coin metrics near 6K mcap vs outcome | 1 | Price, liquidity, volume and 1h/24h change vs a 24h outcome exist, but mcap is only a proxy, one-sided (rejected coins only), few bonding-curve coins |
| (d) Text | 0 | Only the ticker symbol |
| (e) Labels for a "missed winners" test | 3 | 1,045 labelled 2x events and 695 clean ones across 8 reasons, free of any model. Best use of the file |

## 6. Verdict and how it plugs in

Use it as a test set only: a "missed winners" yardstick, not a source of new signals. The big takeaways are plain: even after the author's filters, about 1 in 10 rejected coins doubles and about 1 in 14 doubles cleanly, so a Scanner rule that rejects must beat that rate to be called good. Momentum fades and fast-exit rules throw away the most winners; the 24h-downtrend rule throws away the fewest.

Plug-in (an E2E replay, per `docs/OPS.md`):
1. Build a tape from the 18,224 events: for each, the entry sample (price, liquidity, volume, price changes, `rejectTs`) plus the label (`win2x`, `clean2x`, time to 2x). Fix the build as a script and record its output hash.
2. Run our Scanner rules on the entry sample only (never on later rows, to stop lookahead). Count per rule: events rejected, winners missed, share missed with an interval.
3. Pass a rule only if its missed-winner share is not above the dataset's 10.6% (2x) or 7.1% (clean) with a full interval below that, and its sample is above 200 events. Score separately on bonding-curve coins when the new Scanner data arrives, since this file barely has them.
4. Produce a table artifact (rule, events, missed, share, interval) and commit it.
Follow-up: ask the owner if a live paper tape of our own accepted and rejected coins should be recorded, because that gives the control group this file lacks.
