# ADR 002: Celery for asynchronous image processing

- **Status:** Accepted
- **Date:** 2026-03-18

## Context

OCR/barcode detection and external metadata calls can be slow and must not block API request latency.

## Decision

Use **Celery + Redis** for background processing of uploaded images and enrichment retries.

## Consequences

### Positive
- API remains responsive while long-running jobs execute out-of-band.
- Retries and task queue semantics are available without custom orchestration.
- Clear separation between synchronous request path and async processing path.

### Tradeoffs
- Operational complexity increases (worker process, broker, result backend).
- Requires stronger observability and idempotency discipline.
