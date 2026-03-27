# Coding Standards

This document defines the coding rules for the Home Library Manager project.
It is used by both human developers and AI agents (Codex, CodeRabbit).

All rules in this document are mandatory unless explicitly overridden by a
human in the current task description.

---

## General principles

- Favor clarity over cleverness.
- Favor explicit over implicit.
- Keep modules small and focused on a single responsibility.
- Avoid premature optimization.
- Avoid overengineering — the simplest working solution that matches the spec
  is always preferred.

---

## Python / Backend

### Module structure

```
backend/app/
├── api/        # FastAPI routers only — no business logic
├── core/       # config, security, shared dependencies
├── models/     # SQLAlchemy ORM models
├── schemas/    # Pydantic request and response models
├── services/   # all business logic and external integrations
└── workers/    # Celery task definitions
```

Routers must stay thin. A router function should do nothing more than:
1. Validate the request (Pydantic does this automatically)
2. Call a service function
3. Return the response

### Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files | snake_case | `book_service.py` |
| Classes | PascalCase | `BookService` |
| Functions | snake_case | `get_book_by_id` |
| Variables | snake_case | `book_id` |
| Constants | UPPER_SNAKE_CASE | `MAX_IMAGE_SIZE_MB` |
| SQLAlchemy models | PascalCase, singular | `Book`, `Location` |
| Pydantic schemas | PascalCase + suffix | `BookCreate`, `BookResponse` |
| Alembic migrations | auto-generated prefix + description | `20240101_add_book_table` |

### API layer rules

- Every endpoint must declare an explicit Pydantic response model.
  Never return a bare dict or ORM object directly.
- Keep request schemas (`BookCreate`, `LocationUpdate`) separate from
  response schemas (`BookResponse`).
- Never expose internal fields (e.g. `hashed_password`) in response schemas.
- Use HTTP status codes correctly:
  - `200` — successful GET or PATCH
  - `201` — successful POST (resource created)
  - `202` — accepted for async processing (job enqueued)
  - `204` — successful DELETE (no content)
  - `400` — bad request (client error, invalid input)
  - `401` — unauthenticated
  - `403` — authenticated but not authorized
  - `404` — resource not found
  - `409` — conflict (e.g. delete blocked by FK constraint)
  - `422` — validation error (FastAPI default for Pydantic failures)

### Database rules

- Use SQLAlchemy ORM only. Never write raw SQL.
- All models must include `created_at` and `updated_at` timestamps.
- Foreign keys must have explicit `ondelete` behavior defined.
- Always create a new Alembic migration for schema changes.
  Never modify a migration that has already been applied.
- Use UUIDs as primary keys (not sequential integers).

### Async rules

- All service functions must be `async def`.
- Never use blocking calls inside async functions:
  - No `time.sleep()` — use `await asyncio.sleep()`
  - No synchronous file I/O — use `aiofiles` if needed
  - No synchronous HTTP — use `httpx.AsyncClient`
  - No synchronous DB calls — use SQLAlchemy async session

### Logging rules

- Use `structlog.get_logger()` for all logging. Never use `print()` or
  Python's stdlib `logging` module directly.
- Log at the service layer, not the router layer.
- Always include relevant context in log entries:
  - API requests: `request_id`, `user_id`, `method`, `path`
  - Worker tasks: `job_id`, `isbn`, `processing_step`
- Use appropriate log levels:
  - `debug` — internal state useful during development
  - `info` — normal operations (job started, book created)
  - `warning` — recoverable failures (API fallback triggered)
  - `error` — unrecoverable failures that affect the user

### Error handling rules

- Never let exceptions bubble silently. Catch and handle explicitly.
- External API failures (Google Books, OpenLibrary) must follow the
  fallback strategy defined in `docs/project-spec.md`.
- Raise FastAPI `HTTPException` at the router layer, not in services.
  Services should raise domain-specific exceptions that routers translate.
- Always log the exception context before raising or returning an error.

### Secrets and configuration

- Never hardcode secrets, passwords, or API keys.
- All configuration is read from environment variables via pydantic-settings.
- In Swarm deployment, Docker Secrets are mounted at `/run/secrets/`.
  The config loader must support both sources (env var takes precedence).
- The `.env` file is git-ignored. `.env.example` is committed and must
  stay up to date.

### Dependency management

- Do not add a new package to `requirements.txt` without a clear justification.
- Prefer packages already present in the project.
- Pin all dependencies to exact versions in `requirements.txt`.
- Use a separate `requirements-dev.txt` for test and lint tools.

---

## TypeScript / Frontend

### Module structure

```
frontend/src/
├── api/        # API client functions (one file per resource)
├── components/ # reusable UI components
├── hooks/      # custom React hooks (data fetching, UI logic)
├── pages/      # top-level route components
└── types/      # TypeScript type definitions
```

### Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files (components) | PascalCase | `BookCard.tsx` |
| Files (hooks/utils) | camelCase | `useBooks.ts` |
| Components | PascalCase | `BookCard` |
| Hooks | camelCase, `use` prefix | `useBooks`, `useJobPolling` |
| Types/Interfaces | PascalCase | `Book`, `LocationResponse` |
| Constants | UPPER_SNAKE_CASE | `POLLING_INTERVAL_MS` |

### Component rules

- Components must not contain business logic. Extract to custom hooks.
- Every component that fetches data must handle all three states:
  loading, success, and error — without exception.
- Keep components small. If a component exceeds ~150 lines, consider splitting.
- Do not use `any`. All props and state must be explicitly typed.

### State management rules

- Use **React Query** for all server state (data from the API).
  Do not manually manage loading/error state for API calls.
- Use **Zustand** only for UI-only state (modal open/closed,
  sidebar expanded, active tab, etc.).
- Do not use React context for server data.

### API client rules

- All API calls must go through functions in `src/api/`.
  Never call `axios` or `fetch` directly from a component or hook.
- API response shapes must be typed in `src/types/`.
  Types must match the backend Pydantic response schemas.

### Routing rules

- All pages must be registered in the React Router configuration.
- Use named routes or constants for route paths — no hardcoded strings
  scattered across components.

### Dependency management

- Do not add a new npm package without justification in the PR description.
- Prefer packages already present in the project.

---

## Git rules

### Branch naming

```
feat/<issue-number>-short-description
fix/<issue-number>-short-description
chore/<issue-number>-short-description
docs/<issue-number>-short-description
test/<issue-number>-short-description
```

### Commit format (Conventional Commits)

```
feat: add location CRUD endpoints
fix: return 409 when deleting location with books assigned
chore: add ruff config
test: add API tests for auth token refresh
docs: update architecture diagram in README
```

- One logical change per commit.
- Do not mix refactoring with feature implementation in the same commit.
- Do not commit commented-out code.
- Do not commit `.env`, secrets, or local config files.

### PR rules

- Every PR must pass CI before it can be merged.
- Every PR must have a description (see `AGENTS.md` for required format).
- Keep PRs small and focused — one feature or fix per PR.
- Do not open a PR with known failing tests.

---

## What CodeRabbit should flag

CodeRabbit is configured to flag the following automatically:

- raw SQL in Python code
- endpoints missing Pydantic response models
- use of `print()` instead of structlog
- new dependencies added without PR justification comment
- missing error handling for external HTTP calls
- TypeScript `any` usage
- components with direct API calls (should use `src/api/`)
- tests that do not assert behavior (e.g. `assert True`)
- hardcoded secrets or API keys
