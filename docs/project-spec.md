# AI‑Assisted Home Library Manager — Project Specification

## Context

The author of this project is a DevOps / infrastructure engineer who
wants to create a public GitHub project demonstrating the ability to:

- design an application
- implement backend and frontend
- design system architecture
- containerize the application
- deploy it in a homelab
- use modern DevOps workflows
- experiment with AI‑assisted development

The project will serve both as a **portfolio project** and as an
**experiment with AI‑assisted engineering workflows**.

---

# Main Idea

The application allows a user to manage a **home library by
photographing books**.

User workflow:

1. Take a photo of a book
2. The system accepts the image and creates a processing job
3. The job runs barcode / vision-based spine recognition asynchronously
4. Metadata about the book is fetched from external APIs
5. The book is stored in the database
6. The user assigns the physical location of the book in the house

The main problem solved:

> Users often know they own a book but cannot remember where it is
> located.

---

# Core Application Features

## 1. Adding a Book

User actions:

- Take a photo of a book cover or barcode
- Or upload an image

Backend processing pipeline (asynchronous):

1. Image is uploaded and stored in object storage (MinIO)
2. A processing job is queued (Celery + Redis)
3. Worker attempts to detect: ISBN (barcode), title, author (Gemini Vision spine recognition fallback)
4. Worker queries external book APIs with detected data
5. Result is written to the database
6. Frontend polls job status endpoint until complete

External APIs (with fallback):

- Primary: Google Books API
- Fallback: OpenLibrary API

If both APIs fail, the book is saved with only the data extracted
locally. The user can fill in missing metadata manually.

---

## 2. Stored Book Metadata

The system stores:

- title
- author
- publication year
- ISBN
- publisher
- language
- description
- cover image URL (stored in MinIO, not on disk)
- raw image path (original uploaded photo, stored in MinIO)
- processing status (pending / done / failed)
- created_at, updated_at timestamps

---

## 3. Physical Location Tracking

Each book has a **physical location** in the house.

Location hierarchy:

```
room / furniture / shelf
```

Example:

```
office / bookshelf-2 / shelf-3
```

Locations are managed as a separate resource so the user can rename
or reorganize them without touching book records.

---

## 4. Searching the Library

Users can search by:

- title
- author
- year
- ISBN
- location

Search is implemented as a PostgreSQL full-text search on the `books`
table. No external search engine is needed at this scale.

---

## 5. Library Overview

UI views:

- list of all books (paginated)
- books grouped by location
- books grouped by author
- statistics (total books, books per location, books per author)

---

# Architecture

## Component Overview

```
Browser (React SPA)
        |
        v
   Traefik (reverse proxy, TLS termination)
        |
        v
   FastAPI (backend API)
        |
        +---> PostgreSQL (persistent data)
        |
        +---> Redis (job queue + cache)
        |
        +---> Celery Worker (async image processing)
        |         |
        |         +---> MinIO (image storage)
        |         |
        |         +---> Google Books API
        |         +---> OpenLibrary API (fallback)
        |
        +---> MinIO (direct upload URL generation)
```

## Request Flow: Adding a Book

```
1. POST /api/v1/books/upload
   → API validates image, stores to MinIO, creates job record in DB
   → Returns: { job_id: "...", status: "pending" }

2. Celery worker picks up job
   → Runs barcode detection with Gemini Vision fallback on image
   → Queries Google Books API (or OpenLibrary fallback)
   → Writes book record to PostgreSQL
   → Updates job status to "done" or "failed"

3. Frontend polls: GET /api/v1/jobs/{job_id}
   → Returns job status + book_id when done
   → Frontend redirects to book detail page
```

## Caching Strategy

- External API responses are cached in Redis by ISBN (TTL: 24 hours)
- If the same ISBN is uploaded again, no external API call is made

## Authentication

The application is a **single-user system** (homelab personal tool).

Authentication method: **JWT (JSON Web Token)**

- `POST /api/v1/auth/login` — returns access token + refresh token
- Access token lifetime: 15 minutes
- Refresh token lifetime: 7 days
- All API endpoints except `/auth/login` and `/health` require a
  valid Bearer token

No user registration endpoint is exposed. The initial user is created
via a CLI command or environment variable on first startup.

---

# Technology Stack

## Backend

- **Language:** Python 3.12
- **Framework:** FastAPI
  - Reason: modern, async-native, typed, excellent OpenAPI support
