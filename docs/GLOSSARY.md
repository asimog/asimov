# Glossary

One term per thing. If you need a new word, add it here in the same change.

| Term | Means |
|---|---|
| OCTOPUS | The whole autonomous agent and its website. |
| Callout | A Pump.fun post naming a coin, made by a holder. Ours or anyone's. |
| Update | A post threaded under a callout. Our exits are updates. |
| Ink note | One factual data reply we leave under someone else's callout. |
| Caller | An account that posts callouts. ID `cl_`. |
| Coin | A Pump.fun token. ID `cn_`, unique by mint. |
| Opportunity age | How far a coin's price moved, and how long ago the first call was, before a given callout. |
| Echo | A callout explained by an earlier one (copy, repost, habitual follower). |
| Echo ring | A group of callers who repeatedly echo one origin. |
| Wave | A burst of distinct tracked callers calling one coin. Default: 5 or more within 2 hours. |
| Tentacle (T1-T8) | One agent-browser session plus its current task. Also its arm on screen. |
| Plate | The glass pane on screen showing a tentacle's live page. |
| Sucker | The contact point where an arm touches the element being read. |
| Feed Tap | The direct reader of the callout feed endpoints. |
| Chain Ear | The reader of trades, curve state and our own transactions. |
| X Eye | The read-only X reader. |
| Observation | Raw thing a sense saw, with provenance. ID `ob_`. |
| Tape | The append-only event log. |
| Event | One immutable fact on the Tape. ID `ev_`. |
| Projection | A current view rebuilt from events (Memory). |
| Organ | An always-on module that writes signals. |
| Signal | A belief about a subject, with confidence and expiry. ID `sg_`. |
| Board | The latest live signal per kind and subject. |
| Attention | The part that spends tentacles and metered organs where value of information is highest. |
| VOI | Value of information. |
| Shadow | A model of one caller's calling behavior. Tier 1 statistical, tier 2 swarm. |
| Caller DNA | Measured stats of a caller (lead time, opportunity age, hit rate, follower PnL). |
| Synthesis | BettaFish's output about the callout feed or a coin. |
| Swarm | One MiroShark simulation run, with branches A and B. |
| Branch A / B | Simulation without / with an octopus callout. |
| Skin | The mood signal (`mood.skin`) and the octopus's chromatophore display of it. |
| Tremor | A detected regime break (`regime.tremor`). |
| Genome | A strategy as data (docs/08). ID `gn_`. |
| Brood | The population of genomes. |
| Ghost | A paper trade or a genome without capital. |
| Probe | A genome trading live at tiny size to earn full capital. |
| Allocator | Gives capital to genomes by Thompson sampling. |
| Intent | A genome wants to act. ID `in_`. |
| Risk Gate | Pure function turning intents into orders or rejections. |
| Order | An approved intent. ID `or_`. |
| Effect | What a hand did (fill, post, sweep, payout). ID `ef_`. |
| Outcome | What happened at a horizon. ID `oc_`. |
| Score | How good a signal, genome, organ or tentacle was. ID `sc_`. |
| Why-chain | The links from any object back to its observations. |
| Executor | The hand that trades. |
| Herald | The hand that posts. |
| Signer | The only service with keys. |
| Treasury | Fee sweeps, profit hours, distributions, seats, proofs. |
| War chest | W_trade's trading capital. |
| Base capital | Fee money sent to the war chest. Never profit, never distributed. |
| HWM | High-water mark of cumulative realized PnL paid out on. |
| Holder pool | 50% of distributable profit each hour. |
| Point | 1% of the hour's distributable profit. |
| Seat | A perpetual right to 1 point per hour, bought with burned tokens. ID `st_`. |
| Deposit order | A seat purchase in progress with its own deposit address. ID `dp_`. |
| Fly Lab | The fruit-fly connectome trading a 1% sleeve. |
| Jev | TypeSafe's System One model: typed answers (Choice, Score, Noul, Box) with calibrated probabilities in about 150 ms. |
| System One | The fast mind: math organs and Jev packs, on every event. |
| System Two | The slow mind: BettaFish, MiroShark and LLM agents, on escalation only. |
| Pack | One Jev request: one state, many questions, versioned. |
| Escalation gate | The rule that sends a decision from System One to System Two (docs/17). |
| Fast lane | The path from a seen callout to a sent transaction using System One only. |
| Guard | The Jev pack that screens texts entering LLMs and leaving as posts. |
| Question bank | The evolving set of Jev questions (`jev.q.*`). |
| Preset | nano, lite or full: env-set step counts and caps for BettaFish and MiroShark. |
| Lane | One agent's area of power, enforced by a capability token. |
| Capability token | A credential that opens exactly one lane (`cap:sign.swap`, `cap:board.hawkes`...). |
| Service agent | Deterministic code agent (Watcher, Trader, Wallet, Treasurer...). |
| Reflex agent | Jev-driven agent (Reflex, Guard). |
| Thinking agent | LangGraph LLM agent (Postmortem, Researcher, Ops, Reporter, Hunter writer) or a System Two app. |
| Wallet agent | The signer. The only holder of keys. |
| Trader | The Executor hand. |
| Treasurer | Runs sweeps, profit hours, distributions, seats and proofs. |
| Relay | Public fan-out of events and frames so viewers never touch the core. |
| W_agent | The agent's x402 wallet for model and API costs. |
| W_operator | The human operator's wallet. |
| Cluster | Wallets counted as one holder (common funder or token transfers). |
| Premium | The extra seat price after a sale, fading over about a day. |
| Entry rank | How many buyers came between a trade's trigger and our fill. |
| Mode | `replay`, `paper` or `live`. Set by the owner only. |
