# Shelfy

Shelfy is an AI-assisted home library manager focused on practical day-to-day use:
scan shelves, keep book metadata tidy, and navigate a digital twin of your physical shelves.

## What you can do (today)

- 📚 Manage books with metadata (title, author, ISBN, publisher, language, year, notes).
- 🧭 Organize books by room / furniture / shelf and reorder shelf positions.
- 📸 Scan shelf photos and review extracted books before confirming.
- ➕ Extend an existing shelf scan from a selected anchor book (append-right mode).
- 🔎 Search with typo-tolerant matching (PostgreSQL FTS + trigram similarity).
- 🎛 Filter books by reading status, language, publisher, and publication year range.
- 🧱 Open a book in the digital twin and highlight/autoscroll to its spine.
- 🔁 Background enrichment and processing via Celery workers.

---

## Architecture (high level)

![Shelfy architecture](docs/assets/architecture-diagram.svg)

- **Frontend**: React + Vite + React Query + React Router
- **Backend**: FastAPI + async SQLAlchemy + Alembic + JWT auth
- **Workers**: Celery (barcode / Gemini Vision / enrichment pipelines)
- **Data & infra**: PostgreSQL, Redis, MinIO
- **Observability**: structlog JSON logs + Prometheus metrics (`/metrics`)

---

## Quick start (Docker Compose)

```bash
cp .env.example .env
cd infra
docker compose up --build
```

When services are healthy:

- Frontend: http://localhost:5173
- Backend API docs: http://localhost:8000/docs
- Health: http://localhost:8000/health
- Metrics: http://localhost:8000/metrics
- MinIO Console: http://localhost:9001

> Note: Shelf scan quality depends on `GEMINI_API_KEY`. Without it, OCR/vision fallback is limited.

---

## Environment variables (most important)

The app reads from `.env` (see `.env.example`).

### Core runtime

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `APP_NAME` | `Shelfy API` | No | Display/service name for backend metadata. |
| `ENVIRONMENT` | `development` | No | Runtime profile (`development`, `production`, etc.). |

### Backend connectivity

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `DATABASE_URL` | `postgresql+asyncpg://shelfy:shelfy@postgres:5432/shelfy` | Yes | SQLAlchemy async DB connection string. |
| `REDIS_URL` | `redis://redis:6379/0` | Yes | Redis URL for readiness checks and cache usage. |
| `CORS_ALLOWED_ORIGINS` | `["http://localhost:5173"]` | No | JSON array of allowed frontend origins. |

### Auth

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `JWT_SECRET_KEY` | `change-me` | **Yes in non-dev** | JWT signing key for access/refresh tokens. |
| `JWT_ALGORITHM` | `HS256` | No | JWT signing algorithm. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | No | Access-token lifetime in minutes. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | No | Refresh-token lifetime in days. |
| `ADMIN_EMAIL` | _unset_ | Optional | Seeded admin email. |
| `ADMIN_PASSWORD` | _unset_ | Optional | Seeded admin password. |
| `SEED_ADMIN_ON_STARTUP` | `false` | No | Create admin on startup when credentials are set. |

### Queue / worker / AI

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `CELERY_BROKER_URL` | `redis://redis:6379/0` | Yes | Celery broker URL. |
| `CELERY_RESULT_BACKEND` | `redis://redis:6379/1` | Yes | Celery result backend URL. |
| `GEMINI_API_KEY` | _unset_ | **Yes for full scan fallback** | Gemini Vision API key. |

### MinIO / object storage

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `MINIO_ENDPOINT` | `http://minio:9000` | Yes | MinIO S3 endpoint. |
| `MINIO_ACCESS_KEY` | `minioadmin` | **Yes in non-dev** | S3 access key. |
| `MINIO_SECRET_KEY` | `minioadmin` | **Yes in non-dev** | S3 secret key. |
| `MINIO_BUCKET` | `shelfy-images` | Yes | Bucket for uploaded images. |
| `MINIO_REGION` | `us-east-1` | No | Region for S3 client. |

### Frontend

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | No | Base URL used by frontend API client. |

---

## Troubleshooting

### “Could not extract books from photo”

Usually provider timeout or temporary Vision API failure.

- retry the same scan once,
- check backend + worker logs,
- verify `GEMINI_API_KEY` is configured.

### Frontend white/blank screen

Most often runtime JS error in a recent UI change.

```bash
cd infra
docker compose logs -n 200 frontend
docker compose restart frontend
```

### Queue unavailable / processing stuck

```bash
cd infra
docker compose ps
# ensure redis + worker + backend are healthy/up
```

---

## Homelab deployment (Docker Swarm)

- Stack definition: `infra/swarm-stack.yml`
- Runbook: `docs/deployment.md`

```bash
docker stack deploy -c infra/swarm-stack.yml library-app
```

Swarm-specific vars are documented in `.env.example` and `docs/deployment.md`.

---

## Developer checks

```bash
# Backend
cd backend
pip install -r requirements.txt -r requirements-dev.txt
ruff check app tests
mypy app tests
TEST_DATABASE_URL=sqlite+aiosqlite:///./test.db pytest --cov=app --cov-fail-under=80 tests

# Frontend
cd ../frontend
npm ci
npm run lint
npm test -- --run

# End-to-end tests
cd ../e2e
npm ci
npm run e2e
```

---

## AI-assisted workflow

Shelfy is intentionally developed with AI guardrails:

1. Requirements are codified in `docs/project-spec.md` and `docs/implementation-phases.md`.
2. `AGENTS.md` defines architectural constraints and code quality expectations.
3. Changes are validated by static analysis/tests before merge.
4. Key decisions are captured in `docs/adr/`.

---

## Key docs

- Architecture: `docs/architecture.md`
- OpenAPI spec: `docs/openapi.yaml`
- ADRs: `docs/adr/`
- Implementation roadmap: `docs/implementation-phases.md`
- Coding standards: `docs/coding-standards.md`
- Deployment guide: `docs/deployment.md`
---

## Release readiness checklist

Before each production release:

- [ ] CI passes (backend + frontend + e2e smoke/regression)
- [ ] Frontend build succeeds and bundle budget check passes
- [ ] DB migrations applied (`alembic upgrade head`)
- [ ] Shelf ordering integrity check passes
- [ ] Critical routes smoke-tested (`/books`, `/bookshelf`, `/scan`)
- [ ] No unresolved `frontend_runtime_error` bursts in monitoring

Useful references:
- Incident runbook: `docs/runbooks/incidents.md`
- Monitoring and alerts: `docs/monitoring/README.md`
- Prometheus rules: `docs/monitoring/alerts.prometheus.yml`
- Production audit: `docs/production-readiness-audit-2026-04-02.md`

