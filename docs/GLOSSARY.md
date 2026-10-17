# Glossary

One term per thing. If you need a new word, add it here in the same change.

| Term | Means |
|---|---|
| Asimog | The firm: the autonomous agent, its coin and its website (asimog.com). |
| Core | The one runtime that holds all functionality. Domains are frontends on top of it. |
| Desk | A venue the firm trades or forecasts on (callout desk, forecasting desk, later BTC and ETH). |
| Frontend | A website built on core's APIs (asimog.com now; cancerhawk.org rebuild, polymyths.com, hyperkaon.com later). |
| Adapter | A replaceable module for one outside thing: venue, decision, llm, compute, storage, social, payment, human. |
| Kernel | The one allocation algorithm used at every level. |
| Position (kernel) | Anything that consumes capital, budget or attention: strategy, desk, social campaign, Jev question, compute job. |
| Hurdle | The return a position must beat: zero net after costs for now; measured yield on idle capital later. |
| Stage (S0-S11) | An engineering step in the build plan (docs/13). |
| Milestone (Start, M1-M5) | A financial threshold that unlocks scope (docs/22). |
| Social capital | Followers, engagement, visitors and bounty participants, counted and allocated like capital. |
| Bounty | A paid task for humans (memes, translations, bug reports, testing) that also builds audience. |
| Builder | The thinking agent that writes code in a sandbox and opens pull requests. |
| Counsel | The human legal counsel; the only separate function. Signs decisions with legal weight. |
| Disclosure registry | The public list of every wallet, position disclosure and compensation. |
| Markout | Price move 1 s, 10 s, 60 s and 5 min after a fill; the fastest test of edge. |
| Commit-reveal | Publish a hash of a hypothesis, forecast or decision before acting; reveal the content after. |
| Constitution | `CONSTITUTION.md`: protected laws, hash-checked at boot. |
| Soul | `SOUL.md`: the agent's own versioned self-description. |
| Instrument | One screen of the site: one dominant form plus a strip of panels (Field, Cortex, Lab...). |
| Field | The night instrument: markets as particle clouds, positions as filaments. |
| Cortex | The paper instrument: the firm's lanes as lobes of a point-cloud brain. |
| Lab (instrument) | The paper instrument: committed items on an arc, evidence threads, outcome rays. |
| Callout | A Pump.fun post naming a coin, made by a holder. Ours or anyone's. |
| Update | A post threaded under a callout. Our exits are updates. |
| Data reply | One factual data reply we leave under someone else's callout. |
| Caller | An account that posts callouts. ID `cl_`. |
| Coin | A Pump.fun token. ID `cn_`, unique by mint. |
| Opportunity age | How far a coin's price moved, and how long ago the first call was, before a given callout. |
| Echo | A callout explained by an earlier one (copy, repost, habitual follower). |
| Echo ring | A group of callers who repeatedly echo one origin. |
| Wave | A burst of distinct tracked callers calling one coin. Default: 5 or more within 2 hours. |
| Session (S1-S8) | One agent-browser session plus its current task. Its live frames appear in the Field and Cortex strips. |
| Read box | The box of a page element a session read; sent with each frame. |
| Feed Reader | The direct reader of the callout feed endpoints. |
| Chain Reader | The reader of trades, curve state and our own transactions. |
| X Reader | The read-only X reader. |
| Observation | Raw thing a sense saw, with provenance. ID `ob_`. |
| Tape | The append-only event log. |
| Event | One immutable fact on the Tape. ID `ev_`. |
| Projection | A current view rebuilt from events (Memory). |
| Analyzer | An always-on module that writes signals. |
| Signal | A belief about a subject, with confidence and expiry. ID `sg_`. |
| Board | The latest live signal per kind and subject. |
| Attention | The part that spends sessions and metered analyzers where value of information is highest. |
| VOI | Value of information. |
| Caller model | A model of one caller's calling behavior. Tier 1 statistical, tier 2 swarm. |
| Caller DNA | Measured stats of a caller (lead time, opportunity age, hit rate, follower PnL). |
| Synthesis | BettaFish's output about the callout feed or a coin. |
| Swarm | One MiroShark simulation run, with branches A and B. |
| Branch A / B | Simulation without / with an agent callout. |
| Mood | The crowd mood signal (`mood.feed`): fear, greed, fomo, disgust, calm. |
| Tremor | A detected regime break (`regime.tremor`). |
| Strategy | A strategy as data (docs/08). ID `sr_`. |
| Strategy Pool | The population of strategies. |
| Ghost | A paper trade or a strategy without capital. |
| Probe | A strategy trading live at tiny size to earn full capital. |
| Allocator | Gives capital to strategies by Thompson sampling. |
| Intent | A strategy wants to act. ID `in_`. |
| Risk Gate | Pure function turning intents into orders or rejections. |
| Order | An approved intent. ID `or_`. |
| Effect | What a hand did (fill, post, sweep, payout). ID `ef_`. |
| Outcome | What happened at a horizon. ID `oc_`. |
| Score | How good a signal, strategy, analyzer or session was. ID `sc_`. |
| Why-chain | The links from any object back to its observations. |
| Executor | The hand that trades. |
| Publisher | The hand that posts. |
| Signer | The only service with keys. |
| Treasury | Fee sweeps, profit hours, distributions, seats, proofs. |
| War chest | W_trade's trading capital. |
| Base capital | Fee money sent to the war chest. Never profit, never distributed. |
| HWM | High-water mark of cumulative realized PnL paid out on. |
| Holder pool | 50% of distributable profit each hour. |
| Point | 1% of the hour's distributable profit. |
| Seat | A perpetual right to 1 point per hour, bought with burned tokens. ID `st_`. |
| Deposit order | A seat purchase in progress with its own deposit address. ID `dp_`. |
| Connectome Lab | The fruit-fly connectome trading a 1% sleeve. |
| Jev | TypeSafe's System One model: typed answers (Choice, Score, Noul, Box) with calibrated probabilities in about 150 ms. |
| System One | The fast mind: math analyzers and Jev packs, on every event. |
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
| Thinking agent | LangGraph LLM agent (Postmortem, Researcher, Ops, Reporter, Integrity writer) or a System Two app. |
| Signer | The signer. The only holder of keys. |
| Trader | The Executor hand. |
| Treasurer | Runs sweeps, profit hours, distributions, seats and proofs. |
| Relay | Public fan-out of events and frames so viewers never touch the core. |
| W_agent | The agent's x402 wallet for model and API costs. |
| W_operator | The human operator's wallet. |
| Cluster | Wallets counted as one holder (common funder or token transfers). |
| Premium | The extra seat price after a sale, fading over about a day. |
| Entry rank | How many buyers came between a trade's trigger and our fill. |
| Mode | `replay`, `paper` or `live`. Set by the owner only. |
| Case file | Everything known about one callout, in time order, split into evidence classes (docs/07). Built by `ctl case`. |
| Coverage | What a collector actually saw over a window; every outcome carries a coverage status (`ok`, `no_entry`, `no_trades`, `gap`). |
| Gap | An interval a sense knows it missed, written as `system.gap`. |
| Evidence class | Observed, computed, AI judgment, hypothesis or outcome (docs/03). |
| Indicator | A deterministic pattern over observed data (for example `wash_atomic`) with evidence, other explanations and limits. Never an accusation. |
| Net multiple | SOL back / SOL spent for a round trip of `OUTCOME_REF_SOL` through the fill model. The only multiple that counts as a result. |
| Caller ledger | The per-caller record of every callout's outcome with denominators and exclusions (`ctl callers`, methodology `cl1`). |
