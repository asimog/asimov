# MiroShark Railway Deployment Plan

## Goal
MiroShark als Railway-Staging-Service deploybar machen

## Ziel
Bereite das hochgeladene MiroShark Repository als separaten Backend-Service fuer Bazodiac Pattern Analysis vor. Der Service soll als Railway-Staging-Instanz laufen, eine stabile `MIROSHARK_API_BASE_URL` liefern und spaeter nur serverseitig vom Bazodiac Scenario Orchestrator aufgerufen werden. Ziel ist ein realer Smoke-/MVP-Test mit persistierbarer Anbindung, nicht ein weiterer Mock-only Spike.

## Scope
Zielbranch `feat/railway-miroshark-api-staging`. Bearbeite Deployment-, Backend-Start-, Security- und Dokumentationsdateien im MiroShark Repo: `Dockerfile`, `railway.json`, `backend/run.py`, `backend/app/__init__.py`, `backend/tests/*`, `.env.example`, `README_DEPLOYMENT.md`, `RAILWAY_VARIABLES.md`, `docs/smoke-scenario-seed.md`. MiroShark bleibt ein eigener Backend-Service; Supabase und Bazodiac Pattern Orchestrator bleiben externe Systeme.

## Bedingungen (hart)
- Keine Secrets, API Keys, Tokens oder Service Role Keys ins Repo schreiben.
- MiroShark darf nicht direkt vom Browser genutzt werden; spaeterer Zugriff nur ueber serverseitigen Bazodiac Scenario Orchestrator.
- `/health` bleibt ohne Auth erreichbar; teure oder mutierende `/api/*` Routen werden durch einen internen Header geschuetzt.
- App muss Railway `PORT` verwenden und `FLASK_PORT` nur als Fallback behalten.
- Kein lokales Ollama-32B-Setup fuer den ersten Railway-Staging-Schnitt erzwingen.

## Akzeptanzkriterien
- Railway kann aus dem Repo per Dockerfile einen Backend-only Service bauen.
- `/health` liefert HTTP 200 in lokalem Container und nach Railway Deployment.
- API-Request ohne `x-miroshark-internal-key` auf geschuetzte `/api/*` Routen liefert 401; mit korrektem Key erreicht er die Route.
- `railway.json`, `.env.example`, `RAILWAY_VARIABLES.md` und `README_DEPLOYMENT.md` sind konsistent.
- Ein dokumentierter Smoke-Test erreicht mindestens `/health` und versucht `POST /api/graph/ontology/generate` mit einem nicht-personenbezogenen Seed.
- MVP-Test mit 2-3 Runden und Deep-Test mit 5 Runden sind dokumentiert, werden aber nicht automatisch beim Deployment gestartet.

## Explizit out-of-scope
- Keine direkte Supabase-Anbindung in MiroShark.
- Keine Produktiv-User-Auth oder Bazodiac-Session-Integration.
- Kein Deployment des MiroShark-Frontend als Ziel des Staging-Service.
- Keine Queue-/Worker-Architektur im ersten Schnitt.
- Keine automatischen Deep-Runs beim Service-Start.

## Done-Definition
Der Branch enthaelt einen Railway-deploybaren, backend-fokussierten MiroShark Service mit Auth-Guard, PORT-Fix, Healthcheck, Deployment-Doku, Variablencheckliste, Smoke-Seed, MVP/Deep-Test-Protokoll und Tests fuer kritische Guards.

## Task Status
- TASK-001: Create repo deployment baseline [completed]
- TASK-002: Make backend runtime Railway-port compatible [completed]
- TASK-003: Convert Docker deployment to backend-only staging [completed]
- TASK-004: Add internal API auth guard [completed]
- TASK-005: Prepare Railway variables and environment templates [completed]
- TASK-006: Add synthetic smoke seed [completed]
- TASK-007: Local container smoke test [completed]
- TASK-008: Prepare Railway deployment runbook [completed]
- TASK-009: Execute live smoke test after Railway deploy [pending - requires Railway deployment]
- TASK-010: Prepare MVP and Deep test protocol [completed]
