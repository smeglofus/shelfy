"""Best-effort request → email-locale resolution.

Shared by every endpoint that fires a transactional email (register,
password reset, added-to-library, …) so the cookie/header heuristic
lives in exactly one place.
"""
from __future__ import annotations

from fastapi import Request

from app.services import email as email_svc


def email_locale_from_request(request: Request) -> str:
    """Resolve the email locale from the SPA language cookie or browser headers."""
    cookie_locale = request.cookies.get("shelfy_language")
    if cookie_locale:
        return email_svc.normalize_locale(cookie_locale)

    accept_language = request.headers.get("accept-language", "")
    first_language = accept_language.split(",", maxsplit=1)[0].strip()
    return email_svc.normalize_locale(first_language)
