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

1. `docs/current-status.md` — what is done, what is in progress, what is broken
2. `docs/project-spec.md` — product definition, architecture, scope, technical requirements
3. `docs/implementation-phases.md` — implementation order, phase boundaries, deliverables

Conflict resolution priority:
1. Explicit user instruction in the current session
2. `docs/project-spec.md`
3. `docs/implementation-phases.md`
4. This file

Do not invent a different architecture. Do not extend scope beyond the current phase.

---

## Before you write any code

1. Read `docs/current-status.md` to understand what is done and in progress.
2. Read the current phase definition in `docs/implementation-phases.md`.
3. Identify exactly which deliverables and tests are required.
4. Read any existing code in the affected modules before touching them.
5. If anything is ambiguous, apply the smallest reasonable assumption and document it.

Do not start implementing before completing these steps.

---

## Working rules

- Implement only the currently requested phase or task.
- Every change must trace to a GitHub issue or explicit human/Claude instruction.
- Do not expand scope unless explicitly instructed.
- Prefer the simplest working solution that matches the specification.
- Favor clarity and maintainability over cleverness.
- Make incremental, reviewable changes — one concern per commit.
- Preserve consistency with the existing codebase structure, naming, and patterns.

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

## Code rules

All code rules are defined in `docs/coding-standards.md`.
That document is the single source of truth for backend, frontend, and git conventions.

Key rules that CI enforces (quick reference — see coding-standards.md for full detail):

- SQLAlchemy ORM only, no raw SQL
- All endpoints must have Pydantic response models
- All service functions must be async
- Use `structlog.get_logger()`, never `print()`
- External API calls go through `app/services/`, never from routers
- React Query for server state, Zustand for UI state only
- Conventional Commits format: `feat:`, `fix:`, `chore:`, `test:`, `docs:`
- No `any` in TypeScript

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
| Vision fallback | Google Gemini Vision API |
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

Do not introduce: Kubernetes, GraphQL, microservices, or any new framework not listed above.

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

## Branch naming

```
feat/<issue-number>-short-description
fix/<issue-number>-short-description
chore/<issue-number>-short-description
docs/<issue-number>-short-description
```

---

## Iteration limit

If CI fails or review comments remain unresolved after **2 automated fix attempts**
on the same PR:

1. Stop making commits.
2. Add the label `needs-human-review` to the PR.
3. Leave a comment explaining what is blocking progress.
4. Do not make further commits until a human reviews and provides direction.

---

## Documentation update rules

After every PR that changes behavior, update the relevant docs.
See `docs/ai-operating-model.md` for the full update protocol.

Quick reference:

| What changed | What to update |
|---|---|
| Schema change | `docs/entity-design.md` + Alembic migration |
| Phase completed/started | `docs/current-status.md` |
| New endpoint added | `docs/project-spec.md` API table |
| New environment variable | `.env.example` |
| Architecture decision | new file under `docs/adr/` |

---

## If blocked

If blocked by ambiguity or a missing component:

1. Do not redesign the project.
2. Do not implement something from a later phase to unblock yourself.
3. Make the smallest reasonable assumption consistent with the spec.
4. Stub or isolate the dependency cleanly if needed.
5. Document the assumption and the stub clearly in the PR description.

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
