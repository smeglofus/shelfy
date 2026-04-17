"""CSRF protection middleware — double-submit cookie pattern.

Why double-submit and not a session-bound server secret?
  The app is already stateless (JWT). A server-bound CSRF secret would
  force us to introduce a session table just for CSRF, which is high
  cost for little extra security over double-submit when the cookie is
  SameSite=Lax + Secure and the comparison is constant-time.

Invariant enforced:
  For every unsafe (POST/PUT/PATCH/DELETE) request to a protected path:
    EITHER
      - the request authenticates via ``Authorization: Bearer …``
        (mobile / CLI client — cross-origin fetch can't attach this
        header without a preflight that CORS blocks, so such a client
        is not exposed to CSRF), OR
      - the request carries BOTH a ``csrf_token`` cookie AND a matching
        ``X-CSRF-Token`` header (constant-time compare).
    Otherwise the request is rejected 403.

Whitelist (no CSRF enforced):
  - Unauthenticated endpoints that *establish* a session — login,
    register, refresh, Google OAuth authorize / callback. These create
    the CSRF cookie; there's nothing to CSRF yet.
  - The Stripe webhook, which is authenticated by HMAC signature, not
    cookies.
  - All safe methods (GET / HEAD / OPTIONS).

Left as future work (#117 follow-up):
  - CSRF token rotation on privilege escalation.
"""
from __future__ import annotations

import hmac
from collections.abc import Awaitable, Callable
from typing import Final

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.cookies import CSRF_COOKIE_NAME, CSRF_HEADER_NAME

_SAFE_METHODS: Final = frozenset({"GET", "HEAD", "OPTIONS"})

# Endpoints where a CSRF token cannot possibly exist yet (pre-session)
# or where auth is not cookie-based. Exact path match.
_WHITELIST_PATHS: Final = frozenset(
    {
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/refresh",
        "/api/v1/auth/google/authorize",
        "/api/v1/auth/google/callback",
        # Stripe webhook is authenticated by signed payload, not cookies.
        "/api/v1/billing/webhook",
        "/api/v1/billing/stripe/webhook",
        # Frontend error beacon is public and unauthenticated.
        "/api/v1/telemetry/frontend-error",
    }
)


def _is_whitelisted(path: str) -> bool:
    if path in _WHITELIST_PATHS:
        return True
    # Prometheus / health paths never require CSRF.
    return path.startswith("/health") or path == "/metrics"


class CSRFMiddleware(BaseHTTPMiddleware):
    """Enforce the double-submit CSRF invariant described in this module's docstring."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.method in _SAFE_METHODS:
            return await call_next(request)

        if _is_whitelisted(request.url.path):
            return await call_next(request)

        # Bearer clients are immune to CSRF (see module docstring).
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            return await call_next(request)

        # Cookie-bearing clients MUST prove possession of the csrf_token
        # cookie by echoing it back in the X-CSRF-Token header.
        cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
        header_token = request.headers.get(CSRF_HEADER_NAME)

        if not cookie_token or not header_token:
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token missing"},
            )

        # Constant-time compare — prevents timing side channels.
        if not hmac.compare_digest(cookie_token, header_token):
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token mismatch"},
            )

        return await call_next(request)