- **ORM:** SQLAlchemy 2.x (async mode)
- **Migrations:** Alembic
- **Task queue:** Celery with Redis broker
- **Auth:** python-jose (JWT), passlib (password hashing)
- **Vision fallback:** Google Gemini Vision API
- **Barcode detection:** pyzbar
- **Object storage client:** boto3 (MinIO-compatible S3 API)
- **HTTP client:** httpx (async, for external APIs)
- **Logging:** structlog (structured JSON logs)
- **Validation:** Pydantic v2

## Frontend

- **Framework:** React 18 (Vite)
  - Reason: sufficient for a single-user SPA; simpler build than
    Next.js for a homelab tool that does not need SSR or SEO
- **State management:** React Query (server state) + Zustand (UI state)
- **Routing:** React Router v6
- **UI components:** shadcn/ui + Tailwind CSS
- **HTTP client:** Axios

## Database

- **PostgreSQL 16**
  - Reason: relational model fits book/location hierarchy well;
    full-text search built-in; production-grade for homelab

## Object Storage

- **MinIO** (self-hosted, S3-compatible)
  - Reason: avoids storing files on container filesystem (ephemeral);
    compatible with boto3; easy to run as a Swarm service

## Cache / Message Broker

- **Redis 7**
  - Used for: Celery job queue, API response cache

## Reverse Proxy

- **Traefik v3**
  - Reason: native Docker/Swarm integration, automatic TLS via
    Let's Encrypt, label-based routing config

## Deployment

| Environment | Tooling |
|---|---|
| Local development | Docker Compose |
| Homelab production | Docker Swarm stack |

---

# Repository Structure

```
library-app/
├── backend/
│   ├── app/
│   │   ├── api/          # FastAPI routers
│   │   ├── core/         # config, security, dependencies
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── services/     # business logic
│   │   ├── workers/      # Celery tasks
│   │   └── main.py
│   ├── alembic/          # DB migrations
│   ├── tests/
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── api/
│   ├── Dockerfile
│   └── package.json
├── infra/
│   ├── docker-compose.yml          # local dev
│   ├── docker-compose.override.yml # dev overrides
│   └── swarm-stack.yml             # homelab production
├── docs/
│   ├── architecture.md
│   ├── coding-standards.md
│   ├── testing-strategy.md
│   └── adr/
│       ├── 001-fastapi-over-django.md
│       ├── 002-async-image-processing.md
│       ├── 003-minio-for-file-storage.md
│       └── 004-react-over-nextjs.md
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── README.md
├── CONTRIBUTING.md
└── AGENTS.md
```

---

# Secrets Management

Secrets are **never** stored in code or committed to the repository.

| Environment | Method |
|---|---|
| Local dev | `.env` file (git-ignored), loaded by Docker Compose |
| Swarm production | Docker Secrets (`docker secret create`) |

Required secrets:

```
POSTGRES_PASSWORD
REDIS_PASSWORD
MINIO_ROOT_PASSWORD
JWT_SECRET_KEY
GOOGLE_BOOKS_API_KEY
GEMINI_API_KEY
```

The backend reads secrets from environment variables. In Swarm mode,
Docker mounts secrets as files under `/run/secrets/`; the app reads
both sources (env var takes precedence).

---

# Observability

## Logging

- All backend logs use **structlog** in JSON format
- Log fields always include: `timestamp`, `level`, `service`,
  `request_id`, `user_id` (if authenticated)
- Worker logs include: `job_id`, `isbn`, `processing_step`

## Metrics

- FastAPI exposes `/metrics` endpoint (Prometheus format)
- Metrics include:
  - `http_requests_total` (by method, endpoint, status)
  - `book_processing_jobs_total` (by status: success/failed)
  - `external_api_calls_total` (by provider: google_books/openlibrary)
  - `external_api_latency_seconds`

## Health Checks

- `GET /health` — returns 200 if API is up (no auth required)
- `GET /health/ready` — checks DB + Redis connectivity

## Tracing (optional, phase 2)

- OpenTelemetry integration for distributed tracing across API +
  Celery workers

---

# Error Handling Strategy

## External API Failures

```
1. Try Google Books API
2. On failure (timeout / 4xx / 5xx): log warning, try OpenLibrary
3. On both failures: save book with local data only, set status="partial"
4. User sees a warning in the UI with option to retry enrichment
```

