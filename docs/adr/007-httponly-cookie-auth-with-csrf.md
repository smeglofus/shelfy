# ADR 007: HttpOnly cookie auth with CSRF double-submit

- **Status:** Accepted
- **Date:** 2026-04-17

## Context

The SPA originally stored the JWT access and refresh tokens in `localStorage` and echoed
the access token into an `Authorization: Bearer …` header on every XHR. That layout is
straightforward for SPA-only deploys, but it gives **any** successful XSS payload instant,
long-lived takeover: it only needs to read two `localStorage` keys and either replay them
against our API or exfiltrate them to an attacker-controlled endpoint. Rotating refresh
tokens does not help — the attacker simply rotates alongside the victim.

A pre-launch security review flagged browser storage of long-lived credentials as the
highest-impact session-hijack vector the app still carried.

We also want to preserve a token flow that works outside of browsers (mobile clients, CLI
tooling, the E2E rig) where cookies are inconvenient or impossible.

## Decision

Move browser session credentials off `localStorage` and onto HttpOnly cookies, add CSRF
protection with the double-submit cookie pattern, and keep Bearer-token auth as a
deliberate backward-compatible second path for non-browser clients.

### Cookie layout

`backend/app/core/cookies.py` issues three cookies on login / refresh / OAuth callback:

| Cookie          | HttpOnly | Secure¹ | SameSite | Path             | Purpose                          |
|-----------------|----------|---------|----------|------------------|----------------------------------|
| `access_token`  | yes      | yes     | Lax      | `/api/v1`        | Short-lived (15 min) JWT         |
| `refresh_token` | yes      | yes     | Lax      | `/api/v1/auth`   | Long-lived (7 day) JWT           |
| `csrf_token`    | **no**   | yes     | Lax      | `/`              | Double-submit CSRF nonce         |

¹ `Secure` is set in all environments except `ENVIRONMENT=development` so local HTTP dev
  over Vite still works.

`csrf_token` is deliberately **not** HttpOnly: JS must be able to read it to echo into the
`X-CSRF-Token` header on mutations (double-submit pattern). The HttpOnly access/refresh
cookies are never visible to JS.

### CSRF middleware

`backend/app/core/csrf.py` adds a Starlette middleware that:

- Skips safe methods (`GET`, `HEAD`, `OPTIONS`).
- Skips requests carrying an `Authorization` header (Bearer clients can't be CSRF'd — the
  attacker has no way to plant a bearer header cross-origin).
- Skips a small whitelist of endpoints that intentionally accept cross-origin POSTs:
  login/register, refresh, OAuth authorize+callback, Stripe webhook (HMAC-signed),
  anonymous telemetry, health, metrics.
- For everything else, requires `csrf_token` cookie and `X-CSRF-Token` header to match via
  `hmac.compare_digest` — rejects with 403 otherwise.

### Dual-auth dependency

`backend/app/api/dependencies/auth.py` now reads the access token cookie first, falls back
to the `Authorization: Bearer` header, and only 401s if neither is present. That gives us
a single auth resolver that covers both flows without per-endpoint branching.

### Frontend changes

- `frontend/src/lib/auth.ts` no longer writes to storage. It keeps an in-memory
  `accessToken` presence flag so React can render authenticated UI without a round-trip,
  but the authoritative answer is always whatever `GET /api/v1/auth/me` returns at
  bootstrap.
- `frontend/src/lib/api.ts` switches to `axios.create({ withCredentials: true })`, drops
  the `Authorization` header on browser requests, and attaches `X-CSRF-Token` on mutating
  methods (reads `csrf_token` cookie via `document.cookie`).
- The 401-retry interceptor no longer juggles header state after refresh because the
  server rotates the cookie server-side.
- Vite's dev server now proxies `/api` to the backend (default `http://localhost:8000`,
  overridable via `VITE_DEV_PROXY_TARGET`). SameSite=Lax cookies only flow on same-origin
  XHR, so the dev backend has to appear at the same origin as the SPA. Production already
  merges frontend + API under one origin via Traefik.

## Consequences

### Positive

- **XSS blast radius is dramatically smaller.** An XSS can no longer exfiltrate the
  session — the browser will send cookies on same-origin requests, but the tokens
  themselves are invisible to JS.
- **CSRF is closed.** Mutations require both the cookie and the matching header; the
  attacker can't forge the header from another origin.
- **Bearer flow is preserved** for mobile, CLI, and E2E API tests — no breakage for any
  non-browser consumer. The response body still returns `access_token` and `refresh_token`
  on login so programmatic clients can keep using them.
- **Refresh logic is simpler on the frontend** (no header surgery after rotation — the
  server just rewrites the cookie).

### Tradeoffs

- **Same-origin requirement in dev.** SameSite=Lax doesn't flow across `localhost:5173 →
  localhost:8000`, so we need the Vite proxy. That is a small configuration cost we pay
  in exchange for the cookie security story.
- **CSRF whitelist requires review discipline.** Any new cross-origin endpoint (Stripe
  webhook, OAuth callback, telemetry) must be explicitly whitelisted. The risk is an
  engineer adding a similar endpoint and forgetting — mitigated by a short, centralized
  list in `csrf.py`.
- **Two auth paths to maintain.** Cookie and Bearer share a dependency, but reviewers now
  have to remember there are two ways a request can be authenticated. Worth it for the
  mobile/CLI story.
- **Cookie attributes must stay in lock-step with deployment topology.** If we ever put
  the frontend and backend on different eTLD+1 domains, SameSite=Lax is not enough and we
  need to revisit (likely SameSite=None + strict origin checking).

## Migration notes

- Old clients that still have `shelfy.refreshToken` in `localStorage` will see their
  bootstrap `/auth/me` call return 401 on first load post-deploy, fall through to the
  login page, and get a fresh cookie pair on re-login. No server-side migration required.
- `clearTokens()` was retained as the single "forget the in-memory marker" entry point,
  but the refresh-token key is gone; the only lingering `localStorage` key the auth code
  touches is `shelfy_onboarding_dismissed` (removed on logout, unrelated to auth).

## Testing

- `backend/tests/test_auth.py` — 10 new cases covering: cookie attributes (HttpOnly,
  Secure, SameSite, Path, Max-Age), cookie-auth happy path, refresh via cookie, refresh
  401 when neither cookie nor body is provided, logout clears all three cookies, CSRF
  blocks missing header, CSRF blocks mismatched header, CSRF exempts Bearer requests,
  CSRF happy path, whitelisted endpoints accept cross-origin POSTs.
- `e2e/tests/p0-release-gate.spec.ts` — the existing `auth login + logout flow` exercises
  the cookie path end-to-end: login via form submission (sets cookies), SPA nav to
  settings (cookie auth), logout (clears cookies), redirect to `/login`. Cookies are
  automatically persisted by Playwright across navigations.
- `e2e/tests/scan-account-reset-flow.spec.ts` — continues to use the Bearer flow to prove
  backward compatibility for non-browser clients.
- `frontend/src/lib/api.auth-epoch.test.ts` — pins the auth-epoch guard from #125. Four
  cases: outbound requests are tagged with the current epoch, a stale-epoch 401 rejects
  silently without firing refresh or `onUnauthorized`, a current-epoch 401 still runs
  the refresh path, and a 401 from `/auth/refresh` itself does not recurse. Without
  this file the guard was carried by comments alone — a future refactor that removed
  the tagging or the stale check would not have broken any test.
