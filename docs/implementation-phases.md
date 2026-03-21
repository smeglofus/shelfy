# Implementation Phases

This document defines the implementation order for the Home Library Manager project.

The coding agent must always follow these rules:
- Implement only the currently requested phase.
- Do not expand scope unless explicitly asked.
- Use `docs/project-spec.md` as the source of truth.
- Prefer the simplest working solution that matches the spec.
- Do not refactor unrelated parts of the codebase.
- Every phase that touches application code must include tests.
- Tests must pass before the PR is opened.

---

## Phase 0 – Planning

Goal:
- Produce implementation-ready architecture and breakdown.

Deliverables:
- repository structure (all directories and placeholder files)
- backend module layout with file-level comments describing responsibility
- frontend module layout
- SQLAlchemy entity design (fields, types, relationships)
- REST endpoint list with request/response shape for each endpoint
- docker-compose design (services, ports, volumes, env vars)
- environment variable list with descriptions and example values

Tests required:
- none (planning phase only)

Out of scope:
- full implementation
- OCR/barcode logic
- UI implementation

Definition of done:
- all planning documents are created under `docs/`
- implementation order is unambiguous
- any human reviewer can start Phase 1 without asking questions

---

## Phase 1 – Project skeleton and CI foundation

Goal:
- Bootstrap the repository, core services, and CI pipeline so that
  every subsequent phase starts from a working, tested baseline.

Deliverables:
- `backend/` skeleton with FastAPI app factory, config via pydantic-settings
- `frontend/` skeleton with Vite + React, basic router, placeholder pages
- `worker/` skeleton with Celery app definition (no tasks yet)
- `infra/docker-compose.yml` with: postgres, redis, minio, backend, worker, frontend
- `.env.example` with all required variables and descriptions
- `GET /health` endpoint (no auth required, returns `{"status": "ok"}`)
- `GET /health/ready` endpoint (checks DB + Redis connectivity)
- `README.md` with quick-start instructions (one `docker compose up` command)
- `.github/workflows/ci.yml` with: backend lint (ruff), type check (mypy),
  frontend lint (eslint), docker build check
- `.coderabbit.yaml` configured to enforce coding standards from `docs/coding-standards.md`

Tests required:
- `GET /health` returns 200
- `GET /health/ready` returns 200 when DB and Redis are up

Out of scope:
- auth
- business CRUD
- image processing

Definition of done:
- `docker compose up -d` starts all services without errors
- health endpoints respond correctly
- frontend renders a placeholder page in the browser
- CI pipeline runs and passes on an empty PR

---

## Phase 2 – Auth

Goal:
- Implement JWT-based authentication so all subsequent phases can
  build on protected endpoints from the start.

Deliverables:
- `User` SQLAlchemy model (id, email, hashed_password, created_at)
- Alembic migration for User table
- password hashing with passlib (bcrypt)
- `POST /api/v1/auth/login` — returns access token + refresh token
- `POST /api/v1/auth/refresh` — returns new access token
- `get_current_user` FastAPI dependency (used in all future endpoints)
- seeded admin user via CLI command or environment variables on first startup
- access token lifetime: 15 minutes
- refresh token lifetime: 7 days

Tests required:
- login with valid credentials returns tokens
- login with invalid credentials returns 401
- protected endpoint without token returns 401
- protected endpoint with valid token returns 200
- token refresh works correctly

Out of scope:
- user registration (single-user system)
- locations
- books

Definition of done:
- admin login works end-to-end
- all test cases pass
- migration applies cleanly from scratch

---

## Phase 3 – Locations backend

Goal:
- Implement the physical location resource on the backend only.
  Frontend comes in Phase 4.

Deliverables:
- `Location` SQLAlchemy model (id, room, furniture, shelf, created_at, updated_at)
- Alembic migration for Location table
- `GET    /api/v1/locations` — list all locations
- `POST   /api/v1/locations` — create location
- `GET    /api/v1/locations/{id}` — get single location
- `PATCH  /api/v1/locations/{id}` — update location
- `DELETE /api/v1/locations/{id}` — delete location (blocked if books are assigned)
- all endpoints protected by `get_current_user`
- Pydantic request and response schemas for Location

Tests required:
- full CRUD cycle via API tests
- unauthenticated requests return 401
- delete blocked when location has books assigned (returns 409)

Out of scope:
- frontend
- books

Definition of done:
- all location endpoints work correctly
- all test cases pass
- migration applies cleanly

---

## Phase 4 – Locations frontend

Goal:
- Build the frontend UI for location management.

Deliverables:
- `/locations` page — list of all locations
- create location form (modal or inline)
- edit location form
- delete location with confirmation dialog
- React Query hooks for all location API calls
- error handling: show toast on API error
- auth guard: redirect to login if token missing or expired

