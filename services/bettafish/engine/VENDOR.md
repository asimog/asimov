# BettaFish (vendor)

Upstream: `666ghj/BettaFish@b67928f` (GPL-2.0), see `UPSTREAM`. Outside code: lint and default search skip this tree (`biome.json`, `/.ignore`), except the files below. Read this file before opening anything else here.

## Ours

| File | Role |
|---|---|
| `asimog_worker.py` | HTTP worker the Slow Bridge calls; runs the engines, pins `slow.as_of` per run |
| `asimog_db.py` | The one read helper over the `slow.*` views (role `slow_reader`) |
| `asimog_voice.py` | Our language and voice rules added to every prompt |
| `requirements-asimog.txt` | Python dependencies for `.venv-asimog` |
| `InsightEngine/tools/pumpfun_db.py` | Insight search over our callouts (PumpfunDB) |
| `QueryEngine/tools/asimog_search.py`, `MediaEngine/tools/asimog_media.py` | Query and Media adapters |
| `ReportEngine/report_template/asimog_*.md` | Our report templates |

## Upstream files we patched (marked `asimog` in a comment)

`ForumEngine/llm_host.py`, `InsightEngine/agent.py`, `InsightEngine/llms/base.py`, `InsightEngine/tools/keyword_optimizer.py`, `InsightEngine/utils/db.py`, `MediaEngine/agent.py`, `MediaEngine/llms/base.py`, `QueryEngine/agent.py`, `QueryEngine/llms/base.py`, `ReportEngine/agent.py`, `ReportEngine/llms/base.py`, `ReportEngine/nodes/chapter_generation_node.py`. Edit nothing else upstream; a new patch is listed here in the same change.

## When to open upstream

Only to see how an engine step really works before changing an adapter or a patch. Search it on purpose:

```bash
rg --no-ignore <pattern> services/bettafish/engine/
```

How the engines fit the firm: `docs/SLOW-MIND.md`. Tests: `npm run e2e -- bettafish-insight` (slow tier), `bettafish-full` (milestone).