## Image Processing Failures

- If Gemini Vision returns no usable metadata and no barcode is detected: job status = `failed`
- User is notified and can manually enter book details
- Original image is retained in MinIO for potential retry

## Job Retry Policy

- Celery retries failed jobs up to 3 times with exponential backoff
- After 3 failures, job status = `failed`, no further retries

---

# API Endpoints

```
Auth
  POST   /api/v1/auth/login
  POST   /api/v1/auth/refresh

Books
  GET    /api/v1/books              # list, supports ?search=&location=
  POST   /api/v1/books/upload       # upload image, start processing job
  GET    /api/v1/books/{id}
  PATCH  /api/v1/books/{id}         # manual metadata edit
  DELETE /api/v1/books/{id}

Jobs
  GET    /api/v1/jobs/{job_id}      # poll processing status

Locations
  GET    /api/v1/locations
  POST   /api/v1/locations
  GET    /api/v1/locations/{id}
  PATCH  /api/v1/locations/{id}
  DELETE /api/v1/locations/{id}

Health
  GET    /health
  GET    /health/ready

Metrics
  GET    /metrics                   # Prometheus scrape endpoint
```

---

# Documentation Files

## README.md

Contains:

- project description and motivation
- architecture diagram
- screenshots / demo GIF
- how to run locally (Docker Compose, one command)
- how to deploy to Swarm
- environment variables reference

## CONTRIBUTING.md

Contains:

- how to set up local dev environment
- how to run tests
- branch naming convention: `feature/`, `fix/`, `chore/`
- PR rules: CI must pass, small focused PRs preferred
- commit message format: Conventional Commits

## AGENTS.md

See dedicated section below.

## docs/architecture.md

Full architecture description, component responsibilities, data flow
diagrams, external API integration details.

## docs/coding-standards.md

Naming conventions, project structure rules, error handling patterns,
logging strategy, dependency management policy.

## docs/testing-strategy.md

Test types, coverage requirements, how to run tests, mocking strategy
for external APIs.

## docs/adr/

Architecture Decision Records for all major technology choices.

---

# AGENTS.md — Full Content

> This section defines the rules for AI agents (Codex) working on this
> repository. Agents must read and follow these rules before making
> any changes.

## Allowed Actions

- Implement features described in a GitHub issue
- Fix bugs described in a GitHub issue
- Write or update tests for changed code
- Update documentation for changed code
- Add new files within the existing repository structure

## Prohibited Actions

- Change the technology stack (no new frameworks, no replacing
  existing ones)
- Introduce architectural changes not explicitly requested in the issue
- Refactor code outside the scope of the current task
- Add new Python packages to `requirements.txt` without including a
  justification comment in the PR description
- Add new npm packages to `package.json` without justification
- Modify Alembic migrations that have already been applied
  (create new migrations instead)
- Change any file in `infra/` without explicit instruction
- Remove or weaken any existing test

## Code Rules

### Backend (Python)

- Use SQLAlchemy ORM only — never write raw SQL
- All endpoints must have Pydantic response models (no bare dicts)
- All service functions must be async
- Use `structlog.get_logger()` for all logging — never use `print()`
- All external API calls must go through `app/services/` — never
  call httpx directly from a router
- New endpoints must be covered by at least one API test
- New business logic must be covered by unit tests

### Frontend (React)

- Use React Query for all server state — no manual fetch calls
  in components
- Use Zustand only for UI state (modals, sidebar open/closed, etc.)
- Components must not contain business logic — extract to hooks
- All new pages must be added to React Router config

### General

- Follow Conventional Commits format:
  `feat:`, `fix:`, `chore:`, `test:`, `docs:`
- Every PR must have a description explaining what was changed and why
- Branch naming: `feature/<issue-number>-short-description`

## Test Requirements

Before opening a PR, the agent must verify that all of the following
pass locally:

```bash
# Backend
cd backend
pytest --cov=app tests/
ruff check app/
mypy app/

# Frontend
cd frontend
npm test
npm run lint
```

## Iteration Limit

If CI fails or review comments are not resolved after **2 automated
iterations**, the agent must stop and add the label
`needs-human-review` to the PR. The agent must not make further
commits until a human reviews the situation.

---

# Testing Strategy

## Unit Tests

