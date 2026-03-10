# AGENTS.md

## Purpose

This repository contains a serious portfolio project: a production-like web application
for managing a physical home library.

The goal is not to build a toy CRUD app, but a maintainable full-stack application
that demonstrates backend development, frontend development, database design,
background job processing, external API integration, Docker-based deployment,
and observability.

---

## Source of truth

Always read these documents before starting any task:

1. `docs/project-spec.md` — product definition, architecture, scope, technical requirements
2. `docs/implementation-phases.md` — implementation order, phase boundaries, deliverables,
   and required tests per phase

Conflict resolution priority:
1. Explicit user instruction in the current session
2. `docs/project-spec.md`
3. `docs/implementation-phases.md`
4. This file

Do not invent a different architecture. Do not extend scope beyond the current phase.

---

## Before you write any code

1. Read the current phase definition in `docs/implementation-phases.md`.
2. Identify exactly which deliverables and tests are required.
3. Read any existing code in the affected modules before touching them.
4. If anything is ambiguous, apply the smallest reasonable assumption and document it.

Do not start implementing before completing these steps.

---

## Working rules

- Implement only the currently requested phase or task.
- Do not expand scope unless explicitly instructed.
- Prefer the simplest working solution that matches the specification.
- Favor clarity and maintainability over cleverness.
- Make incremental, reviewable changes — one concern per commit.
- Preserve consistency with the existing codebase structure, naming, and patterns.
- If a simpler approach is available and spec-compliant, prefer it. Document the choice.

---

## Scope control

Unless explicitly requested, do NOT:

- add features not listed in the current phase deliverables
- refactor unrelated parts of the codebase
- replace any part of the agreed technology stack
- introduce new infrastructure components
- redesign or rewrite completed modules
- add performance optimizations not required by the spec
- add AI chat features, LLM integrations, or any other unrelated functionality

If something is missing from the spec, choose the simplest implementation consistent
with existing patterns and note the assumption clearly in your summary.

---

## Technology stack constraints

Do not change the stack. The following are fixed:

| Layer | Technology |
|---|---|
| Backend language | Python 3.12 |
| Backend framework | FastAPI |
| ORM | SQLAlchemy 2.x async |
| Migrations | Alembic |
| Task queue | Celery + Redis |
| Auth | python-jose (JWT) + passlib (bcrypt) |
| OCR | pytesseract + OpenCV |
| Barcode | pyzbar |
| Object storage | MinIO (boto3 client) |
| HTTP client | httpx (async) |
| Logging | structlog |
| Validation | Pydantic v2 |
| Frontend framework | React 18 + Vite |
| Frontend state | React Query (server) + Zustand (UI) |
| Frontend routing | React Router v6 |
| UI components | shadcn/ui + Tailwind CSS |
| Database | PostgreSQL 16 |
| Cache / broker | Redis 7 |
| Reverse proxy | Traefik v3 |

Do not introduce:
- Kubernetes
- GraphQL
- microservices
- any new framework not listed above

---

## Backend code rules

These rules are non-negotiable. CI will fail if they are violated.

**ORM and database:**
- Use SQLAlchemy ORM only. Never write raw SQL.
- Always add or update Alembic migrations when the schema changes.
- Never modify a migration that has already been applied. Create a new one.

**API layer:**
- All endpoints must have explicit Pydantic response models. Never return bare dicts.
- Keep routers thin — no business logic in router functions.
- All business logic belongs in `app/services/`.
- All external HTTP calls belong in `app/services/` — never call httpx directly
  from a router or a model.

**Async:**
- All service functions must be async.
- Do not use blocking calls inside async functions (no `time.sleep`,
  no synchronous file I/O, no synchronous HTTP).

**Logging:**
- Use `structlog.get_logger()` for all logging.
- Never use `print()` or Python's stdlib `logging` directly.
- Every log entry must include relevant context (request_id, job_id, user_id
  where applicable).

**Error handling:**
- Handle errors explicitly. Do not let exceptions bubble silently.
- External API failures must be caught and handled with fallback logic
  as defined in `docs/project-spec.md`.
- Return meaningful HTTP status codes, not always 500.

**Secrets:**
- Never hardcode secrets, passwords, or API keys.
- Read all sensitive values from environment variables.
- In Swarm deployment, read from Docker Secrets mounted at `/run/secrets/`.

**Dependencies:**
- Do not add a new package to `requirements.txt` without a justification
  comment in the PR description.
- Prefer packages already present in the project.

---

## Frontend code rules

**State management:**
- Use React Query for all server state. Do not manually manage fetch/loading/error
  state in components.
