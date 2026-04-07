# Shelfy — SaaS Launch Plan

Date: 2026-04-05
Owner: Paťas
Status: **active**
Replaces: `docs/business/OSS_MONETIZATION_DEMO_PLAN.md` (obsolete draft)

---

## Context

Shelfy is a personal/shared library management app. Target audience: book enthusiasts and small libraries (school, private). Core value prop: fast book localization via AI-powered shelf scanning + digital twin.

This document is the single source of truth for taking Shelfy from a self-hosted homelab app to a monetized SaaS product. It is structured so that both humans and AI agents can pick up any section and execute it independently.

---

## Table of Contents

1. [Product Strategy Decisions](#1-product-strategy-decisions)
2. [Pricing & Packaging](#2-pricing--packaging)
3. [Technical Requirements for Monetization](#3-technical-requirements-for-monetization)
4. [4-Week Roadmap](#4-4-week-roadmap)
5. [App Store Decision](#5-app-store-decision)
6. [Current Technical Baseline](#6-current-technical-baseline)

---

## 1. Product Strategy Decisions

### Distribution: Web-first with PWA

**Decision:** Stay web-only. Add PWA immediately. No app stores until 500+ MAU.

Rationale:
- Zero distribution friction (no Apple/Google review cycles)
- Stripe billing on web = 2.9% fee vs 30% App Store tax
- Shared library management (key feature for small libraries) works better on desktop/tablet
- Camera-based shelf scanning works via `<input type="file" capture>` in mobile browsers
- Current stack (Vite + Traefik + Let's Encrypt) is production-ready

Risk: Mobile browser = second-class experience. Mitigated by PWA (install prompt, offline shell, home screen icon).

### Paywall metric: Scans and members, NOT book count

**Decision:** Books are unlimited on all tiers. Paywall = AI scans/month + library count + member count.

Rationale:
- Book count limit causes frustration at the wrong moment (user scans one shelf = 50 books = hits limit in 3 minutes, before forming a habit)
- AI scans are the most expensive backend resource (Vision API calls) — natural cost alignment
- Library/member limits create organic upgrade triggers for the small-library segment
- Unlimited books = users fill their library = lock-in = higher LTV

---

## 2. Pricing & Packaging

| Feature | **Free** | **Pro** (€3.99/mo) | **Library** (€9.99/mo) |
|---|---|---|---|
| Books | unlimited | unlimited | unlimited |
| Libraries (workspaces) | 1 (personal) | 3 | 10 |
| Members per library | 1 (solo) | 3 | 15 |
| AI shelf scans / month | 5 | 50 | 200 |
| Metadata enrichment | 20 books/mo | unlimited | unlimited |
| CSV export | ✓ | ✓ | ✓ |
| Digital twin | ✓ | ✓ | ✓ |
| Priority support | — | — | ✓ |

### Upgrade triggers (where to show prompts in UI)

- User tries to create 2nd library → "Upgrade to Pro for up to 3 libraries"
- User tries to add member to library → "Upgrade to Pro to invite team members"
- User hits scan limit → "You've used 5/5 free scans this month. Upgrade for 50 scans/mo"
- User hits enrichment limit → "Upgrade to Pro for unlimited metadata enrichment"

### Trial strategy

- 14-day Pro trial on registration (via Stripe trial period)
- No credit card required for trial
- Email reminder at day 10 and day 13

---

## 3. Technical Requirements for Monetization

### Current state (what exists)

- [x] Multi-tenancy with RBAC (Library + LibraryMember, 3 roles: owner/editor/viewer)
- [x] Tenant isolation verified (14 tests in `test_isolation.py`)
- [x] JWT auth (access 15min + refresh 7d, bcrypt passwords)
- [x] PostgreSQL + Redis + MinIO + Celery
- [x] Production stack (Traefik v3 + Let's Encrypt + Docker Swarm)
- [x] Prometheus metrics endpoint
- [x] CORS middleware
- [x] Input validation (Pydantic)
- [x] Structured logging (structlog)

### What must be built

#### 3.1 PWA Support
- **What:** Add `vite-plugin-pwa` to frontend
- **Files to create/modify:**
  - `frontend/vite.config.ts` — add PWA plugin
  - `frontend/public/manifest.webmanifest` — app name, icons, theme color, display: standalone
  - `frontend/public/icons/` — app icons (192x192, 512x512)
  - `frontend/index.html` — add `<link rel="manifest">`, `<meta name="theme-color">`
  - `frontend/src/main.tsx` — register service worker
- **Acceptance:** App installable from mobile Chrome/Safari. Lighthouse PWA score ≥ 90.

#### 3.2 Security Hardening
- **What:** Rate limiting + security headers
- **Rate limiting:**
  - Add `slowapi` dependency to `backend/requirements.txt`
  - Add rate limit middleware to `backend/app/main.py`
  - Limits: 60 req/min per user (general), 10 req/min on auth endpoints, 5 req/min on scan/enrich
- **Security headers** (middleware in `backend/app/main.py`):
  ```
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Referrer-Policy: strict-origin-when-cross-origin
  ```
- **Acceptance:** `curl -I` shows all headers. Auth brute-force returns 429 after 10 attempts/min.

#### 3.3 Subscription & Quota Data Model
- **What:** Database tables for subscription state and usage tracking
- **New tables (Alembic migration):**
  ```
  subscription:
    - id: UUID PK
    - user_id: FK → users (unique)
    - plan: enum(free, pro, library)
    - status: enum(active, trialing, canceled, past_due)
    - stripe_customer_id: str (unique, nullable)
    - stripe_subscription_id: str (unique, nullable)
    - trial_ends_at: timestamptz (nullable)
    - current_period_start: timestamptz
    - current_period_end: timestamptz
    - created_at, updated_at: timestamptz

  usage_counter:
    - id: UUID PK
    - user_id: FK → users
    - metric: enum(scans, enrichments)
    - period: str (e.g. "2026-04")
    - count: int (default 0)
    - created_at, updated_at: timestamptz
    - unique(user_id, metric, period)
  ```
- **New file:** `backend/app/models/subscription.py`
- **Update:** `backend/app/models/__init__.py` to export new models
- **Acceptance:** `alembic upgrade head` succeeds. Models queryable in tests.

#### 3.4 Quota Enforcement
- **What:** FastAPI dependencies that check plan limits before expensive operations
- **New file:** `backend/app/api/dependencies/quota.py`
- **Logic:**
  - `require_scan_quota(user, session)` — check `usage_counter` for current month vs plan limit. Raise HTTP 402 with `{"upgrade_url": "/settings#billing", "limit": 5, "used": 5}` if exceeded.
  - `require_library_quota(user, session)` — check library count vs plan limit
  - `require_member_quota(user, library_id, session)` — check member count vs plan limit
  - `require_enrichment_quota(user, session)` — check enrichment count vs plan limit
- **Wire into:** scan endpoint, library create endpoint, member add endpoint, enrich endpoint
- **Acceptance:** Free user gets 402 on 6th scan. Pro user can do 50. Tests verify all limits.

#### 3.5 Stripe Integration
- **What:** Stripe Checkout for subscriptions, webhooks for lifecycle events
- **New files:**
  - `backend/app/api/billing.py` — router with endpoints:
    - `POST /api/v1/billing/checkout` — create Stripe Checkout Session, return URL
    - `POST /api/v1/billing/portal` — create Stripe Customer Portal session, return URL
    - `POST /api/v1/billing/webhook` — Stripe webhook handler (no auth, verify signature)
    - `GET /api/v1/billing/status` — return current user's plan + usage
  - `backend/app/services/billing.py` — business logic for plan changes
- **Webhook events to handle:**
  - `checkout.session.completed` — create/update subscription record
  - `invoice.paid` — extend current_period_end
  - `customer.subscription.updated` — plan change (upgrade/downgrade)
  - `customer.subscription.deleted` — set plan to free
- **Config:** Add `stripe_secret_key`, `stripe_webhook_secret`, `stripe_price_pro`, `stripe_price_library` to `backend/app/core/config.py`
- **Frontend:**
  - `frontend/src/pages/SettingsPage.tsx` — add Billing section: current plan badge, usage meters, upgrade/manage buttons
  - `frontend/src/pages/PricingPage.tsx` — new page with tier comparison table + CTA buttons
  - `frontend/src/components/UpgradePrompt.tsx` — reusable modal shown when quota exceeded
- **Acceptance:** Full flow works: register → trial → checkout → payment → plan active → webhook updates DB.

#### 3.6 GDPR Compliance
- **What:** User data rights (access, delete, portability)
- **New endpoints:**
  - `DELETE /api/v1/auth/me` — delete user account + all data (CASCADE handles libraries/books/loans)
  - `GET /api/v1/auth/me/export` — JSON export of all user data
- **Frontend:** "Delete my account" button in Settings (with password confirmation + warning modal)
- **Static pages:** Privacy Policy, Terms of Service (can be markdown rendered or external links)
- **Acceptance:** Account deletion removes all user data. Export returns valid JSON with all books/loans/locations.

#### 3.7 Backup Strategy
- **What:** Automated PostgreSQL backups
- **Implementation:**
  - Cron job: `pg_dump` daily → compressed → upload to S3/MinIO backup bucket
  - Retention: 30 days
  - Script: `scripts/backup-db.sh`
  - Swarm: add backup service to `infra/swarm-stack.yml`
- **Acceptance:** Backup runs daily. Restore tested successfully at least once.

#### 3.8 Monitoring & Alerting
- **What:** Error tracking + uptime monitoring
- **Sentry:** Add `sentry-sdk[fastapi]` to backend, `@sentry/react` to frontend
- **Uptime:** Uptime Kuma or similar checking `/api/v1/health` every 60s
- **Alerts:** Configure Alertmanager (already have Prometheus) → Telegram/email on 5xx spike, DB errors
- **Acceptance:** Intentional error in dev triggers Sentry alert. Health check downtime triggers notification.

#### 3.9 Landing Page
- **What:** Public marketing page at root domain (unauthenticated)
- **Content:** Value prop headline, feature highlights (3-4), pricing table, CTA (Sign up / Try free), screenshot/GIF
- **Implementation:** Can be a simple static page or a route in the React app that doesn't require auth
- **Acceptance:** Visiting the root URL while logged out shows landing page, not login redirect.

---

## 4. 4-Week Roadmap

### Week 1: PWA + Security + Data Model

| Day | Task | Section | Priority |
|-----|------|---------|----------|
| Mon-Tue | Add `vite-plugin-pwa`: manifest, service worker, install prompt, offline shell | 3.1 | must-have |
| Wed | Security headers middleware + `slowapi` rate limiting | 3.2 | must-have |
| Thu | Alembic migration: `subscription` + `usage_counter` tables | 3.3 | must-have |
| Fri | Quota enforcement dependencies + wire into scan/enrich/library/member endpoints | 3.4 | must-have |

**Week 1 exit criteria:** App is installable as PWA. Rate limiting active. Free tier scan limit enforced (returns 402 on 6th scan).

### Week 2: Stripe + Billing UI

| Day | Task | Section | Priority |
|-----|------|---------|----------|
| Mon | Stripe account setup, create Products + Prices (Pro/Library) in Stripe Dashboard | 3.5 | must-have |
| Tue-Wed | Backend: billing router (checkout, portal, webhook, status) + billing service | 3.5 | must-have |
| Thu | Frontend: billing section in Settings (plan badge, usage meters, upgrade/manage buttons) | 3.5 | must-have |
| Fri | Frontend: UpgradePrompt component + PricingPage + wire upgrade triggers | 3.5 | must-have |

**Week 2 exit criteria:** Full payment flow works end-to-end. User can upgrade, downgrade, cancel. Webhooks correctly update plan status.

### Week 3: GDPR + Production Hardening

| Day | Task | Section | Priority |
|-----|------|---------|----------|
| Mon | Account deletion endpoint + data export endpoint | 3.6 | must-have |
| Tue | Privacy Policy + Terms of Service pages | 3.6 | must-have |
| Wed | PostgreSQL backup cron + S3 upload + restore test | 3.7 | must-have |
| Thu | Sentry integration (backend + frontend) | 3.8 | nice-to-have |
| Fri | Landing page (public, unauthenticated) | 3.9 | must-have |

**Week 3 exit criteria:** GDPR-compliant (delete + export + privacy policy). Backups running daily. Landing page live.

### Week 4: Launch Prep + Soft Launch

| Day | Task | Priority | Status |
|-----|------|----------|--------|
| Mon | Fix tech debt: `consume_n` idempotency + quota gate on `retry-enrichment` | must-have | ✅ done |
| Tue | 14-day Pro trial on first Stripe checkout (`trial_period_days: 14`) | nice-to-have | ✅ done |
| Wed | Email notifications: welcome (on register), trial ending (day 10 & 13), limit approaching — via Resend | nice-to-have | ✅ done |
| Thu | Analytics: PostHog or Plausible (self-hosted) — funnel: signup → first scan → upgrade | nice-to-have | pending |
| Fri | Soft launch: Product Hunt, Reddit r/books, r/selfhosted, české knižní komunity | must-have | pending |

**Week 4 exit criteria:** App is monetizable, GDPR-compliant, monitored, and publicly accessible with a landing page.

---

## 5. App Store Decision

### Current decision: Do NOT publish to App Store / Google Play.

### When to reconsider

| Signal | Threshold | Action |
|--------|-----------|--------|
| Monthly active users | > 500 MAU | Evaluate TWA (Android) + Capacitor (iOS) |
| PWA install rate | < 5% of mobile users | Native wrapper needed |
| iOS push notifications | Critical for retention | Capacitor wrapper (iOS PWA push is unreliable) |
| Competitor in stores | Taking users | Match distribution channel |

### Implementation path (when the time comes)

- **Android first:** TWA (Trusted Web Activity) wraps PWA into APK. 1-2 days of work. No native code.
- **iOS second:** Capacitor wrapper. Requires Apple Developer Account (€99/year). Review takes 1-2 weeks.
- **Billing in stores:** Apple/Google require their IAP for subscriptions. Options: (a) higher price in stores to offset 30% cut, (b) web-only billing with "sign up on our website" link (risky with Apple guidelines).

---

## 6. Current Technical Baseline

Reference snapshot as of 2026-04-05. Use this to understand what exists before implementing any section above.

### Architecture

| Component | Technology | Notes |
|-----------|-----------|-------|
| Frontend | React 18 + TypeScript + Vite | No PWA, no service worker |
| Backend | FastAPI + SQLAlchemy (async) + Pydantic | 43 endpoints, 12 routers |
| Database | PostgreSQL 16 | 7 core tables |
| Cache/Queue | Redis 7 | Celery broker + result backend |
| Object Storage | MinIO | Book images, cover photos |
| Worker | Celery | Async image processing, enrichment |
| Reverse Proxy | Traefik v3 | SSL/TLS via Let's Encrypt (production) |
| Orchestration | Docker Compose (dev) / Docker Swarm (prod) | |

### Auth

- Stateless JWT (access: 15min, refresh: 7d)
- bcrypt password hashing (passlib)
- No sessions, no OAuth providers, no MFA

### Multi-tenancy

- Library-based isolation with LibraryMember junction table
- 3 roles: owner, editor, viewer
- Every endpoint checks `require_library_role()` via FastAPI dependency
- X-Library-Id header for library switching
- Personal library auto-created on registration

### What does NOT exist yet

- No billing/subscription tables
- No quota enforcement
- No rate limiting
- No PWA (no manifest, no service worker)
- No security headers (HSTS, CSP, X-Frame-Options)
- No backup automation
- No error tracking (Sentry)
- No landing page
- No email sending capability
- No analytics

---

## Known Technical Debt

Intentional shortcuts taken during initial implementation. Address before scale.

| Item | Location | Status | Notes |
|------|----------|--------|-------|
| ~~`consume_n` has no idempotency~~ | `app/services/entitlements.py` | ✅ **Fixed (Week 4)** | `consume_n` now accepts an optional `idempotency_key` using the same `UsageEvent` ON CONFLICT DO NOTHING pattern as `consume`. Both `/enrich/location` and `/enrich/all` pass a period-scoped key. |
| ~~Quota not enforced on `PATCH /books/{id}/retry-enrichment`~~ | `app/api/books.py` | ✅ **Fixed (Week 4)** | `retry_book_enrichment` now calls `assert_can_use` before queuing and `consume(..., idempotency_key=f"retry_{book_id}")` after. |
| `test_entitlements.py` requires PostgreSQL | `tests/test_entitlements.py` | open | `pg_insert` (ON CONFLICT DO UPDATE) is PostgreSQL-specific. SQLite cannot run entitlement integration tests. Test DB URL is configurable via `TEST_DATABASE_URL` env var. |
| `except Exception: pass` patterns in workers | `app/api/scan.py`, `app/api/enrich.py` | open | Some Celery queue failures are swallowed silently. Now logged via `structlog.warning`, but no alerting. Wire to Sentry for production visibility. |

---

## Obsolete Documents

The following documents are superseded by this plan and should be deleted:

| File | Reason |
|------|--------|
| `docs/business/OSS_MONETIZATION_DEMO_PLAN.md` | Replaced by this document. Was a draft with different strategy (open-core, demo sandbox). |
| `docs/target-product-spec.md` | Outdated ICP ("portfolio piece for DevOps engineers") and scope (says "Monetization: None", "Multi-user: out of scope"). No longer reflects project direction. |
| `UX_UI_AUDIT.md` (root) | Completed audit from 2026-03-31. All actionable items have been implemented. Should be archived to `docs/archive/` or deleted. |
| `UX_UI_IMPLEMENTATION_PLAN.md` (root) | Implementation plan for the UX audit above. Work is done. Should be archived to `docs/archive/` or deleted. |
