# Monitoring & Alerting

Shelfy exposes Prometheus metrics at `/metrics`.

## Core metrics
- `http_requests_total{method,endpoint,status}`
- `frontend_runtime_errors_total{kind}`
- `book_processing_jobs_total{status}`
- `external_api_calls_total{provider}`
- `external_api_latency_seconds{provider}`

## Suggested alert rules
See `docs/monitoring/alerts.prometheus.yml`.

## Minimal dashboard panels
1. HTTP request rate + 5xx ratio
2. Frontend runtime errors trend
3. Book processing jobs by status
4. External API latency percentile (p95)

## SLO starter
- Availability: 99% monthly for core routes (`/books`, `/bookshelf`, `/scan`)
- Error budget policy: freeze risky UI changes when breached.
