# MVP and Deep Test Protocol

## Overview
This document defines the MVP and Deep test protocols for validating the MiroShark Railway deployment for Bazodiac Pattern Analysis integration.

## Test Environment

### Prerequisites
- Railway service deployed and accessible
- `MIROSHARK_INTERNAL_KEY` configured
- Neo4j database connected
- LLM provider configured
- Synthetic test data seeded (optional but recommended)

### Test Credentials
- Railway service URL: `https://<service-name>.railway.app`
- Internal API key: `MIROSHARK_INTERNAL_KEY` (from Railway environment variables)

## MVP Test Protocol

### Objective
Validate basic API functionality with minimal data (2-3 rounds of simulation).

### Test Rounds
Execute 2-3 simulation rounds with the following scenarios:

#### Round 1: Basic Ontology Generation
**Goal**: Test graph generation with minimal entities

**Test Data**:
- Use synthetic seed data or minimal manual seed
- 2-3 entities (e.g., "Person A", "Organization B", "Project C")
- 1-2 relationships (e.g., "Person A WORKS_FOR Organization B")

**API Call**:
```bash
curl -X POST https://<service-url>.railway.app/api/graph/ontology/generate \
  -H "x-miroshark-internal-key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "entities": ["Person A", "Organization B"],
    "context": "Person A works for Organization B"
  }'
```

**Expected Results**:
- HTTP 200 or 400 (for missing fields)
- Response contains ontology structure
- No authentication errors
- Response time < 30 seconds

#### Round 2: Simulation Lifecycle
**Goal**: Test simulation creation and retrieval

**API Call**:
```bash
curl -X POST https://<service-url>.railway.app/api/simulation/create \
  -H "x-miroshark-internal-key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "scenario": "Test scenario for Bazodiac integration",
    "agents": [
      {"name": "Agent 1", "type": "person"},
      {"name": "Agent 2", "type": "organization"}
    ],
    "max_rounds": 3
  }'
```

**Expected Results**:
- HTTP 200 or 400 (for missing fields)
- Returns simulation ID
- Simulation can be retrieved via GET endpoint
- No authentication errors

#### Round 3: Report Generation (Optional)
**Goal**: Test report generation with minimal data

**API Call**:
```bash
curl -X POST https://<service-url>.railway.app/api/report/generate \
  -H "x-miroshark-internal-key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "simulation_id": "<from-round-2>",
    "report_type": "summary"
  }'
```

**Expected Results**:
- HTTP 200 or 400 (for missing fields)
- Returns report structure
- No authentication errors

### MVP Success Criteria
- [ ] All 2-3 rounds complete without authentication errors
- [ ] API responses are well-formed JSON
- [ ] Response times are acceptable (< 30 seconds)
- [ ] No 500-level errors
- [ ] Health endpoint remains accessible throughout

## Deep Test Protocol

### Objective
Validate comprehensive API functionality with realistic data (5 rounds of simulation).

### Test Rounds
Execute 5 simulation rounds with increasing complexity:

#### Round 1: Simple Network
**Entities**: 3-5 entities, 2-3 relationships
**Context**: "Team structure for a small project"
**Expected**: Basic graph generation, simulation completes successfully

#### Round 2: Medium Network
**Entities**: 5-8 entities, 4-6 relationships
**Context**: "Department structure in a medium company"
**Expected**: Graph generation with more complex relationships, simulation completes

#### Round 3: Complex Network
**Entities**: 8-12 entities, 7-10 relationships
**Context**: "Multi-department organization with cross-functional teams"
**Expected**: Complex graph generation, simulation completes, reasonable runtime

#### Round 4: Edge Case - Empty Input
**Entities**: 0 entities
**Context**: Empty string or minimal context
**Expected**: Graceful error handling, appropriate error message

#### Round 5: Edge Case - Large Network
**Entities**: 15-20 entities, 12-15 relationships
**Context**: "Large enterprise organization structure"
**Expected**: Graph generation completes (may take longer), simulation completes

### Deep Test Execution

#### Manual Trigger
Deep tests are manually triggered to avoid automated load on the service.

#### Test Data Preparation
For each round, prepare appropriate test data:
- Use synthetic seed script to create base entities
- Add specific entities for each round's scenario
- Document entity names and relationships used

#### API Calls
Use the same API endpoints as MVP tests, but with more complex data:

