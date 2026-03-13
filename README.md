# Shelfy

Phase 2 backend foundation for the AI-assisted Home Library Manager, including JWT auth.

## Quick start

```bash
cp .env.example .env
cd infra
docker compose up -d
```

## Backend auth setup

Set these environment variables in `.env` before starting the backend:

- `JWT_SECRET_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SEED_ADMIN_ON_STARTUP=true` (optional auto-seed)
- `CORS_ALLOWED_ORIGINS=["http://localhost:5173"]` (JSON array for allowed frontend origins)

Manual admin seed command:

```bash
cd backend
python -m app.cli.seed_admin
```

## Services

- Backend API health: http://localhost:8000/health
- Backend readiness: http://localhost:8000/health/ready
- Auth login: `POST /api/v1/auth/login`
- Frontend: http://localhost:5173
- MinIO Console: http://localhost:9001
