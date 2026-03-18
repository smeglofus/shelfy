# AGENTS.md

This file provides root-level instructions for contributors and coding agents.

## Scope

Applies to the entire repository unless superseded by a more specific `AGENTS.md` in a subdirectory.

## Rules

1. Follow `docs/project-spec.md` and `docs/implementation-phases.md` as source-of-truth planning docs.
2. Keep FastAPI routers thin; put business logic in `backend/app/services/`.
3. Maintain strict typing discipline (`mypy` strict must pass).
4. Keep backend coverage at or above 80%.
5. Update docs when changing architecture, environment variables, or major workflows.
6. When architecture-level decisions are made, add/update ADRs under `docs/adr/`.

## Required verification commands

```bash
cd backend
ruff check app tests
mypy app tests
TEST_DATABASE_URL=sqlite+aiosqlite:///./test.db pytest --cov=app --cov-fail-under=80 tests

cd ../frontend
npm run lint
npm test -- --run
```
