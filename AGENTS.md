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
# Full suite + coverage gate — requires Postgres with pg_trgm (this is what CI runs):
TEST_DATABASE_URL=postgresql+asyncpg://test:test@localhost:5432/shelfy_test \
  pytest --cov=app --cov-fail-under=80 tests

cd ../frontend
npm run lint
npm test -- --run
```

**No local Postgres / Python toolchain?** Push and let CI be the judge —
the `backend / tests` job in `.github/workflows/ci.yml` spins up Postgres 16
with `pg_trgm` and runs the exact command above. A SQLite fallback exists
(`TEST_DATABASE_URL=sqlite+aiosqlite:///./test.db`), but it is a partial
smoke run only: Postgres-only tests (FTS, trigram similarity) do not pass
there, so a red SQLite run is not by itself a regression.

**Backend schema changes?** Also run `scripts/check-openapi-drift.sh`
and commit any `docs/openapi.yaml` diff in the same PR. The script
regenerates the spec from the live FastAPI app and exits non-zero on
drift, so it doubles as a one-line pre-push check. The CI `backend /
lint` job runs the same check — running it locally just saves the cycle.

## Test-DB contract

The authoritative test run is **Postgres**: CI (`backend / tests`) provisions
Postgres 16 with `pg_trgm` and points the suite at it via `TEST_DATABASE_URL`,
matching production semantics exactly. Each test module falls back to its own
SQLite file when `TEST_DATABASE_URL` is unset — useful as a fast local smoke
run, with a known gap: Postgres-only behaviour (FTS, trigram similarity) is
not covered there.

To stop the SQLite fallback from drifting on FK semantics — the kind of
divergence that lets dangling-FK inserts pass green tests but break
production — `backend/tests/conftest.py` registers a global SQLAlchemy
connect-event listener that issues `PRAGMA foreign_keys=ON` on every SQLite
connection (a no-op on Postgres). The listener is re-asserted by
`tests/test_sqlite_pragma.py`, which both reads back the pragma and proves a
dangling-FK insert raises `IntegrityError`.

**Implication for new tests:** rows must reference real parents. To
simulate "this borrower lives in another library that the user has no
access to," seed an actual `Library` row (with a real `created_by_user_id`)
but skip the `LibraryMember` — see the patterns in
`tests/test_borrowers.py::test_list_borrowers_isolated_between_libraries`
and friends.
