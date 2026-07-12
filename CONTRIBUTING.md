# Contributing to Shelfy

Thanks for contributing. This repository prioritizes correctness, clarity, and maintainability over speed.

## Prerequisites

- Python 3.12
- Node.js 20+
- Docker + Docker Compose (for full local stack)

## Local setup

```bash
cp .env.example .env

# Backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

# Frontend
cd ../frontend
npm ci
```

## Branch and commit conventions

- Branches:
  - `feature/<issue-number>-short-description`
  - `fix/<issue-number>-short-description`
  - `chore/<issue-number>-short-description`
- Commits follow Conventional Commits:
  - `feat: ...`
  - `fix: ...`
  - `chore: ...`
  - `test: ...`
  - `docs: ...`

## Required checks before opening a PR

```bash
# Backend
cd backend
ruff check app tests
mypy app tests
# Full suite needs Postgres with pg_trgm (this is what CI runs and what counts):
TEST_DATABASE_URL=postgresql+asyncpg://test:test@localhost:5432/shelfy_test \
  pytest --cov=app --cov-fail-under=80 tests
# No local Postgres? SQLite is a partial smoke run only (Postgres-only tests fail
# there by design — see AGENTS.md "Test-DB contract"); push and let CI be the judge:
#   TEST_DATABASE_URL=sqlite+aiosqlite:///./test.db pytest tests

# Frontend
cd ../frontend
npm run lint
npm test -- --run
```

## Pull request checklist

- [ ] Scope matches the requested phase/issue.
- [ ] Tests added/updated for behavior changes.
- [ ] Documentation updated where applicable (`README`, `docs/architecture.md`, ADRs).
- [ ] No secrets or `.env` files committed.
- [ ] CI is green.

## Code review expectations

- Keep routers thin and business logic in `app/services`.
- Use typed interfaces and avoid `any` in frontend.
- Prefer small, focused changes over broad refactors.
- Document non-obvious decisions in PR description and/or ADRs.