```bash
# Example for Round 3 (Complex Network)
curl -X POST https://<service-url>.railway.app/api/graph/ontology/generate \
  -H "x-miroshark-internal-key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "entities": ["Engineering", "Product", "Sales", "Marketing", "HR", "Finance", "CTO", "CEO"],
    "context": "Multi-department organization with cross-functional teams"
  }'
```

#### Monitoring
For each round, monitor:
- Response time
- Memory usage (via Railway dashboard)
- Error logs
- Neo4j query performance

### Deep Test Success Criteria
- [ ] All 5 rounds complete without crashes
- [ ] Response times are acceptable (< 60 seconds for complex rounds)
- [ ] No memory leaks observed
- [ ] Neo4j queries complete successfully
- [ ] LLM API calls complete successfully
- [ ] No authentication errors
- [ ] Health endpoint remains accessible throughout

## Test Execution Checklist

### Pre-Test
- [ ] Railway service is running
- [ ] Health endpoint returns 200
- [ ] `MIROSHARK_INTERNAL_KEY` is set
- [ ] Neo4j database is accessible
- [ ] LLM provider is configured
- [ ] Synthetic test data is seeded (optional)

### During Test
- [ ] Monitor Railway service logs
- [ ] Track response times for each round
- [ ] Document any errors or warnings
- [ ] Verify authentication is working correctly

### Post-Test
- [ ] Clean up synthetic test data
- [ ] Document test results
- [ ] Report any issues found
- [ ] Update runbook if needed

## Error Handling

### Common Issues

#### Authentication Errors (401)
- **Cause**: Missing or incorrect `MIROSHARK_INTERNAL_KEY`
- **Resolution**: Verify Railway environment variable is set correctly

#### Service Unavailable (503)
- **Cause**: `MIROSHARK_INTERNAL_KEY` not set in production mode
- **Resolution**: Set `MIROSHARK_INTERNAL_KEY` in Railway environment variables

#### LLM API Errors
- **Cause**: Invalid API key or rate limiting
- **Resolution**: Verify LLM provider configuration and API key

#### Neo4j Connection Errors
- **Cause**: Database unreachable or credentials incorrect
- **Resolution**: Verify Neo4j URI, user, and password

#### Timeout Errors
- **Cause**: Complex queries taking too long
- **Resolution**: Monitor performance, consider simplifying test data

## Test Reporting

### MVP Test Report
Document:
- Test date and time
- Railway service URL
- Number of rounds executed
- Success/failure status for each round
- Response times
- Any errors encountered
- Overall assessment

### Deep Test Report
Document:
- Test date and time
- Railway service URL
- Number of rounds executed (5)
- Success/failure status for each round
- Response times for each round
- Memory usage observations
- Any errors encountered
- Performance trends
- Overall assessment

## Continuous Testing

### Regression Testing
After each deployment:
1. Run MVP test protocol
2. If MVP tests pass, consider running Deep test protocol
3. Document results

### Scheduled Testing
Consider scheduling:
- Daily health checks (automated via Railway healthcheck)
- Weekly MVP tests (manual)
- Monthly Deep tests (manual)

## Rollback Criteria

### If Tests Fail
- If MVP tests fail: Block deployment until fixed
- If Deep tests fail: Investigate but may proceed with deployment if critical functionality works
- If authentication fails: Block deployment until fixed
- If health check fails: Block deployment until fixed

### Rollback Process
1. Revert to previous working deployment
2. Investigate failure cause
3. Fix issue
4. Re-run tests
5. Deploy fixed version

## Appendix: Test Scripts

### Automated MVP Test Script
```bash
#!/bin/bash
# MVP test script
export SMOKE_TEST_URL=https://<service-url>.railway.app
export MIROSHARK_INTERNAL_KEY=<your-key>

# Run smoke test
python scripts/smoke_test.py

# Run synthetic seed
python scripts/synthetic_seed.py

# Run MVP test rounds
# (Add specific API calls for each round)
```

### Manual Deep Test Script
```bash
#!/bin/bash
# Deep test script
export SMOKE_TEST_URL=https://<service-url>.railway.app
export MIROSHARK_INTERNAL_KEY=<your-key>

# Run smoke test
python scripts/smoke_test.py

# Run synthetic seed
python scripts/synthetic_seed.py

# Run Deep test rounds (manual execution)
# (Execute each round manually with monitoring)
```

## References
- Railway Deployment Runbook: `docs/plans/2026-05-24-railway-deployment-runbook.md`
- Deployment Overview: `README_DEPLOYMENT.md`
- Implementation Plan: `docs/plans/2026-05-24-miroshark-railway-deployment.md`
