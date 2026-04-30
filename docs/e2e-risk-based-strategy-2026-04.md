# Shelfy E2E Risk-Based Testing Strategy (Playwright)

Date: 2026-04-30
Scope: `e2e/tests/*.spec.ts` and current CI tag strategy (`@p0` gate + broader regression suites).

## 1) Coverage assessment

### What is well-covered and should stay

- **Authentication and protected-route guardrails** are correctly covered in `@p0`, including login/logout, persistence, and unauthenticated redirects for protected pages (`/books`, `/bookshelf`, `/scan`).
- **Core book-management happy paths** are covered in both `@p0` and `critical-flows` (create/search/persist + CRUD).
- **Role visibility checks (owner vs member)** are already in release-gate and should remain because this is a high-business-risk authorization surface.
- **Password reset happy flow** using `page.route()` is an appropriate test-double boundary (fast, deterministic, no real email dependency).
- **Scan OCR end-to-end** (real Gemini call) is correctly represented as a dedicated `@p0` business-critical path rather than spread through many specs.

### What appears over-tested or redundant

- **Select/reorder mode entry+exit** appears in both `smoke-regressions.spec.ts` and `reorder-and-bulk-regressions.spec.ts` with overlapping assertions.
- **Basic route reachability** overlaps with stronger functional coverage in `@p0` and `critical-flows`; pure “page opens” checks add little signal unless they validate unique app-shell behavior.
- **Onboarding reset+toast** is split in onboarding and partially touched in `@p0` settings flow. Keep both only if one is smoke-level UX and the other is deeper persistence validation; otherwise collapse.

### What is under-tested relative to business risk

- **Authorization enforcement beyond UI visibility** for member/editor (server-side forbidden behavior attempts) on owner-only actions.
- **Location redirect contract** (`/locations` -> `/bookshelf?tab=locations`) and state integrity after redirect.
- **Token lifecycle edge behavior** (expired/invalid session handling and forced relogin) from the SPA perspective.
- **OCR failure-mode UX** (provider timeout/error, partial parse/manual confirmation fallback), currently a known operational risk.
- **Public auth callback route robustness** (`/auth/callback`) and failure handling.

## 2) Gap analysis

### A. Member forbidden owner actions (API-backed)
- **Business risk:** privilege escalation or accidental destructive capability exposure.
- **Recommended tier:** `@p0` (single focused assertion) + broader regression variants in `@regression`.
- **Blockers:** requires deterministic fixture state for owner/member + one intercept/assertion for 403 or hidden action.

### B. `/locations` redirect and tab state persistence
- **Business risk:** broken IA/navigation; users cannot access location management reliably.
- **Recommended tier:** `@critical`.
- **Blockers:** none significant.

### C. Session-expiry UX (stale cookie/token)
- **Business risk:** users get stuck in broken state or silently fail writes.
- **Recommended tier:** `@critical`.
- **Blockers:** needs deterministic token invalidation strategy (route stub or short-lived test token account).

### D. OCR negative path (timeout/failure -> recoverable UX)
- **Business risk:** high support burden; scan feature perceived as unreliable.
- **Recommended tier:** `@regression @slow` (not `@p0`).
- **Blockers:** real Gemini dependency causes flakiness; prefer route-level simulation of failed job status after upload when possible.

### E. Auth callback failure branch (`/auth/callback`)
- **Business risk:** social/OAuth rollout regressions and broken landing for callback errors.
- **Recommended tier:** `@regression` now, upgrade to `@critical` once OAuth is active.
- **Blockers:** depends on current callback implementation path and whether provider is feature-flagged.

### F. Billing/upgrade affordance by role/plan
- **Business risk:** lost conversion or exposure of billing controls to wrong role.
- **Recommended tier:** `@regression` (or `@critical` when monetization launches).
- **Blockers:** unstable staging billing backend; can initially assert navigation + guardrails without charging flow.

## 3) Suite structure recommendation

### Keep with minor revision
- Keep existing files and avoid broad rewrites.
- Reduce overlap by making each suite own a clear responsibility boundary.

### Proposed taxonomy
- `@p0`: release gate; cross-browser matrix (chromium + mobile-safari); only must-not-break revenue/core trust flows.
- `@critical`: daily CI signal for core product workflows not requiring external flaky dependencies.
- `@regression`: broader UX/state/path coverage.
- `@slow`: long-running and/or externally dependent tests (scan real Gemini).

