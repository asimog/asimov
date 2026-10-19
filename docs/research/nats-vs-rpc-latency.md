# NATS against RPC: who sees a pump.fun trade first

Measured 2026-10-19 with `scripts/latency-nats-vs-rpc.ts` (75 s, one machine, one clock). The pump.fun NATS trade feed (`unifiedTradeEvent.lite.>`) against `logsSubscribe` on the pump program at `processed`, once per RPC provider in `RPC_URLS`. Same signature, first arrival on each source; delta is the provider minus NATS, in ms (negative: faster than NATS).

| Source | Signatures seen | p10 | median | p90 |
|---|---|---|---|---|
| NATS | 9143 | | | |
| quicknode | 3424 | -190 | **-47** | 16 |
| rpcfast | 3419 | -91 | 20 | 174 |
| helius | 3402 | 67 | 178 | 372 |
| chainstack | 3420 | 35 | 203 | 936 |
| fluxrpc | 3373 | 6460 | 6861 | 7161 |

What it says:

- NATS is not slow. Only quicknode's push stream beat it, by about 50 ms at the median. HTTP polling cannot beat a push feed at all.
- NATS sees about 2.7 times more signatures (9143 against about 3400). `logsSubscribe` with `mentions` only returns transactions that name the pump program, so pump-swap trades and routed trades are missing from it.
- fluxrpc runs about 7 s behind: do not use it for anything timing-sensitive.
- One short sample from one place: a decision aid, not a benchmark. Re-run before relying on a specific provider.
