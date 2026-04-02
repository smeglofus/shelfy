# Production Readiness Audit — 2026-04-02

## Verdict
Conditionally ready for homelab/private production. Not yet ready for broader public rollout without stronger release guardrails.

## Hard blockers before broader production
1. CI release gate must include frontend build + deterministic smoke E2E checks for critical flows.
2. DnD and select-mode regressions need explicit regression tests.
3. Ordering consistency must be guarded at data layer and continuously validated.
4. Incident runbook and rollback procedure must be documented and practiced.
5. Runtime error telemetry needs a baseline (frontend + backend).

## Implemented in this phase
- Added frontend build gate to CI.
- Added dedicated Playwright smoke/regression suite for critical UI routes.
- Added incident runbook for common failures.

## Next phases
- Add DB-level ordering guard strategy + migration plan.
- Add synthetic health probes (books, bookshelf, scan) and alerting thresholds.
- Add bundle budget enforcement in CI and lazy-chunking improvements.