Tests required:
- location list renders correctly with mock data
- create form submits correctly and updates list
- delete confirmation dialog works

Out of scope:
- books
- image upload

Definition of done:
- user can manage locations end-to-end in the browser
- all test cases pass

---

## Phase 5 – Books backend

Goal:
- Implement the core book catalog on the backend.
  No image processing yet — books are created manually.

Deliverables:
- `Book` SQLAlchemy model:
  - id, title, author, isbn, publisher, language, description
  - publication_year, cover_image_url
  - location_id (FK to Location, nullable)
  - processing_status (enum: manual / pending / done / failed / partial)
  - created_at, updated_at
- Alembic migration for Book table
- `GET    /api/v1/books` — list with search, filter by location, pagination
- `POST   /api/v1/books` — create book manually (no image)
- `GET    /api/v1/books/{id}` — get single book
- `PATCH  /api/v1/books/{id}` — update book metadata or location
- `DELETE /api/v1/books/{id}` — delete book
- full-text search using PostgreSQL `tsvector` on title + author
- all endpoints protected

Tests required:
- full CRUD cycle
- search returns correct results
- filter by location works
- pagination returns correct page size and total count
- unauthenticated requests return 401

Out of scope:
- image upload
- OCR/barcode
- frontend

Definition of done:
- all book endpoints work correctly
- search and filter work
- all test cases pass
- migration applies cleanly

---

## Phase 6 – Books frontend

Goal:
- Build the frontend UI for the book catalog.

Deliverables:
- `/books` page — paginated list with search bar and location filter
- `/books/{id}` page — book detail with all metadata
- create book form (manual entry, no image yet)
- edit book form
- delete book with confirmation
- assign/change location from book detail page
- `/` dashboard page: total book count, books per location, recent additions
- React Query hooks for all book API calls

Tests required:
- book list renders and search input works
- book detail page renders all fields
- create and edit forms submit correctly

Out of scope:
- image upload
- job status polling

Definition of done:
- user can manage books end-to-end in the browser
- all test cases pass

---

## Phase 7 – Image upload and processing job skeleton

Goal:
- Add the upload flow and async processing pipeline with a stub worker.
  No real OCR yet — validates that the async pipeline works end-to-end.

Deliverables:
- MinIO bucket setup on startup (auto-create if missing)
- `BookImage` SQLAlchemy model (id, book_id nullable, minio_path, uploaded_at)
- `ProcessingJob` SQLAlchemy model:
  - id, status (enum: pending/processing/done/failed), book_image_id
  - result_json, error_message, attempts, created_at, updated_at
- Alembic migration for both models
- `POST /api/v1/books/upload` endpoint:
  - accepts image file
  - validates file type (jpeg/png only) and size (max 10MB)
  - stores image to MinIO
  - creates BookImage + ProcessingJob records
  - enqueues Celery task
  - returns `{ job_id, status: "pending" }`
- `GET /api/v1/jobs/{job_id}` — returns job status and book_id when done
- Celery worker stub task: waits 2 seconds, sets job status to `done`
- frontend upload button on `/books/new` page
- frontend job status polling (poll every 2s until done or failed)
- Celery retry policy: max 3 retries with exponential backoff

Tests required:
- upload endpoint returns 202 with job_id
- invalid file type returns 422
- job status endpoint returns correct status
- polling component stops when status is "done"

Out of scope:
- real OCR
- real barcode detection
- metadata lookup

Definition of done:
- user uploads image, job is created, worker processes stub, UI shows result
- all test cases pass
- migration applies cleanly

---

## Phase 8 – Barcode and OCR integration

Goal:
- Replace the worker stub with real metadata extraction.

Deliverables:
- barcode/ISBN detection using pyzbar
- OCR fallback using pytesseract + OpenCV when no barcode is found
- ISBN normalization and validation
- result stored in `ProcessingJob.result_json` as:
  `{ "isbn": "...", "title": "...", "author": "...", "source": "barcode|ocr|none" }`

Tests required:
- barcode detection returns correct ISBN from a test image
- OCR fallback is triggered when no barcode is found
- result is stored correctly in the job record

Out of scope:
- external API lookup (Phase 9)
- book record creation from result (Phase 9)

Definition of done:
- worker extracts ISBN or text from a real book image
- result is stored in job record
- all test cases pass

---

## Phase 13 – Replace OCR with Gemini Vision spine recognition

Goal:
- Replace local OCR fallback with Gemini Vision-based spine recognition.