Target: `backend/app/services/`, `backend/app/workers/`

Examples:

- ISBN extraction from Gemini Vision observed text
- Metadata parsing from Google Books API response
- Fallback logic when primary API fails
- JWT token creation and validation

## API Tests

Target: all endpoints in `backend/app/api/`

Use: `pytest` + `httpx.AsyncClient` against a test database

Examples:

- `POST /api/v1/books/upload` returns 202 with job_id
- `GET /api/v1/books` returns paginated list
- `GET /api/v1/books/{id}` returns 404 for unknown id
- `GET /api/v1/jobs/{id}` returns correct job status
- Unauthenticated requests return 401

## Integration Tests

Target: backend + PostgreSQL + Redis (real containers, not mocks)

Use: `pytest` with Docker Compose test profile

Examples:

- Full flow: upload image → job created → worker processes → book saved
- Celery retry logic on external API failure

## Frontend Tests

Target: key components and hooks

Use: Vitest + React Testing Library

Examples:

- Book list renders correctly with mock data
- Upload form submits correctly
- Job polling stops when status is "done"

## CI Pipeline

```yaml
jobs:
  backend:
    - ruff check
    - mypy
    - pytest --cov=app (min coverage: 80%)

  frontend:
    - eslint
    - vitest

  docker:
    - docker build backend
    - docker build frontend
```

---

# AI‑Assisted Development Workflow

## Agent Roles

### Codex

Role: primary code implementation agent

Tasks:

- implementing features from GitHub issues
- fixing bugs
- writing tests for implemented code

Constraint: must follow all rules in AGENTS.md

### CodeRabbit

Role: automated pull request review

Configuration (`.coderabbit.yaml`):

- review against `docs/coding-standards.md`
- flag any raw SQL, missing Pydantic models, or missing tests
- flag any new dependency without justification

### Claude

Role: architecture review, security review, debugging complex failures

Trigger: called manually by human on PRs that change architecture or
introduce new infrastructure components

---

## Development Workflow

### 1. Issue

New features and bugs are tracked as GitHub Issues.

Issue template includes:

- problem description
- acceptance criteria (explicit, testable)
- which files are likely affected

### 2. Implementation

Codex agent:

- reads the issue and AGENTS.md
- creates a branch: `feature/<issue-number>-description`
- implements the feature following code rules
- writes tests
- opens a PR with a description

### 3. CI

GitHub Actions runs automatically on PR open:

- backend lint + type check + tests
- frontend lint + tests
- Docker build check

### 4. AI Review

CodeRabbit reviews the PR automatically.
Claude may be invoked manually for architectural PRs.

### 5. Iteration

Codex may address review comments.
**Maximum 2 automated iterations.**
After that: label `needs-human-review`, agent stops.

### 6. Merge

PR is merged only if:

- CI is green
- all review comments are resolved or dismissed by human

---

# Deployment

## Local Development

```bash
cd infra
docker compose up -d
```

Services started: postgres, redis, minio, backend, worker, frontend

## Homelab (Docker Swarm)

```bash
docker stack deploy -c infra/swarm-stack.yml library-app
```

Services: same as above, plus Traefik as ingress

## CI/CD (GitHub Actions)

On merge to `main`:

1. Build Docker images (backend, frontend)
2. Push to GitHub Container Registry (ghcr.io)
3. Optional: SSH deploy to homelab Swarm node

---

# Architecture Decision Records (ADRs)

The `docs/adr/` directory contains the following ADRs:

| ADR | Decision |
|---|---|
| 001 | FastAPI over Django — async-native, lighter, typed |
| 002 | Async image processing via Celery — blocking vision calls must not block API |
| 003 | MinIO for file storage — ephemeral container filesystem is unsuitable |
| 004 | React over Next.js — SSR not needed for single-user homelab tool |
| 006 | Gemini Vision fallback for spine recognition when barcode detection fails |

---

# Project Goals

The project demonstrates:

- system design with real async architecture
- backend implementation (FastAPI, SQLAlchemy, Celery)
- frontend implementation (React, React Query)
- containerization (Docker Compose + Swarm)
- observability (structured logging, Prometheus metrics)
- secrets management (Docker Secrets)
- CI/CD (GitHub Actions)
- AI-assisted development with guardrails (Codex + CodeRabbit)
- documentation culture (ADRs, coding standards, architecture docs)
