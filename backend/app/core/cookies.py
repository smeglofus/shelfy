"""Auth cookie helpers.

Centralises the single source of truth for how access, refresh and CSRF
cookies are set / cleared. All cookie attributes live here so auth and
OAuth endpoints can't drift.

Naming rationale:
  - ``access_token``:  HttpOnly, short-lived (matches access JWT TTL).
    Path=/api/v1 so it accompanies every API request without being sent
    to any other path.
  - ``refresh_token``: HttpOnly, long-lived. Path=/api/v1/auth narrows it
    to the auth router only — it's never exposed to business endpoints,
    reducing the blast radius of a log-leak / MITM.
  - ``csrf_token``:    NOT HttpOnly (JS must read it to echo in the
    ``X-CSRF-Token`` header). Acts as the server side of the double-submit
    pattern enforced by ``app.core.csrf``. Tied to the session lifetime
    of the refresh token so it rotates on login / logout together.
"""
from __future__ import annotations

import secrets
from typing import Final, Literal

from fastapi import Response

from app.core.config import Settings

ACCESS_COOKIE_NAME: Final = "access_token"
REFRESH_COOKIE_NAME: Final = "refresh_token"
CSRF_COOKIE_NAME: Final = "csrf_token"

# Header the frontend echoes the csrf_token cookie value back on. Kept
# deliberately un-namespaced to follow Django / Rails convention.
CSRF_HEADER_NAME: Final = "X-CSRF-Token"

_ACCESS_PATH: Final = "/api/v1"
_REFRESH_PATH: Final = "/api/v1/auth"
_CSRF_PATH: Final = "/"


def _cookie_secure(settings: Settings) -> bool:
    """Secure flag on by default; off only in explicit development.

    Safe default: any misconfigured environment string (staging, preview…)
    gets Secure=True and will fail loudly on plain HTTP rather than silently
    leaking cookies.
    """
    return settings.environment != "development"


def _samesite(settings: Settings) -> Literal["lax", "strict", "none"]:
    # Lax is the right default for a traditional web app: blocks CSRF from
    # cross-site POSTs but allows top-level navigation (e.g. clicking a link
    # from an email lands you logged-in).
    return "lax"


def generate_csrf_token() -> str:
    """Return a fresh 256-bit URL-safe token (~43 chars)."""
    return secrets.token_urlsafe(32)


def set_auth_cookies(
    response: Response,
    *,
    settings: Settings,
    access_token: str,
    refresh_token: str,
    csrf_token: str | None = None,
) -> str:
    """Attach the three session cookies to *response* and return the csrf token.

    Callers should persist the returned ``csrf_token`` value to the response
    body when useful (e.g. the login JSON payload) so a client that just
    loaded the page can read it without waiting for the next response.
    A freshly generated token is used when one is not supplied so every
    new session rotates the CSRF secret.
    """
    secure = _cookie_secure(settings)
    samesite = _samesite(settings)
    csrf_value = csrf_token or generate_csrf_token()

    # httponly=True → inaccessible to document.cookie / fetch; the key
    # ingredient that makes XSS-theft of JWTs meaningfully harder.
    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=access_token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=secure,
        samesite=samesite,
        path=_ACCESS_PATH,
    )
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        httponly=True,
        secure=secure,
        samesite=samesite,
        path=_REFRESH_PATH,
    )
    # csrf_token is *readable* by JS on purpose — double-submit pattern
    # requires the client to copy the cookie value into the request header.
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_value,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        httponly=False,
        secure=secure,
        samesite=samesite,
        path=_CSRF_PATH,
    )
    return csrf_value


def set_access_cookie(
    response: Response,
    *,
    settings: Settings,
    access_token: str,
) -> None:
    """Refresh the short-lived access cookie only (used by /auth/refresh)."""
    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=access_token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=_cookie_secure(settings),
        samesite=_samesite(settings),
        path=_ACCESS_PATH,
    )


def clear_auth_cookies(response: Response, *, settings: Settings) -> None:
    """Expire all three cookies. Called on logout and on refresh failure.

    Paths must match exactly — browsers key cookies on (name, domain, path).
    """
    secure = _cookie_secure(settings)
    samesite = _samesite(settings)
    for name, path in (
        (ACCESS_COOKIE_NAME, _ACCESS_PATH),
        (REFRESH_COOKIE_NAME, _REFRESH_PATH),
        (CSRF_COOKIE_NAME, _CSRF_PATH),
    ):
        response.set_cookie(
            key=name,
            value="",
            max_age=0,
            expires=0,
            httponly=(name != CSRF_COOKIE_NAME),
            secure=secure,
            samesite=samesite,
            path=path,
        )
