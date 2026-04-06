# Shelfy — Target Product Spec v1

## ICP (Ideal Customer Profile)

**Primary:** The author — a DevOps/infrastructure engineer who needs a self-hosted
home library manager and wants to demonstrate AI-assisted full-stack development.

**Secondary:** DevOps/backend engineers evaluating this repo as a portfolio reference
for AI-agent-driven development workflow.

## Problem Statement

1. "I own 200+ books at home and can't remember where each one is."
2. "I want a non-trivial portfolio project that demonstrates real full-stack engineering,
   built primarily by AI agents with human oversight."

## MVP Scope (v1.0)

### In scope

- Upload a photo of a book -> automatic detection (barcode / Gemini Vision)
- Metadata enrichment from Google Books / OpenLibrary with fallback
- CRUD for books and physical locations
- Search by title, author, ISBN, location
- Single-user JWT auth
- Reading status tracking (unread / reading / read / lent + lent_to)
- Docker Compose for local dev, Docker Swarm for homelab deploy
- Structured logging + Prometheus metrics
- CI with lint, type checks, tests (80% coverage gate)

### Out of scope (v1)

- Multi-user / library sharing
- Mobile app (PWA is a v1.1 candidate)
- Recommendation engine
- Social features (Goodreads-like)
- Real-time barcode scanning from camera
- Offline mode
- Import/export (CSV, Goodreads) — candidate for v1.1

## Monetization

None. This is:

1. A personal utility (self-hosted, free)
2. A portfolio piece demonstrating AI-agent development workflow
3. An open-source reference for AI-assisted engineering

## Success Metrics

| Metric | Target | How to measure |
|--------|--------|----------------|
| Book recognition accuracy | >80% from photos | Manual sampling: 50 books |
| Time to add a book | <30s (photo to metadata) | End-to-end timing |
| Deploy reliability | Zero-downtime rolling update | Smoke test after deploy |
| Code quality | 80%+ coverage, 0 mypy errors | CI enforcement |
| Portfolio clarity | Understandable in 2min README read | Test with 3 people |
| AI agent efficiency | >70% PRs merged without human code changes | Git history analysis |

## Positioning

Shelfy is a self-hosted home library manager that doubles as a reference
implementation of an AI-agent-driven development workflow for
DevOps/backend engineering portfolios.

The product must work well enough for daily personal use. The development
process must be transparent enough to serve as a portfolio artifact.
