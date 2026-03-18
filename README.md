# Shelfy

Shelfy is an AI-assisted home library manager built as a production-style portfolio project.
It combines a typed FastAPI backend, async SQLAlchemy data layer, Redis/Celery background
workers, and a React frontend for day-to-day catalog management.

## Architecture diagram

![Shelfy architecture](docs/assets/architecture-diagram.svg)

## Demo screenshot

![Shelfy dashboard mock screenshot](docs/assets/demo-home.svg)

## Core architecture

- **Frontend**: React + Vite + React Query + React Router.
- **Backend**: FastAPI + SQLAlchemy async + Alembic + JWT auth.
- **Worker pipeline**: Celery tasks for OCR/barcode extraction and metadata enrichment.
- **Storage**: PostgreSQL (relational state), Redis (broker/cache), MinIO (image objects).
- **Observability**: structlog JSON logs and Prometheus metrics endpoint (`/metrics`).

## AI-assisted workflow

Shelfy is intentionally developed with AI guardrails:

1. Product and implementation requirements are codified in `docs/project-spec.md` and
   `docs/implementation-phases.md`.
2. `AGENTS.md` instructions define architectural constraints, coding standards, and testing
   expectations so generated code stays aligned with the design.
3. Each implementation step is validated by static analysis (`ruff`, `mypy`) and test suites
   with an enforced backend coverage gate.
4. ADRs in `docs/adr/` capture key technology choices and the tradeoffs behind them.

This flow keeps AI output auditable, reviewable, and tied to explicit engineering intent.

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

## Homelab deployment (Docker Swarm)

Use the Swarm stack file and deployment runbook:

- Stack definition: `infra/swarm-stack.yml`
- Step-by-step guide: `docs/deployment.md`

Deploy command:

```bash
docker stack deploy -c infra/swarm-stack.yml library-app
```

## Environment variables reference

The app reads from `.env` (see `.env.example`).

### Application and runtime

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `APP_NAME` | `Shelfy API` | No | Display/service name for backend metadata. |
| `ENVIRONMENT` | `development` | No | Runtime profile (`development`, `production`, etc.). |

### Backend connectivity

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `DATABASE_URL` | `postgresql+asyncpg://shelfy:shelfy@postgres:5432/shelfy` | Yes | SQLAlchemy async database connection string. |
| `REDIS_URL` | `redis://redis:6379/0` | Yes | Redis URL for readiness checks and metadata cache. |
| `CORS_ALLOWED_ORIGINS` | `["http://localhost:5173"]` | No | JSON array of allowed frontend origins. |

### Authentication

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `JWT_SECRET_KEY` | `change-me` | **Yes in non-dev** | JWT signing key for access/refresh tokens. |
| `JWT_ALGORITHM` | `HS256` | No | JWT signing algorithm. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | No | Access-token lifetime in minutes. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | No | Refresh-token lifetime in days. |
| `ADMIN_EMAIL` | _unset_ | Optional | Seeded admin account email. |
| `ADMIN_PASSWORD` | _unset_ | Optional | Seeded admin account password. |
| `SEED_ADMIN_ON_STARTUP` | `false` | No | If `true`, creates admin user during startup when credentials are set. |

### Worker and queue

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `CELERY_BROKER_URL` | `redis://redis:6379/0` | Yes | Celery broker URL. |
| `CELERY_RESULT_BACKEND` | `redis://redis:6379/1` | Yes | Celery result backend URL. |

### MinIO / object storage

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `MINIO_ENDPOINT` | `http://minio:9000` | Yes | MinIO S3-compatible endpoint. |
| `MINIO_ACCESS_KEY` | `minioadmin` | **Yes in non-dev** | S3 access key for upload/download. |
| `MINIO_SECRET_KEY` | `minioadmin` | **Yes in non-dev** | S3 secret key for upload/download. |
| `MINIO_BUCKET` | `shelfy-images` | Yes | Bucket for uploaded book images. |
| `MINIO_REGION` | `us-east-1` | No | Region passed to S3 client. |

### Local Docker bootstrap values

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `POSTGRES_DB` | `shelfy` | No | Compose bootstrapping for local Postgres container. |
| `POSTGRES_USER` | `shelfy` | No | Compose bootstrapping for local Postgres user. |
| `POSTGRES_PASSWORD` | `shelfy` | No | Compose bootstrapping for local Postgres password. |
| `MINIO_ROOT_USER` | `minioadmin` | No | MinIO container bootstrap account. |
| `MINIO_ROOT_PASSWORD` | `minioadmin` | No | MinIO container bootstrap password. |

### Frontend

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | No | Base URL consumed by frontend API client. |

### Swarm deployment

| Variable | Default | Required | Purpose |
|---|---|---:|---|
| `SHELFY_BACKEND_IMAGE` | `ghcr.io/your-org/shelfy-backend:latest` | Yes (Swarm) | Backend image reference used by `infra/swarm-stack.yml`. |
| `SHELFY_FRONTEND_IMAGE` | `ghcr.io/your-org/shelfy-frontend:latest` | Yes (Swarm) | Frontend image reference used by `infra/swarm-stack.yml`. |
| `SHELFY_WORKER_IMAGE` | `ghcr.io/your-org/shelfy-worker:latest` | Yes (Swarm) | Worker image reference used by `infra/swarm-stack.yml`. |
| `SHELFY_APP_HOST` | `library.example.com` | Yes (Swarm) | Public hostname routed to the frontend service. |
| `API_HOST` | `api.library.example.com` | Yes (Swarm) | Public hostname routed to the backend API. |
| `MINIO_API_HOST` | `minio.library.example.com` | Yes (Swarm) | Public hostname routed to MinIO S3 API. |
| `MINIO_CONSOLE_HOST` | `minio-console.library.example.com` | Yes (Swarm) | Public hostname routed to MinIO console. |
| `TRAEFIK_DASHBOARD_HOST` | `traefik.library.example.com` | Yes (Swarm) | Public hostname for Traefik dashboard. |
| `TRAEFIK_ACME_EMAIL` | `ops@example.com` | Yes (Swarm) | Contact email used by Traefik ACME/Let's Encrypt resolver. |

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
```

## Key docs

- Architecture details: `docs/architecture.md`
- ADRs: `docs/adr/`
- Implementation roadmap: `docs/implementation-phases.md`
- Coding standards: `docs/coding-standards.md`
- Swarm deployment guide: `docs/deployment.md`
