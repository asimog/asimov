# 00 · Goals and decisions

Read this first. Every other doc follows from it.

## What you want, in plain words

1. **An octopus that watches every Pump.fun callout, all the time.** Who called which coin, when, at what market cap, what they bought and sold, who replied, who reposted.
2. **It understands the feed.** BettaFish reads the whole callout feed and says what the crowd is thinking right now.
3. **It predicts the callers.** Every caller has a Shadow (a model of how they call). MiroShark runs simulated callers forward to see who calls next. The edge is knowing the wave before it arrives.
4. **It makes money.** It buys first, posts its own callout (Pump.fun requires holding the coin to call it), posts every exit as a callout update, and sells into the wave.
5. **It gets better by itself.** Strategies are not fixed. They are bred, tested, promoted and retired all the time.
6. **People can watch it think.** The website shows the octopus crawling up to 8 real pages at once, its labs, its simulations, its trades. 3D, futuristic, never seen before, works on phones. Visitors watch. They do not chat with it.
7. **It pays holders.** After the coin launches, creator fees are swept every 10 minutes and half goes to the trading war chest. Every hour, half of the trading profit goes to the top 50 holders and to seat owners.
8. **It is built over a weekend, without shortcuts.** The spine must be right on day one, because everything else plugs into it.

## The problem it solves

The callout feed is fast, noisy and full of tricks: echo rings that repeat one origin, late callers who call after the pump, and wallets that dump on their own followers. No human can watch all of it. Nobody shows who is about to call next. A memecoin also needs a spectacle that is real and checkable, not a mascot on a static page.

## The one idea that holds it together

**Everything the octopus knows is an event on one tape. Everything it thinks is a signal on one board. Everything it does is an intent that passes one gate.**

And it thinks at two speeds. **System One (Jev, plus plain math) answers in about 150 ms on every event and drives fast trades. System Two (BettaFish, MiroShark, LLM agents) runs only when System One is unsure and the stakes justify the cost.** See `17-jev-fast-mind.md`.

That gives three properties at once:

- **Simultaneous.** Organs (the eight beats) run at the same time and never wait for each other. They read the tape and write to the board. Decisions read the board. Nothing is a hand-off chain.
- **Replayable.** The same code runs on a live tape or a recorded one. Tests are replays. Backtests are replays. The website's Rewind is a replay.
- **Explainable.** Every signal, intent, order and post links to the events that caused it. `octo why <id>` walks the chain back to the raw observation.

See `03-system-model.md`.

## Decision log

Each line: what we chose, why in simple words, and what we did not choose.

### Senses

| Decision | Why | Not chosen, and why not |
|---|---|---|
| **agent-browser for the 8 tentacles** | It drives real Chrome sessions, isolates each session, gives element refs and boxes, records network traffic, and streams each viewport as JPEG frames over a WebSocket. The website can show the real pages the octopus reads. | crawl4ai: great for bulk extraction, but we read a few sites deeply, and agent-browser already returns markdown. Two crawlers would mean two ways to fail. |
| **A direct Feed Tap next to the tentacles** | Browsers are slow and visible. The callout feed must never miss an item. The Feed Tap reads the same JSON the web app reads, found by HAR capture. | Browser-only ingestion: a crashed tab would lose callouts. |
| **Chain Ear: Pump.fun's own NATS trade feed, checked by RPC** | The pump.fun web client already streams decoded trades (with market cap and USD) over NATS. Reading that is zero decoding work. Our RPC (Helius free tier to start) is the truth source for our own fills, holder snapshots and anything money depends on, through standard websocket subscriptions. Yellowstone gRPC switches on by config when a paid plan is worth it. | Decoding every pump trade ourselves: a week of work the platform already did. Polling RPC: too slow. |
| **Providers are config, never code** | RPC, LLM, decision model, storage and hosting all sit behind small adapters chosen by environment variables (docs/15). | Hard-coding Helius, OpenRouter, Railway: a switch would mean a rewrite. |
| **XActions for X, read-only** | Callers post on X too. We read their posts and take screenshots as proof of what they claimed. No API keys. | Posting on X automatically. Out of scope; the octopus speaks on Pump.fun. |
| **REA plus Ghidra only if HAR is not enough** | If some callout data exists only in the mobile app, we need to read the client to find the endpoint. | Starting with Ghidra: heavy, and the web client already shows the feed. |

