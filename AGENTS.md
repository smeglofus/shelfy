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

## Test-DB contract

The backend test suite runs against SQLite (`sqlite+aiosqlite`). Production
runs on Postgres. To stop the two from drifting on FK semantics — the kind
of divergence that lets dangling-FK inserts pass green tests but break
production — `backend/tests/conftest.py` registers a global SQLAlchemy
connect-event listener that issues `PRAGMA foreign_keys=ON` on every SQLite
connection. The listener is re-asserted by `tests/test_sqlite_pragma.py`,
which both reads back the pragma and proves a dangling-FK insert raises
`IntegrityError`.

**Implication for new tests:** rows must reference real parents. To
simulate "this borrower lives in another library that the user has no
access to," seed an actual `Library` row (with a real `created_by_user_id`)
but skip the `LibraryMember` — see the patterns in
`tests/test_borrowers.py::test_list_borrowers_isolated_between_libraries`
and friends.
