# Shelfy Architecture

## 1. System overview

Shelfy is a single-repository full-stack application composed of:

- **Frontend SPA** (React + Vite) for interactive catalog management.
- **Backend API** (FastAPI) exposing auth, locations, books, upload, jobs, and metrics endpoints.
- **Async worker** (Celery) handling image processing and metadata enrichment tasks.
- **Data services**:
  - PostgreSQL for transactional storage
  - Redis for Celery broker/backend and metadata cache
  - MinIO for object storage of uploaded images

## 2. Runtime component map

```mermaid
flowchart LR
  UI[React Frontend]\n(Vite)
  API[FastAPI Backend]
  DB[(PostgreSQL)]
  R[(Redis)]
  S3[(MinIO)]
  W[Celery Worker]
  GB[Google Books API]
  OL[Open Library API]

  UI -->|REST + JWT| API
  API --> DB
  API --> R
  API --> S3
  API -->|enqueue task| W
  W --> R
  W --> DB
  W --> S3
  W --> GB
  W --> OL
```

## 3. Backend module responsibilities

- `app/api/`: transport layer only (validation, auth dependency wiring, response models).
- `app/services/`: business logic (book/location/job/auth/metadata/storage workflows).
- `app/models/`: SQLAlchemy ORM models.
- `app/schemas/`: request/response models.
- `app/core/`: settings, security, structured logging, metrics.
- `app/db/`: session factory and base ORM metadata.

## 4. Request and processing flows

### 4.1 Interactive API flow

1. Frontend logs in at `POST /api/v1/auth/login`.
2. Backend returns JWT access/refresh tokens.
3. Frontend sends bearer token for protected endpoints.
4. Books/locations endpoints persist and query entities in PostgreSQL.

### 4.2 Upload + enrichment flow

1. Frontend uploads a cover image to `POST /api/v1/books/upload`.
2. Backend validates type/size, stores bytes in MinIO, creates `book_images` + `processing_jobs` rows.
3. Backend enqueues Celery task.
4. Worker performs barcode extraction with Gemini Vision spine-recognition fallback, attempts metadata lookup (Google Books fallback to Open Library), then updates job/book rows.

## 5. Observability and operations

- JSON structured logs are emitted by backend and worker via structlog.
- `/metrics` endpoint exports Prometheus-compatible counters/histograms.
- Health endpoints:
  - `/health` for liveness
  - `/health/ready` for dependency readiness checks (database + redis)

## 6. Security model

- JWT auth using `python-jose`.
- Password hashing via `passlib` + bcrypt.
- Secret-like values supplied through environment variables.
- CORS restricted by configurable allowlist.

## 7. CI quality gates

GitHub Actions CI validates:

1. `ruff` static linting
2. `mypy` strict type checks
3. Backend tests with coverage threshold (`--cov-fail-under=80`)
4. Frontend lint and tests

## 8. Homelab deployment architecture

- Production deployment target is Docker Swarm using `infra/swarm-stack.yml`.
- Traefik v3 is the ingress controller, with label-based routing and ACME TLS.
- Sensitive values are mounted via Docker Secrets under `/run/secrets/` and injected at runtime.
- Persistent storage uses named Swarm volumes for PostgreSQL and MinIO.
- Operational deployment and smoke-test steps are documented in `docs/deployment.md`.