### File grouping refinement
- `p0-release-gate.spec.ts`: auth, one book happy path, owner/member permission surface, one settings must-work flow.
- `password-reset-flow.spec.ts`: keep as standalone `@p0`.
- `scan-account-reset-flow.spec.ts`: keep standalone, tag `@p0 @slow`.
- `critical-flows.spec.ts`: focus on deterministic CRUD + redirect contracts + session handling.
- `smoke-regressions.spec.ts`: keep only lightweight navigation/app-shell sanity checks.
- `reorder-and-bulk-regressions.spec.ts`: own selection/reorder/bulk interactions only (remove duplicate “enter/exit mode” checks from smoke).

### Naming convention
Use pattern: `feature-area.behavior.spec.ts` (future incremental migration only), and test titles as:
`[role] [route/feature] -> [expected outcome]`.

## 4) New tests to add

1. **Test:** `member cannot perform owner-only destructive actions (UI hidden + API forbidden)`
   - **Suite:** `p0-release-gate.spec.ts`
   - **Risk covered:** authorization bypass on role boundaries
   - **Preconditions/test data:** login as editor account; existing library with owner-only controls available in owner session
   - **Stability:** stable

2. **Test:** `locations alias route redirects to bookshelf locations tab and supports CRUD continuation`
   - **Suite:** `critical-flows.spec.ts`
   - **Risk covered:** broken route alias and location management access path
   - **Preconditions:** authenticated user; use `navigateProtected()` then sidebar navigation rules
   - **Stability:** stable

3. **Test:** `expired session during write prompts relogin and preserves user intent messaging`
   - **Suite:** `critical-flows.spec.ts`
   - **Risk covered:** silent data loss / dead-end UX under token expiry
   - **Preconditions:** logged-in state, then force 401 on save request via route interception
   - **Stability:** medium-stable (depends on interception precision)

4. **Test:** `scan job failure shows recoverable UI and allows retry/manual confirmation`
   - **Suite:** `reorder-and-bulk-regressions.spec.ts` (or new `scan-regressions.spec.ts`)
   - **Risk covered:** scan reliability perception and recovery path
   - **Preconditions:** scan account; fixture `fixtures/scan-flow-shelf.jpg`; simulate failed poll state when feasible
   - **Stability:** flaky-risk if real provider; stable if failure is simulated post-upload

5. **Test:** `auth callback with provider error shows safe fallback and actionable message`
   - **Suite:** `smoke-regressions.spec.ts` or new `auth-regressions.spec.ts`
   - **Risk covered:** callback dead-ends and support tickets during OAuth rollout
   - **Preconditions:** direct visit to `/auth/callback?error=...` public route
   - **Stability:** stable

## 5) Tests to reconsider or remove

- Duplicate **select mode enter/exit** checks in both smoke and reorder suites: keep in one suite (reorder/bulk), remove from smoke.
- Pure “route is reachable” checks for protected pages where stronger functional checks already exist: keep one thin smoke assertion per app area only.
- Any second scan happy-path test beyond existing `@p0` real Gemini flow: avoid duplication due to runtime/flakiness cost.

## 6) Anti-patterns present or to watch for

### Codebase-specific
- **Protected-route `page.goto()` in CI**: avoid for authenticated deep links; continue using sidebar SPA navigation (`navigateProtected()` + clicks).
- **Locale-fragile selectors**: all user-facing text selectors must use cs/en regex alternation (e.g., `/Moje Knihovna|My Library/i`).
- **Overloading `@p0` with slow scan scenarios**: keep exactly one real-provider scan journey in gate.
- **Shared-account state leakage**: ensure cleanup or idempotent naming to prevent cross-test drift.

### General Playwright
- Avoid brittle CSS/xpath selectors over role/label/test-id semantics.
- Avoid arbitrary sleeps; use web-first assertions and network-aware waits.
- Avoid asserting too many unrelated outcomes in one test (low diagnosability).
- Avoid mixing product behavior validation with third-party outage sensitivity unless explicitly tagged `@slow` and quarantined.

## 7) Priority: next 3 tests to implement

1. **Member forbidden owner-only actions (UI + 403 guardrail)** — `@p0`
   - Highest security/product-trust risk; closes authorization blind spot not fully covered by nav visibility alone.

2. **Session-expiry during write operation** — `@critical`
   - High real-user pain and common production failure mode; validates resilient auth UX and prevents silent write failures.

3. **`/locations` alias redirect + functional continuation** — `@critical`
   - Fast, stable test that protects navigation contract and a core domain workflow with high usage.

---

## Notes on keeping what works

Current suite architecture is already solid: separate `@p0` gate, deterministic auth-reset mocks, dedicated slow scan flow, and helper-based setup (`login`, `createManualBook`, `createLocatedBook`, `navigateProtected`). Recommendations above intentionally avoid rewrites and focus on de-duplicating overlap + closing high-risk gaps.
