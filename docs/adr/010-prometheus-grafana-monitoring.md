# ADR 010: Prometheus + Grafana for business and system monitoring

- **Status:** Accepted
- **Date:** 2026-07-12

## Context

The backend has exported Prometheus metrics on `/metrics` since early on
(HTTP request counters, external-API calls/latency, processing-job
gauges), but nothing scraped them and no business-level telemetry
existed: no answer to "how many users per tier", "how many come back",
or "when was a user last active". The product owner wants these visible
in Grafana, together with basic system monitoring.

Constraints:

- Prod runs via docker compose on a single host behind a Cloudflare
  tunnel that only routes `/api/*` and `/health*` to the backend —
  `/metrics` is *not* publicly reachable, so business gauges can ride on
  the existing endpoint without leaking.
- Ports 9090/9091 (another project's Prometheus/pushgateway) and 3000
  (AdGuard) are already taken on the host.

## Decision

1. **Business gauges on the existing `/metrics` endpoint**, recomputed
   from Postgres on every scrape (a handful of indexed COUNTs at a 60 s
   scrape interval): `shelfy_users_total`, `shelfy_users_by_plan{plan}`
   (effective plan — canceled/past_due report as free, mirroring
   entitlements), `shelfy_active_users{window="1d|7d|30d"}`, plus
   inventory totals (libraries, books, active loans, wishlist items).
   Prometheus turns those point-in-time gauges into history, which is
   what makes retention visible — no event pipeline needed.
2. **`users.last_seen_at`** column stamped by
   `services.user_activity.touch_last_seen` from `get_current_user`,
   throttled to one write per 15 minutes per user *inside the UPDATE's
   WHERE clause* (no Redis round-trip, race-free, zero-row match on the
   hot path).
3. **Prometheus (180 d retention) + Grafana as compose services** in
   `infra/docker-compose.prod.yml`, deployed by the standard deploy
   workflow. Bound to localhost only: Prometheus on `127.0.0.1:9092`,
   Grafana on `127.0.0.1:3300`. Grafana is fully provisioned from the
   repo (datasource + two dashboards: *Shelfy · Byznys*, *Shelfy ·
   Systém*), so a wiped volume rebuilds itself; admin password comes
   from `GRAFANA_ADMIN_PASSWORD` in `.env.prod.local`.

## Alternatives considered

- **Grafana → Postgres datasource with raw SQL dashboards.** More
  ad-hoc flexibility, but requires a read-only DB role and puts query
  cost into Grafana refreshes; gauges + Prometheus give history for
  free and keep the DB contract in code. Can still be added later.
- **Product-analytics tools (PostHog/Umami).** Answers different
  questions (funnels, page views) at the cost of another stateful
  service; the asked-for metrics are all derivable from the DB.

## Consequences

- Grafana is reachable only from the host (or an SSH tunnel /
  Cloudflare Access hostname if added later).
- `/metrics` must stay off the public tunnel ingress; anyone adding a
  catch-all route to the backend would expose business numbers.
- The `shelfy_*` gauges are point-in-time: Grafana history starts the
  day this ships, and `last_seen_at` is NULL for users who haven't
  visited since — both intentional.
