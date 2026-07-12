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
  OL[Open Library API]
  GB[Google Books API — optional, off by default]

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
2. Backend sets JWT access/refresh tokens as **HttpOnly cookies** and issues a
   CSRF token (double-submit pattern, ADR 007).
3. The browser sends cookies automatically; mutating requests carry the CSRF
   header. (Bearer tokens are used only by tests/tooling.)
4. Books/locations endpoints persist and query entities in PostgreSQL.

### 4.2 Upload + enrichment flow

1. Frontend uploads a cover image to `POST /api/v1/books/upload`.
2. Backend validates type/size, stores bytes in MinIO, creates `book_images` + `processing_jobs` rows.
3. Backend enqueues Celery task.
4. Worker performs barcode extraction with Gemini Vision spine-recognition fallback, attempts metadata lookup (Open Library; Google Books only behind the `ENABLE_GOOGLE_BOOKS` opt-in flag), then updates job/book rows.

## 5. Observability and operations

Monitoring (ADR 010): Prometheus (`127.0.0.1:9092`, 180d retention)
scrapes the backend `/metrics` endpoint every 60 s; Grafana
(`127.0.0.1:3300`, provisioned from `infra/grafana/`) ships two
dashboards — *Shelfy · Byznys* (users by tier, DAU/WAU/MAU from
`users.last_seen_at`, inventory totals) and *Shelfy · Systém* (request
rates, 5xx ratio, external-API latency, processing jobs). `/metrics` is
not exposed through the Cloudflare tunnel.


- JSON structured logs are emitted by backend and worker via structlog.
- `/metrics` endpoint exports Prometheus-compatible counters/histograms.
- Health endpoints:
  - `/health` for liveness
  - `/health/ready` for dependency readiness checks (database + redis)

## 6. Security model

- JWT auth in HttpOnly cookies with CSRF double-submit protection (ADR 007);
  tokens signed via `python-jose`.
- Password hashing via `passlib` + bcrypt.
- Secret-like values supplied through environment variables — in production
  injected from a Kubernetes Secret generated out-of-git
  (`infra/k8s/scripts/gen-secrets.sh`).
- CORS restricted by configurable allowlist.
- `/metrics` and admin tooling are not exposed through the Cloudflare tunnel.

## 7. CI quality gates

GitHub Actions CI validates:

1. `ruff` static linting
2. `mypy` strict type checks
3. Backend tests with coverage threshold (`--cov-fail-under=80`)
4. Frontend lint and tests

## 8. Production deployment architecture (k3s — ADR 011)

- Production runs on a two-node k3s cluster (amd64 miniPC + arm64 Raspberry
  Pi 5); manifests are kustomize base + `staging`/`prod` overlays under
  `infra/k8s/`.
- Ingress: Cloudflare Tunnel → Traefik (k3s built-in) → Ingress routing
  `/api` + `/health` to the backend and everything else to the frontend. TLS
  terminates at Cloudflare.
- CD: merge to `main` → GHCR images tagged `sha-<commit>` → `Deploy` workflow
  pins tags via `kubectl set image` and waits for rollout; alembic migrations
  run as a backend initContainer.
- Sensitive values are injected from Kubernetes Secrets created out-of-git;
  datastore credentials were rotated during the migration.
- Persistent storage uses k3s local-path PVCs pinned to the amd64 node.
- Operational steps: `docs/deployment.md`; migration record:
  `infra/k8s/CUTOVER.md`.
