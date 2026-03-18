# ADR 001: FastAPI over Django

- **Status:** Accepted
- **Date:** 2026-03-18

## Context

Shelfy needs an async-first API, explicit data contracts, and low-overhead routing with typed request/response models.

## Decision

Use **FastAPI** (with SQLAlchemy async) instead of Django.

## Consequences

### Positive
- Native async support for IO-heavy operations.
- Pydantic-based schema validation and typed contracts.
- Lightweight structure that fits API-first architecture.

### Tradeoffs
- Fewer built-in batteries than Django admin ecosystem.
- More explicit setup required for auth, dependency wiring, and background jobs.
