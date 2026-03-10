# Shelfy

Phase 1 repository skeleton for the AI-assisted Home Library Manager.

## Quick start

```bash
cp .env.example .env
cd infra
docker compose up -d
```

## Services

- Backend API: http://localhost:8000/health
- Backend readiness: http://localhost:8000/health/ready
- Frontend: http://localhost:5173
- MinIO Console: http://localhost:9001
