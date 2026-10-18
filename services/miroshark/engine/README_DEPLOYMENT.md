# MiroShark Railway Deployment Documentation

## Overview
This document describes the deployment of MiroShark as a Railway Staging Service for Bazodiac Pattern Analysis.

## Deployment Baseline

### Current State Analysis

**Dockerfile (`Dockerfile`)**
- Currently installs both Node.js and Python dependencies
- Copies frontend and backend source code
- Exposes ports 3000 (frontend) and 5001 (backend)
- Starts both frontend and backend via `npm run dev` (development mode)
- Uses Python 3.11 base image with uv for Python dependency management

**Railway Configuration (`railway.json`)**
- Uses Dockerfile builder
- Points to root `Dockerfile`
- Has restart policy ON_FAILURE with 5 retries
- **Missing**: Healthcheck path configuration

**Backend Runtime (`backend/run.py`)**
- Uses `FLASK_PORT` environment variable with default 5001
- Does NOT prefer Railway's injected `PORT` environment variable
- Host defaults to `0.0.0.0`
- No Railway-specific port handling

**Flask Application (`backend/app/__init__.py`)**
- Health check endpoint: `GET /health` (returns JSON with status)
- CORS enabled for `/api/*` routes
- Multiple API blueprints registered:
  - `/api/graph` - graph operations
  - `/api/simulation` - simulation lifecycle
  - `/api/report` - report generation
  - `/api/templates` - template management
  - `/api/settings` - settings management
  - `/api/observability` - observability endpoints
  - `/api/mcp` - MCP integration
  - `/api/countries` - demographic data
  - `/api/docs` - OpenAPI documentation
  - `/api/feed` - syndication feeds
  - `/share` - public share pages
  - `/watch` - spectator watch pages
  - `/sitemap` - SEO sitemap
  - `/api/notifications` - notification config
- **Missing**: Internal API authentication guard

**Environment Variables (`.env.example`)**
- Comprehensive LLM/Embedding provider configuration
- Neo4j connection settings
- Admin authentication for mutation endpoints
- Multiple notification channels (webhook, Discord, Slack, email, Telegram)
- **Missing**: Railway-specific internal API key variable

### Key Issues Identified

1. **Port Configuration**: Backend does not prefer Railway's `PORT` environment variable
2. **Deployment Mode**: Dockerfile runs dev mode with frontend, not production backend-only
3. **Security**: No internal API authentication guard for expensive operations
4. **Healthcheck**: Railway configuration lacks healthcheck path
5. **Documentation**: No Railway-specific deployment guide

## Target Architecture

```
Bazodiac Pattern Prototype
  -> Next.js Scenario Orchestrator
     -> MIROSHARK_API_BASE_URL
        -> MiroShark Railway API Service
           -> Neo4j
           -> LLM Provider
           -> Embedding Provider
```

## Deployment Plan

### Phase 1: Runtime-Port and Backend-only Start
- Modify `backend/run.py` to prefer Railway `PORT`
- Create `Dockerfile.railway` for backend-only deployment
- Update `railway.json` with healthcheck path

### Phase 2: Internal API Auth Guard
- Add `before_request` authentication middleware
- Protect expensive `/api/*` routes with `x-miroshark-internal-key` header
- Keep `/health` endpoint public
- Write unit tests for auth guard

### Phase 3: Variables and Provider Config
- Create `RAILWAY_VARIABLES.md` with required variables checklist
- Update `.env.example` with Railway-specific placeholders
- Document provider fallbacks for staging

### Phase 4: Local Container Smoke Test
- Build staging Docker image
- Test `/health` endpoint
- Test auth guard behavior
- Document any blockers

### Phase 5: Railway Staging Deploy
- Deploy to Railway Staging
- Capture `MIROSHARK_API_BASE_URL`
- Verify healthcheck
- Document deployment results

### Phase 6: Smoke and MVP Tests
- Execute smoke test with synthetic seed
- Document MVP test protocol (2-3 rounds)
- Document Deep test protocol (5 rounds, manual trigger)

## Acceptance Criteria

- [ ] Railway can build backend-only service from Dockerfile
- [ ] `/health` returns HTTP 200 locally and on Railway
- [ ] API requests without `x-miroshark-internal-key` return 401
- [ ] API requests with correct header succeed
- [ ] All configuration files are consistent
- [ ] Smoke test documented and executable
- [ ] No secrets committed to repository

## Out of Scope

- Direct Supabase integration in MiroShark
- Production user authentication
- Bazodiac session integration
- Frontend deployment as part of this service
- Queue/Worker architecture
- Automatic Deep-Test execution on service start

## Security Considerations

- No API keys, tokens, or secrets in repository
- Internal API key stored as Railway Service Variable only
- Fail-closed authentication for protected routes
- Public `/health` endpoint for monitoring
- CORS configuration for controlled access

## Testing Strategy

### Unit Tests
- Auth guard behavior
- Port resolution logic
- Existing backend tests

### Integration Tests
- Local container smoke test
- Railway deployment smoke test
- API authentication flow

### Smoke Testing Scripts
Two scripts are provided for smoke testing:

1. **Smoke Test Script** (`scripts/smoke_test.py`)
   - Tests health endpoint, protected API, and OpenAPI docs
   - Requires `SMOKE_TEST_URL` and `MIROSHARK_INTERNAL_KEY` environment variables
   - Usage:
     ```bash
     export SMOKE_TEST_URL=https://your-service.railway.app
     export MIROSHARK_INTERNAL_KEY=your-key
     python scripts/smoke_test.py
     ```

2. **Synthetic Seed Script** (`scripts/synthetic_seed.py`)
   - Creates minimal test data in Neo4j for API testing
   - Requires Neo4j connection details
   - Usage:
     ```bash
     python scripts/synthetic_seed.py  # Create test data
     python scripts/synthetic_seed.py cleanup  # Clean up test data
     ```

### Manual Tests
- MVP test (2-3 simulation rounds)
- Deep test (5 rounds, manual trigger)

## Rollback Plan

- Revert `backend/run.py` port changes
- Remove `Dockerfile.railway` if created
- Remove auth guard from `backend/app/__init__.py`
- Remove test files
- Revert `railway.json` changes
- Remove documentation files

## Next Steps

1. Execute TASK-001: Create repo deployment baseline ✅
2. Execute TASK-002: Make backend runtime Railway-port compatible
3. Execute TASK-003: Convert Docker deployment to backend-only staging
4. Execute TASK-004: Add internal API auth guard
5. Execute TASK-005: Prepare Railway variables and environment templates
6. Execute TASK-006: Add synthetic smoke seed
7. Execute TASK-007: Local container smoke test
8. Execute TASK-008: Prepare Railway deployment runbook
9. Execute TASK-009: Execute live smoke test after Railway deploy
10. Execute TASK-010: Prepare MVP and Deep test protocol
