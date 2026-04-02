# Production Readiness Snapshot — 2026-04-02

## Status
Conditionally ready for homelab/private production.

## Implemented
- Bulk operations and ordering logic hardened (detail, bulk, DnD).
- Unassigned pagination fixed server-side.
- CI hardening: frontend build + smoke/regression e2e gates.
- Incident runbook and monitoring/alerting docs created.
- Frontend runtime telemetry pipeline added (browser -> backend metric/log).
- Ordering integrity guard introduced (partial unique index).
- Integrity and bundle budget checker scripts added.

## Remaining recommendations (non-blocking for private use)
1. Add alert delivery channel integration (Alertmanager route to Telegram/Slack).
2. Expand e2e matrix for scan-provider timeout and retry edge-cases.
3. Reduce main frontend bundle via route-level code splitting.

## Operational commands

```bash
# Apply migrations
cd backend && alembic upgrade head

# Check ordering integrity
DATABASE_URL=... python scripts/check_shelf_ordering_integrity.py

# Frontend build + budget
cd frontend && npm run build
node ../scripts/check_bundle_budget.mjs
```
