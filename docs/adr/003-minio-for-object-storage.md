# ADR 003: MinIO for object storage

- **Status:** Accepted
- **Date:** 2026-03-18

## Context

Uploaded cover images must persist independently from container lifecycle and filesystem churn.

## Decision

Use **MinIO** (S3-compatible API) for image object storage.

## Consequences

### Positive
- Durable object storage abstraction for uploads.
- Easy local development with Docker Compose.
- S3-compatible interface keeps migration options open.

### Tradeoffs
- Additional service to run and monitor.
- Access keys and bucket configuration must be managed explicitly.