### Memory

| Decision | Why | Not chosen, and why not |
|---|---|---|
| **One Postgres as tape, memory and board** | One database is the simplest thing that works at our volume (a few callouts per second, a few hundred trades per second). LISTEN/NOTIFY wakes consumers. | Kafka or Redis Streams: more moving parts, no need yet. Add only when measured load needs it. |
| **Neo4j only inside MiroShark** | MiroShark already needs it for graph memory. | A second graph database for our own caller graph: Postgres tables plus in-memory graph math are enough. |
| **Bitemporal events** | Every event records when it happened and when we saw it. Replays and tests can never use the future. | Single timestamps: backtests would leak the future without anyone noticing. |

### Intelligence

| Decision | Why | Not chosen, and why not |
|---|---|---|
| **BettaFish synthesizes the callout feed itself** | Its InsightEngine already mines platform tables with hotness formulas. We add a `pumpfun_callout` platform. Then its forum debates the feed, and ReportEngine writes the synthesis. | Using BettaFish only for X and Telegram: it would miss the main source. |
| **MiroShark for swarm simulation** | It has a plugin pattern for platforms (`wonderwall/simulations/polymarket` with its own AMM). We add `simulations/pumpfun` with a callout feed and the bonding curve. It also has branch forks and news injection. | MiroFish directly: MiroShark is its descendant and already has markets and branches. |
| **Jev as the fast mind** | Typed answers with calibrated probabilities in about 150 ms for $0.042 per million input tokens. Every BettaFish and MiroShark signal gets a Jev twin, so fast trades never wait for a slow run. The question bank itself evolves. | Using LLMs for fast judgments: 10 to 100 times slower, costlier, and returns text that must be parsed. |
| **Three-tier Shadows** | Tier 1 statistical Shadows run on every event in milliseconds. Tier 2 is the Jev `shadow` pack: 40 callers judged in one 150 ms request. Tier 3 is a MiroShark swarm, only when the escalation gate fires. | Running MiroShark on every coin: too slow, even with cheap models. |
| **Cheap models, tunable runs** | DeepSeek v4.1 Flash through OpenRouter ($0.032 in, $0.144 out per million). Swarm presets: nano about $0.007, lite about $0.05, full about $0.34 per run. Every step count is an env variable. | $1 runs on premium models. |
| **Hawkes, HMM, curve math as plain code (never Jev or an LLM)** | These are a few hundred lines of math with clear tests. The bonding-curve functions come from the official pump SDK. | LLMs for numbers: slow, costly, and not reproducible. |
| **TimesFM as a baseline only** | Organs must beat a strong forecaster to keep their place. | TimesFM as a trading signal: memecoin attention is not its strength. |
| **Fly Lab with wetware** | Absurd and real: a real fruit-fly connectome, with a trained readout, trades 1% of capital. Viral, measurable, cheap. | openfly's full 166k-neuron CNS: heavy. Pattern reference only. |

### Mind

| Decision | Why | Not chosen, and why not |
|---|---|---|
| **Strategies are genomes (data), bred in a Brood** | You asked for strategies that never stop evolving. A genome is a JSON rule set over board signals. Every genome paper-trades all the time. Capital follows results. | Fixed strategy list: dies when the market changes. |
| **Thompson-sampling allocator** | It gives most capital to proven genomes and a little to new ones, so new ideas get tested without risking much. | Equal weights: wastes capital on losers. |
| **Deterministic Risk Gate** | LLMs and genomes propose; plain code with hard limits decides. | Letting any model place orders: one bad output could drain the war chest. |

### Hands

