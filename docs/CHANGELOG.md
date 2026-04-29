# Shelfy changelog

Public source for notable Shelfy changes. Keep entries short, dated, and user-facing; avoid implementation noise unless it affects reliability, security, privacy, or product behavior.

The public page at `/changelog` is generated from `frontend/src/content/changelog.ts`. When adding a release note, update both files in the same PR until a markdown-to-page generator exists.

## 2026-04-29 — Spolehlivější backend a přísnější CI

- Backend test coverage gate is back at 80%.
- Strict Mypy is now a required CI gate instead of advisory-only.
- Added/fixed type coverage across billing, OAuth, cookies, libraries, CSV import, scan API, and tests.

## 2026-04-27 — Bezpečnější knihovny a member management

- ISBN uniqueness is scoped per library.
- Foreign `X-Library-Id` returns 403 instead of silently falling back.
- Unauthenticated onboarding returns 401 consistently.

## 2026-04-10 — Password reset a auth hardening

- Added forgot/reset password flow.
- Added reset-password transactional e-mails.
- Improved auth rate-limiting and tests.
