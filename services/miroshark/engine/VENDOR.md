# MiroShark (vendor)

Upstream: `aaronjmars/MiroShark@621e07f` (AGPL-3.0), see `UPSTREAM`. Outside code: lint and default search skip this tree (`biome.json`, `/.ignore`), except the files below. Read this file before opening anything else here. Upstream's agent guide is kept as `UPSTREAM-CLAUDE.md` (renamed from `CLAUDE.md` so coding agents do not load it as instructions for Asimog work).

## Ours

| File | Role |
|---|---|
| `backend/asimog_worker.py` | HTTP worker the Slow Bridge calls for swarm runs. Requires `SWARM_WORKER_TOKEN` on every route but health, checks each request, refuses a known job id (409) and runs past `SWARM_MAX_CONCURRENT` (429), cancels (`DELETE`), meters spend against `usd_cap`, fences the dossier's callout text, coin name, handles and BettaFish report text, and reduces the symbol to a plain ticker |
| `backend/asimog_graph.py` | Graph storage adapter |
| `backend/asimog_report.py` | Swarm report writer (SIMULATED) |
| `backend/wonderwall/simulations/pumpfun/` | The Pump.fun simulation (platform, actions, prompts, environment) |

## Upstream files we patched (marked `asimog` in a comment)

`backend/app/config.py`, `backend/app/services/agent_mcp_tools.py`, `backend/scripts/cross_platform_digest.py`, `backend/scripts/market_media_bridge.py`, `backend/scripts/mcp_agent_bridge.py`; `CLAUDE.md` renamed to `UPSTREAM-CLAUDE.md`. Edit nothing else upstream; a new patch is listed here in the same change.

## When to open upstream

Only to see how a simulation step really works before changing an adapter or a patch. MiroShark reads the firm only through core's MCP tools. Search it on purpose:

```bash
rg --no-ignore <pattern> services/miroshark/engine/
```

How the engines fit the firm: `docs/SLOW-MIND.md`. Tests: `npm run e2e -- miroshark-pumpfun` (slow tier).
