# ADR 004: React SPA over Next.js

- **Status:** Accepted
- **Date:** 2026-03-18

## Context

Shelfy is a single-user homelab-oriented internal tool. SEO and SSR are not primary requirements.

## Decision

Use **React (Vite SPA)** over Next.js.

## Consequences

### Positive
- Simpler deployment model and build pipeline.
- Fast local feedback loop with Vite.
- Good fit for authenticated app-style UX.

### Tradeoffs
- No server-side rendering out of the box.
- Client bundle handles all page rendering responsibilities.
