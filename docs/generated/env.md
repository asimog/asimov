# Settings (env)

Generated from `.env.example` by `npm run docs:gen`. Do not edit by hand.

304 keys. Secrets live only in `.env.local` and are not listed here.

| Key | Default | Section |
|---|---|---|
| `HELIUS_API_KEY` | ` ` | providers (docs/OPS.md) |
| `RPC_URL` | `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}` | providers (docs/OPS.md) |
| `RPC_URLS` | `helius\|10\|${RPC_URL},chainstack\|5\|${CHAINSTACK_URL},rpcfast\|15\|${RPCFAST_URL},fluxrpc\|15\|${FLUXRPC_URL},quicknode\|15\|${QUICKNODE_URL}` | providers (docs/OPS.md) |
| `RPC_BUDGET_HELIUS` | `1000000` | providers (docs/OPS.md) |
| `RPC_BUDGET_CHAINSTACK` | `3000000` | providers (docs/OPS.md) |
| `RPC_BUDGET_RPCFAST` | `1500000` | providers (docs/OPS.md) |
| `RPC_BUDGET_QUICKNODE` | `10000000` | providers (docs/OPS.md) |
| `RPC_COST_QUICKNODE` | `30` | providers (docs/OPS.md) |
| `RPC_DENY_CHAINSTACK` | `getProgramAccounts,getTokenLargestAccounts` | providers (docs/OPS.md) |
| `RPC_DENY_RPCFAST` | `getProgramAccounts,getTokenAccountsByOwner,getTokenAccountsByDelegate,getTokenLargestAccounts` | providers (docs/OPS.md) |
| `RPC_BUDGET_STOP` | `0.95` | providers (docs/OPS.md) |
| `RPC_WS_URL` | `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}` | providers (docs/OPS.md) |
| `OPENROUTER_API_KEY` | ` ` | providers (docs/OPS.md) |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | providers (docs/OPS.md) |
| `LLM_MODEL_CHEAP` | `deepseek/deepseek-v4.1-flash` | providers (docs/OPS.md) |
| `LLM_MODEL_SMART` | `deepseek/deepseek-v4.1-flash` | providers (docs/OPS.md) |
| `TYPESAFE_API_KEY` | ` ` | providers (docs/OPS.md) |
| `JEV_MODEL` | `jev-1.14.0` | providers (docs/OPS.md) |
| `PUMP_NATS_USER` | `subscriber` | pump.fun realtime (public web-client subscriber credentials, docs/research/pumpfun-endpoints.md) |
| `PUMP_NATS_PASS` | ` ` | pump.fun realtime (public web-client subscriber credentials, docs/research/pumpfun-endpoints.md) |
| `PUMP_NATS_FEED_PASS` | ` ` | pump.fun realtime (public web-client subscriber credentials, docs/research/pumpfun-endpoints.md) |
| `PUMP_NATS_TRADES_URL` | `wss://unified-prod.nats.realtime.pump.fun` | pump.fun realtime (public web-client subscriber credentials, docs/research/pumpfun-endpoints.md) |
| `PUMP_NATS_FEED_URL` | `wss://prod-v2.nats.realtime.pump.fun` | pump.fun realtime (public web-client subscriber credentials, docs/research/pumpfun-endpoints.md) |
| `ASIMOG_MODE` | `paper` | runtime |
| `DATABASE_URL` | `postgres://asimog@127.0.0.1:54329/asimog` | runtime |
| `CORE_PORT` | `7400` | runtime |
| `RELAY_PORT` | `7401` | runtime |
| `SESSIONS` | `3` | scale knobs: sized for a small VM by default |
| `FEED_POLL_MS` | `3000` | scale knobs: sized for a small VM by default |
| `WATCH_MAX_COINS` | `60` | scale knobs: sized for a small VM by default |
| `JEV_TOKENS_PER_HOUR` | `1500000` | scale knobs: sized for a small VM by default |
| `JEV_CONCURRENCY` | `4` | scale knobs: sized for a small VM by default |
| `TAPE_BATCH_MS` | `100` | scale knobs: sized for a small VM by default |
| `JEV_QUEUE_MAX` | `64` | scale knobs: sized for a small VM by default |
| `JEV_MAX_AGE_S` | `60` | scale knobs: sized for a small VM by default |
| `DB_POOL` | `8` | scale knobs: sized for a small VM by default |
| `WAVE_N` | `3` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `WAVE_HORIZON_MIN` | `5` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `ECHO_WINDOW_MIN` | `10` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `OUTCOME_HORIZONS_MIN` | `1,3,5` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `HORIZON_FAST_MIN` | `3` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `HORIZON_MEDIUM_MIN` | `10` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `HORIZON_SLOW_MIN` | `30` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `ENTRY_WINDOW_MIN` | `10` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `ALLOCATE_EVERY_S` | `120` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `EVOLVE_EVERY_S` | `120` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `RETIRE_IDLE_MIN` | `120` | compressed horizons (docs/PIPELINE.md, docs/STRATEGY.md): minutes, not hours |
| `GHOST_BOOK_SOL` | `0.2` | paper desk (docs/STRATEGY.md) |
| `POOL_MAX` | `128` | paper desk (docs/STRATEGY.md) |
| `FILL_LATENCY_MEDIAN_MS` | `1500` | paper desk (docs/STRATEGY.md) |
| `FILL_FAIL_P` | `0.05` | paper desk (docs/STRATEGY.md) |
| `PRIORITY_FEE_SOL` | `0.00005` | paper desk (docs/STRATEGY.md) |
| `ATA_RENT_SOL` | `0.00203928` | paper desk (docs/STRATEGY.md) |
| `INDEX_WINDOW_DAYS` | `30` | Index (docs/PIPELINE.md): a 30-day window with a 7-day half-life (fix plan 2.2; the 1-day slice of 2026-10-17 is retired) |
| `INDEX_CALLOUT_DAYS` | `30` | Index (docs/PIPELINE.md): a 30-day window with a 7-day half-life (fix plan 2.2; the 1-day slice of 2026-10-17 is retired) |
| `INDEX_HALF_LIFE_DAYS` | `7` | Index (docs/PIPELINE.md): a 30-day window with a 7-day half-life (fix plan 2.2; the 1-day slice of 2026-10-17 is retired) |
| `INDEX_SEED_HOURS` | `24` | Index (docs/PIPELINE.md): a 30-day window with a 7-day half-life (fix plan 2.2; the 1-day slice of 2026-10-17 is retired) |
| `LLM_STUB` | `0` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `EMBEDDING_PROVIDER` | `openai` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `EMBEDDING_BASE_URL` | `${LLM_BASE_URL}` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `EMBEDDING_MODEL` | ` ` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `EMBEDDING_API_KEY` | ` ` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `LLM_USD_HOUR_EMBED` | `0.05` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `EMBEDDING_PRICE_PER_M` | `0.02` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `LLM_USD_HOUR_SYNTH` | `0.2` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `LLM_USD_HOUR_SWARM` | `0.5` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `LLM_USD_HOUR_EXTRACT` | `0.1` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `LLM_USD_HOUR_THINK` | `0.2` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `LLM_USD_HOUR_OPS` | `0.1` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `LLM_PRICE_IN_PER_M` | `0.032` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `LLM_PRICE_OUT_PER_M` | `0.144` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `MCP_PORT` | `7403` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `MCP_URL` | `http://127.0.0.1:${MCP_PORT}/mcp` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `BETTAFISH_PRESET` | `lite` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `SWARM_PRESET` | `lite` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `SIGNER_HOST` | `127.0.0.1` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `SIGNER_PORT` | `7410` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `SIGNER_MAX_ORDER_SOL` | `0.05` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `SIGNER_MAX_PRIORITY_LAMPORTS` | `200000` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `SIGNER_RATE_PER_MIN` | `30` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `FUN_BLOCK_URL` | `https://fun-block.pump.fun` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `SWEEP_EVERY_MIN` | `10` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `RECONCILE_EVERY_MIN` | `60` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `KILL_SIGNER_REFUSALS` | `3` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `KILL_REFUSAL_WINDOW_MIN` | `10` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `KILL_FEED_GAP_MIN` | `5` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `NEXT_PUBLIC_EXPLORER_TX_URL` | ` ` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `POSTMORTEM_MISSED_MULT` | `2` | slow mind (docs/OPS.md, docs/SYSTEM.md): one key per lane in .env.local; LLM_STUB=1 runs everything offline |
| `SLOW_BRIDGE_PORT` | `7404` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `BETTAFISH_PORT` | `7412` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MIROSHARK_PORT` | `7411` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `BETTAFISH_URL` | `http://127.0.0.1:${BETTAFISH_PORT}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MIROSHARK_URL` | `http://127.0.0.1:${MIROSHARK_PORT}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `BETTAFISH_DB_URL` | `postgresql://slow_reader@127.0.0.1:54329/asimog` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `NEO4J_URI` | `bolt://127.0.0.1:7687` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `NEO4J_USER` | `neo4j` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `NEO4J_HEAP` | `512m` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `LLM_KEY_SYNTH` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `LLM_KEY_SWARM` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `LLM_FALLBACK_KEY` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `INSIGHT_ENGINE_API_KEY` | `${LLM_KEY_SYNTH}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `INSIGHT_ENGINE_BASE_URL` | `${LLM_BASE_URL}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `INSIGHT_ENGINE_MODEL_NAME` | `${LLM_MODEL_CHEAP}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `QUERY_ENGINE_API_KEY` | `${LLM_KEY_SYNTH}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `QUERY_ENGINE_BASE_URL` | `${LLM_BASE_URL}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `QUERY_ENGINE_MODEL_NAME` | `${LLM_MODEL_CHEAP}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MEDIA_ENGINE_API_KEY` | `${LLM_KEY_SYNTH}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MEDIA_ENGINE_BASE_URL` | `${LLM_BASE_URL}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MEDIA_ENGINE_MODEL_NAME` | `${LLM_MODEL_CHEAP}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `REPORT_ENGINE_API_KEY` | `${LLM_KEY_SYNTH}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `REPORT_ENGINE_BASE_URL` | `${LLM_BASE_URL}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `REPORT_ENGINE_MODEL_NAME` | `${LLM_MODEL_CHEAP}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `FORUM_HOST_API_KEY` | `${LLM_KEY_SYNTH}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `FORUM_HOST_BASE_URL` | `${LLM_BASE_URL}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `FORUM_HOST_MODEL_NAME` | `${LLM_MODEL_SMART}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `KEYWORD_OPTIMIZER_API_KEY` | `${LLM_KEY_SYNTH}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `KEYWORD_OPTIMIZER_BASE_URL` | `${LLM_BASE_URL}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `KEYWORD_OPTIMIZER_MODEL_NAME` | `${LLM_MODEL_CHEAP}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SEARCH_TOOL_TYPE` | `AsimogMedia` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `QUERY_SEARCH` | `tavily,x` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `TAVILY_API_KEY` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `X_BEARER_TOKEN` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MAX_PARAGRAPHS` | `4` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MAX_REFLECTIONS` | `1` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `LLM_PROVIDER` | `openai` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `LLM_API_KEY` | `${LLM_KEY_SWARM}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `LLM_MODEL_NAME` | `${LLM_MODEL_CHEAP}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SMART_MODEL_NAME` | `${LLM_MODEL_CHEAP}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `WONDERWALL_MODEL_NAME` | `${LLM_MODEL_CHEAP}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `NER_MODEL_NAME` | `${LLM_MODEL_CHEAP}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `WEB_SEARCH_MODEL` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_PLATFORMS` | `pumpfun,twitter` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_TWITTER_RECSYS` | `random` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_GRAPH_FEATURES` | `minimal` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_REPORT` | `agent` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `CORE_MCP_URL` | `${MCP_URL}` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_CORE_TOKEN` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_AGENT_TOOLS_ENABLED` | `true` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_PERSONA_TOOLS` | `coin_dossier,reports_for` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SENSE_REPLIES` | `true` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `REPLY_POLL_S` | `60` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `REPLY_WINDOW_H` | `6` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `REPLY_CALLOUTS_PER_MIN` | `20` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SENSE_MEDIA` | `true` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MEDIA_PER_MIN` | `30` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MEDIA_MAX_BYTES` | `2000000` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MEDIA_HOSTS` | `socialimages.pump.fun,pump.mypinata.cloud,ipfs.io` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MEDIA_IPFS_GATEWAY` | `https://pump.mypinata.cloud` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `PUMP_API_URL` | `https://frontend-api-v3.pump.fun` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_TOKEN_SYNTH` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_TOKEN_SWARM` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_TOKEN_EXCHANGE` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_TOKEN_OPS` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_TOKEN_POSTMORTEM` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_TOKEN_RESEARCHER` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_TOKEN_REPORTER` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_TOKEN_INTEGRITY` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `MCP_TOKEN_LIBRARIAN` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `BETTAFISH_FEED_EVERY_MIN` | `30` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `BETTAFISH_FEED_WINDOW_MIN` | `60` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `BETTAFISH_COIN_RUNS_PER_HOUR` | `6` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_CHAIN` | `parallel` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_CHAIN_WAIT_S` | `300` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_RUN_TIMEOUT_S` | `1800` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_POLL_MS` | `3000` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_TICK_S` | `30` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_SCHEDULE_S` | `5` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_DEFER_MAX_MIN` | `90` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `BETTAFISH_WORKER_TOKEN` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_WORKER_TOKEN` | ` ` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `BETTAFISH_MAX_CONCURRENT` | `2` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_MAX_CONCURRENT` | `1` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_RUNS_PER_HOUR` | `6` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_STAGE1_USD_PER_RUN` | `0.005` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_STAGE2_USD_PER_RUN` | `0.03` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_STAGE3_USD_PER_RUN` | `0.10` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_USD_PER_DAY` | `0.50` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `ESC_P_LOW` | `0.35` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `ESC_P_HIGH` | `0.65` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `ESC_DISAGREE` | `0.3` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `HOT_SET_SIZE` | `5` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `HOT_SET_EVERY_S` | `90` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `ESC_RECHECK_MIN` | `10` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `ESC_CALLOUT_S` | `60` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SLOW_COIN_WINDOW_MIN` | `10` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SOL_USD` | `150` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `BETTAFISH_SENTIMENT` | `on` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_HORIZON_MIN` | `120` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `SWARM_WAVE_CALLERS` | `5` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `STANCE_HORIZON_MIN` | `60` | slow mind (docs/SLOW-MIND.md): BettaFish and MiroShark engines in services/*/engine, Slow Bridge, stack in docker-compose.yml |
| `CALLERS_ACTIVE_MAX` | `200` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `DNA_HORIZON_MIN` | `5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `HAWKES_ALPHA` | `0.6` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `HAWKES_BETA_PER_MIN` | `0.3333333333` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `HAWKES_MC_PATHS` | `300` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `HAWKES_MU_PER_MIN` | `0.01` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `CURVE_REAL_TOK0` | `793100000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `CURVE_V_SOL0` | `30` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `CURVE_V_TOK0` | `1073000000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FEE_BPS` | `125` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SMART_WINDOW_MIN` | `5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `PRECALL_HORIZON_MIN` | `5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `PRECALL_PEAK_MULT` | `1.2` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `PRECALL_PRIOR_N` | `4` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `TX_RPC_TIMEOUT_MS` | `10000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `TRADER_CONFIRM_MS` | `30000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `TRADER_GIVE_UP_MS` | `120000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `TRADER_HEADROOM_LAMPORTS` | `100000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `TRADER_RENT_ALLOWANCE_LAMPORTS` | `2100000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `TRADER_RETRY_BASE_MS` | `2000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `TRADER_SELL_ATTEMPTS` | `5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_MIN_AGE_MIN` | `30` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_MIN_COINS` | `8` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_MIN_COINS_SEED` | `3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_ROUND_TRIP_COST` | `0.03` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_SMART_MAX` | `500` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_SNIPER_SHARE` | `0.5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_COPY_LAG_S` | `30` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_COPIER_SHARE` | `0.5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_BUNDLER_COINS` | `2` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `CREATOR_PAST_MIN` | `60` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `CREATOR_RUG_FRAC` | `0.3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FUNDER_LOOKUPS_PER_RUN` | `50` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `BUNDLE_SLOTS` | `3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_COIN_IDLE_MIN` | `30` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_MAX_COINS` | `3000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `RPC_MAX_TRIES` | `6` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `RPC_RPS` | `5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `RPC_TIMEOUT_MS` | `8000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `DOCTOR_CONSUMER_LAG_S` | `300` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `DOCTOR_HEAD_STALL_S` | `120` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `W_COMMENT` | `2` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `W_LIKE` | `1` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `W_SHARE` | `3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `EVAL_MIN_MS` | `5000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `REENTRY_COOLDOWN_S` | `60` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SWEEP_MS` | `5000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `EVOLVE_MIN_DISTANCE` | `0.05` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `EVOLVE_NICHE_MAX` | `12` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `EVOLVE_OFFSPRING` | `16` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `EVOLVE_PARENT_MIN_TRADES` | `2` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `RETIRE_DD_FRAC` | `0.3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `RETIRE_MIN_TRADES` | `50` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `AMM_FEE_BPS` | `125` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FILL_LATENCY_SIGMA` | `0.5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FILL_STALE_MS` | `30000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KERNEL_CAP_FULL` | `0.25` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KERNEL_CAP_PROBE` | `0.05` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KERNEL_HURDLE` | `0` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KERNEL_PRIOR_MEAN` | `-0.01` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KERNEL_PRIOR_N` | `5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KERNEL_PRIOR_SD` | `0.25` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `CALIB_MIN_PER_BIN` | `20` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KELLY_CAP` | `0.25` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `TERM_MIN_CONF` | `0.3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `PROMOTE_FULL_EXTRA_TRADES` | `20` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `PROMOTE_HOLDOUT_FRAC` | `0.3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `PROMOTE_MAX_DD_FRAC` | `0.3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `PROMOTE_MIN_TRADES` | `30` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `JEV_CALLOUT_MIN_FOLLOWERS` | `0` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `JEV_TIMEOUT_MS` | `4000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `HOLDERS_DELAY_S` | `15` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_REFRESH_MIN` | `60` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SCOUT` | `true` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SENSE_BACKFILL` | `true` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SENSE_CHAIN` | `true` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SENSE_FEED` | `true` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `ARCHIVER` | `true` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `S3_ENDPOINT` | ` ` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `S3_ACCESS_KEY_ID` | ` ` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `S3_SECRET_ACCESS_KEY` | ` ` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `STATS_EVERY_MS` | `30000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `ENTRY_STALE_S` | `60` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `OUTCOME_GRACE_S` | `60` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `OUTCOME_REF_SOL` | `0.02` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SCORE_EVERY_S` | `60` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SCORE_WINDOW_DAYS` | `30` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `RPC_BACKFILL_SIGS` | `200` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `RPC_BACKFILL_TX_PER_HOUR` | `3000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `WATCH_HOURS` | `6` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FEED_BACKFILL_MIN` | `30` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FEED_BACKFILL_PAGES` | `40` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FEED_GAP_PAGES` | `10` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FEED_PAGE_SIZE` | `50` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FEED_PUSH` | `true` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `FILTER_SAMPLE_PCT` | `1` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_CALLOUT_PAGES` | `30000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `INDEX_CALLOUT_PAGE_MS` | `2000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SCOUT_CALLERS_REFRESH_S` | `60` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SCOUT_HEAT_BUYERS` | `8` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SCOUT_HEAT_NET_SOL` | `1.5` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SCOUT_MIN_BUYERS` | `10` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SCOUT_MIN_MCAP_USD` | `4000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SCOUT_HOT_WALLETS` | `5000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KILL_FILL_DRIFT_FILLS` | `3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KILL_FILL_DRIFT_WINDOW_MIN` | `60` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `KILL_FILL_DRIFT_X` | `3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `PROOF_MEMO` | `true` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `SWEEP_FEE_RESERVE_LAMPORTS` | `20000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `AGENT_RUNWAY_SOL` | `0` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `TRADER_RETRY_EVERY_MS` | `2000` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `MANDATE_SOL` | `0.2` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `RELAY_DB_POOL` | `3` | defaults that lived in code until fix plan 2.1; each key has one default, here |
| `RELAY_POLL_MS` | `400` | defaults that lived in code until fix plan 2.1; each key has one default, here |
