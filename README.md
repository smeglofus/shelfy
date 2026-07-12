# Shelfy

> AI-assisted home library manager: scan shelves, keep book metadata tidy,
> lend books to people, and navigate a digital twin of your physical shelves.

---

## Features

### Library management

- 📚 Books with rich metadata (title, author, ISBN, publisher, language, year, notes, reading status)
- 🧭 Organize by room / furniture / shelf with reorderable positions
- 🔎 Typo-tolerant search (PostgreSQL FTS + `pg_trgm` similarity)
- 🎛 Filter by reading status, language, publisher, publication-year range
- 🧱 Digital twin view — open a book and autoscroll to its spine
- 📥 CSV import / export

### Scanning & enrichment

- 📸 Shelf-photo scanning with review-before-confirm flow
- ➕ Append-right scans anchored to an existing book
- 🔁 Background enrichment via Celery (barcode, Gemini Vision, external metadata providers)

### Collaboration & accounts

- 👥 Shared libraries with per-user isolation
- 🤝 Lend books to borrowers; merge, anonymize, audit trail
- 🔐 Email + password auth, Google OAuth, password reset, HttpOnly cookies + CSRF
- 🧑‍🏫 First-run onboarding wizard
- 📤 GDPR data-export endpoint (`/auth/me/export`)

### Operations

- 💳 Stripe-backed subscriptions with plan limits and usage metering
- ✉️ Transactional email via Resend
- 📊 Prometheus metrics + structlog JSON logs
- 🩹 Health / readiness probes
- 🗄 Scheduled backup tasks via Celery beat

---

## Engineering highlights

A few things worth a closer look while reading the code:

- **Service-layer discipline.** FastAPI routers stay thin; business logic lives under `backend/app/services/`. Routers do not touch the DB directly. Codified in `docs/coding-standards.md` and `AGENTS.md`.
- **OpenAPI drift gate.** `scripts/check-openapi-drift.sh` regenerates the spec from the live FastAPI app and fails CI if `docs/openapi.yaml` diverges — schema changes can't ship silently.
- **Bundle-size + leaked-secret gates.** `scripts/check_bundle_budget.mjs` enforces a size budget; `scripts/check_bundle_secrets.mjs` scans the built frontend bundle for accidentally-shipped credentials.
- **Real DB semantics in tests.** CI runs the backend suite against PostgreSQL 16 with `pg_trgm` — the same engine as production. Without `TEST_DATABASE_URL` the suite falls back to per-file SQLite databases for quick local smoke runs; `conftest.py` forces `PRAGMA foreign_keys=ON` there and `test_sqlite_pragma.py` asserts that dangling-FK inserts raise, but Postgres-only tests (FTS, trigram search) don't pass on SQLite — the CI run is the authoritative signal.
- **Async end-to-end.** SQLAlchemy 2.x async, async services, Celery for background work, httpx for outbound. No sync DB calls in the request path.
- **Coverage gate.** Backend tests run with `--cov-fail-under=80` in CI.
- **Typed frontend.** TypeScript strict, no `any`. React Query for server state, Zustand for UI state only — never mixed.
- **Migrations as a source of truth.** 24 Alembic migrations document the schema's evolution, including the borrower-anonymization audit trail and the `pg_trgm` extension for fuzzy search.
- **Decision trail.** 11 ADRs under `docs/adr/` cover the non-obvious choices: FastAPI over Django, Celery for async image processing, MinIO for object storage, React over Next.js, Gemini Vision for spine recognition, HttpOnly cookies + CSRF over localStorage tokens, retention of legacy loan fields, Open Library as primary metadata source, Prometheus/Grafana monitoring, and the k3s production platform (ADR 011, superseding the earlier Swarm decision — the supersession itself is part of the trail).
- **Domain invariant checks.** `scripts/check_shelf_ordering_integrity.py` verifies the shelf-position invariant on demand — handy after migrations that touch ordering.

---

## Architecture

![Shelfy architecture](docs/assets/architecture-diagram.svg)

- **Frontend** — React 18 + Vite + React Query + React Router + Tailwind
- **Backend** — FastAPI + async SQLAlchemy 2.x + Alembic + JWT/cookie auth
- **Workers** — Celery (barcode, Gemini Vision, enrichment, email, backups)
- **Data & infra** — PostgreSQL 16, Redis 7, MinIO
- **Observability** — structlog JSON logs + Prometheus metrics at `/metrics`
- **Deployment** — Docker Compose for dev, Kubernetes (k3s) + Traefik + Cloudflare Tunnel for production

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