Deliverables:
- keep barcode/ISBN detection using pyzbar as first path
- replace OCR fallback with Gemini Vision API call when no barcode is found
- parse structured title/author/isbn response from Gemini output
- update worker configuration to use `GEMINI_API_KEY`
- result stored in `ProcessingJob.result_json` as:
  `{ "isbn": "...", "title": "...", "author": "...", "source": "barcode|gemini_vision|none" }`

Tests required:
- barcode detection returns correct ISBN from a test image
- Gemini Vision fallback is triggered when no barcode is found
- result is stored correctly in the job record

Out of scope:
- custom computer-vision models
- frontend upload flow changes

Definition of done:
- worker extracts barcode or Gemini-derived spine metadata from a real book image
- result is stored in job record
- all test cases pass

---

## Phase 9 – External metadata providers

Goal:
- Enrich processing results with metadata from external APIs.

Deliverables:
- `app/services/metadata/google_books.py` — async client for Google Books API
- `app/services/metadata/open_library.py` — async client for OpenLibrary API
- fallback logic: try Google Books first, then OpenLibrary
- Redis cache for API responses keyed by ISBN (TTL: 24 hours)
- metadata normalization into a shared schema
- if both APIs fail: save with `processing_status = "partial"`, log warning
- after successful enrichment: create or update Book record from job result
- `PATCH /api/v1/books/{id}/retry-enrichment` endpoint for manual retry

Tests required:
- Google Books client returns normalized metadata (mock HTTP)
- OpenLibrary fallback is called when Google Books fails (mock HTTP)
- cache hit skips external API call
- both APIs failing sets status to "partial"
- book record is created correctly from enrichment result

Out of scope:
- advanced computer vision
- custom ML models

Definition of done:
- real book image produces a populated Book record end-to-end
- fallback and cache logic work correctly
- all test cases pass

---

## Phase 10 – Observability

Goal:
- Add structured logging and Prometheus metrics throughout the application.

Deliverables:
- structlog configured for JSON output on all backend and worker logs
- log fields on every request: `timestamp`, `level`, `service`,
  `request_id`, `user_id`
- log fields on every worker task: `job_id`, `isbn`, `processing_step`
- `GET /metrics` Prometheus endpoint with:
  - `http_requests_total` (method, endpoint, status)
  - `book_processing_jobs_total` (status: success/failed/partial)
  - `external_api_calls_total` (provider: google_books/open_library)
  - `external_api_latency_seconds`
- replace all existing `print()` calls with structlog (there should be none,
  but verify)

Tests required:
- `/metrics` endpoint returns 200 with valid Prometheus format
- request_id is present in log output for API requests
- job_id is present in log output for worker tasks

Out of scope:
- Grafana dashboard (noted as future improvement)
- distributed tracing

Definition of done:
- metrics endpoint works and can be scraped by Prometheus
- all logs are JSON and contain required fields
- all test cases pass

---

## Phase 11 – Hardening and portfolio polish

Goal:
- Raise quality bar to make the project presentable as a portfolio piece.

Status: ✅ Completed on 2026-03-18.

Deliverables:
- test coverage must reach minimum 80% on backend (enforced in CI)
- all mypy errors resolved (strict mode enabled)
- all ruff warnings resolved
- README updated with:
  - architecture diagram
  - screenshot or demo GIF
  - full environment variable reference
  - explanation of AI-assisted workflow
- `docs/architecture.md` updated to match final implementation
- `docs/adr/` contains all four ADR documents from the spec
- `CONTRIBUTING.md` finalized
- `AGENTS.md` reviewed and updated if anything changed during implementation

Tests required:
- CI enforces 80% coverage threshold (fails build if below)

Out of scope:
- new features

Definition of done:
- CI passes with coverage ≥ 80%
- mypy strict passes
- README is readable and complete for a new visitor to the repo
- all docs are coherent with the actual implementation

---

## Phase 12 – Homelab deployment

Goal:
- Prepare real deployment in the homelab Docker Swarm environment.

Deliverables:
- `infra/swarm-stack.yml` with all services
- Traefik integration with label-based routing and TLS
- Docker Secrets configuration for all sensitive values
- MinIO persistent volume configuration for Swarm
- PostgreSQL persistent volume configuration
- `docs/deployment.md` with step-by-step deployment guide:
  - how to create Docker Secrets
  - how to deploy the stack
  - how to run Alembic migrations on first deploy
  - how to create the admin user on first deploy
  - how to update to a new version

Tests required:
- none (ops/deployment phase)
- manual smoke test checklist included in deployment guide

Out of scope:
- application redesign
- new features

Definition of done:
- deployment guide is complete and usable without prior knowledge
- app can be deployed to a Swarm node by following the guide
- Traefik routes traffic correctly with TLS