| Decision | Why | Not chosen, and why not |
|---|---|---|
| **Official pump SDK + fun-block API for trades and fee collection** | Built and maintained by Pump.fun. It handles curve vs AMM and sharing configs. | pumpfun-cli as the executor: a fine operator tool, but a second stack. |
| **Isolated Signer service** | The only process holding keys. It signs only allowlisted transaction shapes and pump.fun login messages. | Keys inside the main process: one injection away from loss. |
| **Herald posts through a logged-in tentacle** | Posting needs a wallet session. Doing it in a visible tentacle also lets visitors watch the octopus write its call. | Hidden posting: loses the spectacle. |
| **Exit callouts are native callout updates** | Pump.fun threads updates under the callout. Followers see every exit where they already look. | Separate posts: spam, and against the one-callout-per-coin rule. |
| **Caveman voice** | Short, blunt, memeable, and every fact stays. Matches the creature. | Polished marketing voice: reads like every other bot. |

### Money

| Decision | Why | Not chosen, and why not |
|---|---|---|
| **Fee sweep every 10 minutes** | Your rule. Half to the war chest (base capital, never distributed). The other half goes to the operator wallet and the agent's x402 wallet (LLM, API and subscription costs). | - |
| **Profit split: 50% octopus, 49% top 50, 1% per seat** | Your rule. Each seat takes its 1 point out of the top-50 pool. A seat owner can also be a top-50 holder and gets both. | - |
| **Profit = realized PnL above a high-water mark** | Holders are paid only for real new profit. A loss must be earned back before the next payout. | Paying on unrealized gains: you could pay out money that later disappears. |
| **Holder snapshot = minimum of 4 random samples per hour** | Rewards holding. Kills buying just before the snapshot. | Single snapshot: easy to game. |
| **Seats: 21 max, floor 1M × 1.15^(n−1), +50% premium after each sale that fades over about a day** | Built for FOMO. Few seats (21) make scarcity obvious. Each sale makes the next seat jump in price, then the price drifts down, so people watch and race to snipe the dip. Live earnings per seat are shown, so owning one is visible proof. All 21 burn about 118.8M tokens (11.9% of supply), a strong burn story. Top 50 keep at least 29 points. | A plain flat curve: no moments, no race. Unlimited seats: no scarcity. |
| **Deposit address per seat order, no wallet connection** | Your rule. The visitor types a payout wallet, gets a unique deposit address, and sends tokens from anywhere. | Wallet adapter flow (agent-payments-sdk): it needs wallet connection. |

### Surface

| Decision | Why | Not chosen, and why not |
|---|---|---|
| **Next.js + React Three Fiber + Drei + postprocessing** | The best-supported 3D React stack, with installed skills for every part. | Raw three.js: more code to own. |
| **Real-cephalopod look, not neon** | Your banned list removes neon, purple-black and orbs. A real octopus has chromatophores, iridophores and rust and ochre skin. Science-accurate skin driven by live data has not been done. | Cyberpunk neon: banned, and every other crypto site uses it. |
| **Visitors watch, no chat** | Chat is risky (prompt injection, promises, liability) and makes it feel like a scanner. The octopus acts; people watch. | Any free-text input to the agent. |
| **impeccable wins design conflicts** | Your rule. | - |

### Process

| Decision | Why | Not chosen, and why not |
|---|---|---|
| **TypeScript + Python only** | The pump SDKs are TypeScript. BettaFish, MiroShark and the math are Python. Two languages is the minimum. | A third language for speed: not needed yet. |
| **E2E replay tests produce artifacts** | Your rule. A replay of a recorded tape must produce the same report hash every time. | Unit-test suites: your rule says no. |
| **LangGraph JS (LangChain) for thinking agents** | The most standard agent stack. One small graph per agent, tools from the `octo` MCP server, Postgres checkpoints. | A home-made agent loop. |
| **One agent, one job, one key** | Wallet, trading, posting, treasury and each thinking agent are separate, with capability tokens, separate DB roles and separate OpenRouter keys (docs/18). | One big agent with all powers. |
| **Deploy profiles: Railway + Vercel by default, or Coolify + Cloudflare Tunnel at home** | Same Docker images either way; providers are env config (docs/15). | Locking into one host. |

## Non-goals (v1)

- No chat, no free-text input from visitors to the agent.
- No second Pump.fun account, no automated likes, follows or reposts.
- No callout posts that call out a person. Hunting lives on the website and in factual reply comments.
- No reward farming. The octopus does not model the Activity Metric (terms 7.1(f)).
- No callouts on other chains or perps.
- No copy-trade product.