> Shelf-scan quality depends on `GEMINI_API_KEY`. Without it, the vision fallback is limited.

---

## Developer checks

```bash
# Backend
cd backend
pip install -r requirements.txt -r requirements-dev.txt
ruff check app tests
mypy app tests
# Full suite — needs a Postgres with pg_trgm (CI runs exactly this):
TEST_DATABASE_URL=postgresql+asyncpg://test:test@localhost:5432/shelfy_test pytest --cov=app --cov-fail-under=80 tests
# Quick partial smoke run on SQLite (Postgres-only tests will fail — that's expected):
#   TEST_DATABASE_URL=sqlite+aiosqlite:///./test.db pytest tests

# Frontend
cd ../frontend
npm ci
npm run lint
npm test -- --run

# End-to-end (Playwright)
cd ../e2e
npm ci
npm run e2e
```

---

## Environment variables

The app reads from `.env` — see `.env.example` for the full list with defaults and comments.

<details>
<summary>Reference table of the most important variables</summary>

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

</details>

---

## Troubleshooting

### "Could not extract books from photo"

Usually provider timeout or temporary Vision API failure.

- retry the same scan once,
- check backend + worker logs,
- verify `GEMINI_API_KEY` is configured.

### Frontend white/blank screen

Most often a runtime JS error in a recent UI change.

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

## Production deployment (Kubernetes / k3s)

Production runs on a two-node k3s homelab cluster since 2026-07-12 (migrated
from Docker Compose — the cutover runbook that performed it is
[`infra/k8s/CUTOVER.md`](infra/k8s/CUTOVER.md)).

- Manifests: [`infra/k8s/`](infra/k8s/README.md) (kustomize base + staging/prod overlays)
- CD: merge to `main` → `images` workflow builds sha-tagged images to GHCR →
  `Deploy` workflow pins them via `kubectl set image` and waits for rollout
- Manifest changes: `kubectl apply -k infra/k8s/overlays/prod`

Legacy compose production files (`infra/docker-compose.prod.yml`,
`infra/deploy-prod.local.sh`) are kept as the short-term rollback path
(until ~2026-07-26); the never-used Swarm stack was removed (ADR 005 → 011).

---

## AI-assisted workflow

Shelfy is built with an explicit AI operating model:

- **Codex** handles routine implementation (features, fixes, tests).
- **Claude Code** designs architecture, reviews complex PRs, writes ADRs.
- **CodeRabbit** reviews every PR automatically against coding standards.
- **Human** owns direction, final review, and merges.

Guardrails:

1. Requirements live in `docs/project-spec.md` and `docs/implementation-phases.md`.
2. `AGENTS.md` (root) defines architectural constraints; `.coderabbit.yaml` codifies review rules.
3. Static analysis (ruff, mypy, eslint), tests, OpenAPI drift, and bundle-size/secret gates run on every PR.
4. Non-obvious decisions go into `docs/adr/`.

See `docs/ai-operating-model.md` for the full operating model.

---

## Key docs

- Architecture: `docs/architecture.md`
- OpenAPI spec: `docs/openapi.yaml`
- ADRs: `docs/adr/`
- Implementation roadmap: `docs/implementation-phases.md`
- Coding standards: `docs/coding-standards.md`
- Deployment guide: `docs/deployment.md`
- Incident runbook: `docs/runbooks/incidents.md`
- AI operating model: `docs/ai-operating-model.md`

---

## Release readiness checklist

Before each production release:

- [ ] CI passes (backend + frontend + e2e smoke/regression)
- [ ] Frontend build succeeds and bundle budget check passes
- [ ] DB migrations applied (`alembic upgrade head`)
- [ ] Shelf ordering integrity check passes
- [ ] Critical routes smoke-tested (`/books`, `/bookshelf`, `/scan`)
- [ ] No unresolved `frontend_runtime_error` bursts in monitoring
- [ ] Milestone releases: tag the running commit (`git tag -a vX.Y.Z`) and
      publish notes (`gh release create vX.Y.Z --generate-notes`)

Useful references:

- Incident runbook: `docs/runbooks/incidents.md`
- Monitoring and alerts: `docs/monitoring/README.md`
- Prometheus rules: `docs/monitoring/alerts.prometheus.yml`

---

## License

Business Source License 1.1 — see [`LICENSE`](LICENSE).