- Use Zustand only for UI-only state (open/closed modals, sidebar state, etc.).

**Components:**
- Components must not contain business logic. Extract to custom hooks.
- Handle all three states: loading, success, error — every time.
- Keep components small and focused on a single responsibility.

**TypeScript:**
- Use explicit types. Do not use `any`.
- API response shapes must be typed — generate or write types to match backend schemas.

**Routing:**
- All new pages must be registered in the React Router configuration.

**Dependencies:**
- Do not add a new npm package without justification in the PR description.

---

## Testing rules

Every phase in `docs/implementation-phases.md` lists required tests.
These tests are mandatory — not optional, not deferrable.

**Backend:**
- Use `pytest` with `httpx.AsyncClient` for API tests.
- Use a real test database (PostgreSQL), not SQLite.
- Mock only external HTTP calls (Google Books API, OpenLibrary) — use `respx`
  or `pytest-httpx`.
- Minimum coverage threshold: **80%** — enforced in CI on every PR.
- Do not write low-value tests (tests that only assert the function was called).
  Write tests that verify actual behavior.

**Frontend:**
- Use Vitest + React Testing Library.
- Test user-visible behavior, not implementation details.
- Do not test that React Query called fetch — test that the UI renders correctly.

**What good tests look like:**
- API test: send a real HTTP request to the endpoint, assert the response status,
  body shape, and database side-effects.
- Unit test: call a service function with realistic input, assert the output.
- Frontend test: render a component with mock data, assert what the user sees.

**Do not:**
- Skip tests to meet a deadline.
- Write tests after opening the PR.
- Write tests that always pass regardless of the code (e.g. `assert True`).

---

## Git and PR rules

**Branch naming:**
```
feature/<issue-number>-short-description
fix/<issue-number>-short-description
chore/<issue-number>-short-description
```

Examples:
```
feature/12-location-crud
fix/34-job-status-not-updating
chore/5-add-ruff-config
```

**Commit format (Conventional Commits):**
```
feat: add location CRUD endpoints
fix: return 409 when deleting location with books
chore: add ruff to CI pipeline
test: add API tests for auth endpoints
docs: update architecture diagram
```

- One logical change per commit.
- Do not mix refactoring with feature implementation in the same commit.
- Do not commit commented-out code.
- Do not commit `.env` files, secrets, or local config overrides.

**PR description must include:**
1. What was implemented (one paragraph)
2. Files created or changed
3. Design decisions or assumptions made
4. Anything intentionally deferred to a later phase
5. How to verify the result locally

---

## CI requirements

Before opening a PR, verify all of the following pass locally:

```bash
# Backend
cd backend
ruff check app/
mypy app/
pytest --cov=app --cov-fail-under=80 tests/

# Frontend
cd frontend
npm run lint
npm test
```

Do not open a PR if any of these fail.

---

## Iteration limit

If CI fails or review comments remain unresolved after **2 automated fix attempts**
on the same PR:

1. Stop making commits.
2. Add the label `needs-human-review` to the PR.
3. Leave a comment explaining what is blocking progress.
4. Do not make further commits until a human reviews and provides direction.

Continuing to push speculative fixes after 2 failed attempts creates noise and
makes the problem harder to diagnose.

---

## Documentation rules

Update documentation when the implementation changes:

| What changed | What to update |
|---|---|
| New endpoint added | `docs/project-spec.md` API table |
| Schema change | Alembic migration + `docs/architecture.md` |
| New environment variable | `.env.example` + README env var table |
| Phase completed | `docs/implementation-phases.md` status |
| Architecture decision made | new file under `docs/adr/` |

Do not rewrite documentation that is still accurate.
Do not leave documentation that contradicts the implementation.

---

## If blocked

If blocked by ambiguity or a missing component:

1. Do not redesign the project.
2. Do not implement something from a later phase to unblock yourself.
3. Make the smallest reasonable assumption consistent with the spec.
4. Stub or isolate the dependency cleanly if needed.
5. Document the assumption and the stub clearly in the PR description.
6. Note what remains for the later phase.

If blocked by a bug or failing test you cannot resolve in 2 attempts:
stop, label the PR `needs-human-review`, and explain the failure clearly.

---

## Output format for every completed task

After completing any task, always respond with:

```
## Summary
One paragraph: what was implemented and why.

## Files changed
- path/to/file.py — what changed and why
- ...

## Assumptions
List any assumption made where the spec was ambiguous.

## Deferred
List anything intentionally not implemented and which phase it belongs to.

## How to verify
Exact commands to run to verify the result locally.
```

Keep the summary concrete. Do not pad it.
