"""Google OAuth 2.0 / OpenID Connect service.

Flow:
  1. GET /auth/google/authorize  →  redirect user to Google
  2. Google redirects to /auth/callback?code=…&state=…
  3. POST /auth/google/callback  →  exchange code, verify ID token, find/create user
"""
from __future__ import annotations

import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

import anyio
import httpx
import structlog
from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import create_token, decode_token, get_password_hash
from app.models.user import User
from app.services.auth import get_user_by_email
from app.services.library import create_personal_library

logger = structlog.get_logger()

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = ["openid", "email", "profile"]


# ── State JWT (CSRF protection) ────────────────────────────────────────────────

def create_oauth_state(settings: Settings) -> str:  # noqa: ARG001
    """Return a short-lived signed JWT to use as the OAuth ``state`` parameter.

    Using a self-contained JWT avoids a Redis round-trip.  The nonce embedded
    in ``sub`` makes every state value unique.
    """
    nonce = secrets.token_urlsafe(16)
    return create_token(
        subject=nonce,
        expires_delta=timedelta(minutes=10),
        token_type="oauth_state",
    )


def verify_oauth_state(state: str) -> None:
    """Decode and validate the state JWT.  Raises HTTP 400 on any failure."""
    try:
        payload = decode_token(state)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OAuth state parameter",
        ) from exc

    if payload.get("type") != "oauth_state":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OAuth state parameter",
        )


# ── Authorization URL ─────────────────────────────────────────────────────────

def build_google_authorize_url(settings: Settings, state: str) -> str:
    """Compose the Google OAuth consent screen URL."""
    params: dict[str, str] = {
        "client_id": settings.google_client_id or "",
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "state": state,
        "access_type": "offline",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_ENDPOINT}?{urllib.parse.urlencode(params)}"


# ── Token exchange + ID-token verification ─────────────────────────────────────

async def exchange_code_for_claims(code: str, settings: Settings) -> dict[str, Any]:
    """Exchange authorization code → tokens; verify and return ID-token claims.

    The ID-token verification uses the ``google-auth`` library which performs a
    synchronous HTTP request to fetch Google's public certificates.  We push it
    to a thread via ``anyio`` to avoid blocking the event loop.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )

    if resp.status_code != 200:
        logger.warning(
            "google_token_exchange_failed",
            http_status=resp.status_code,
            body=resp.text[:200],
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google token exchange failed",
        )

    token_data: dict[str, Any] = resp.json()
    raw_id_token: str | None = token_data.get("id_token")
    if not raw_id_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google did not return an ID token",
        )

    audience = settings.google_client_id

    def _verify_sync() -> dict[str, Any]:
        # Import here so the library is only loaded when Google OAuth is actually used.
        from google.auth.transport import requests as google_requests  # type: ignore[import-untyped]
        from google.oauth2 import id_token as google_id_token  # type: ignore[import-untyped]

        return google_id_token.verify_oauth2_token(  # type: ignore[no-any-return]
            raw_id_token,
            google_requests.Request(),
            audience,
        )

    try:
        claims: dict[str, Any] = await anyio.to_thread.run_sync(_verify_sync)
    except ValueError as exc:
        logger.warning("google_id_token_invalid", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google ID token verification failed",
        ) from exc

    return claims


# ── User find / link / create ─────────────────────────────────────────────────

async def find_or_create_google_user(
    session: AsyncSession,
    google_sub: str,
    email: str,
    avatar_url: str | None,
) -> User:
    """Return the User for this Google identity, creating or linking as needed.

    Lookup order:
      1. Existing user with matching ``google_sub``  →  returning Google user.
      2. Existing user with same verified email       →  auto-link the account.
      3. No match                                     →  create a new user.
    """
    now = datetime.now(timezone.utc)

    # ── 1. Returning Google user ───────────────────────────────────────────────
    result = await session.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()
    if user is not None:
        # Refresh avatar in case it changed.
        if avatar_url and user.avatar_url != avatar_url:
            user.avatar_url = avatar_url
            await session.commit()
            await session.refresh(user)
        logger.info("oauth_login_existing", user_id=str(user.id))
        return user

    # ── 2. Link to existing email account ─────────────────────────────────────
    user = await get_user_by_email(session, email)
    if user is not None:
        user.google_sub = google_sub
        user.auth_provider = "google"
        user.avatar_url = avatar_url
        user.oauth_linked_at = now
        await session.commit()
        await session.refresh(user)
        logger.info("oauth_linked_existing_account", user_id=str(user.id), email=email)
        return user

    # ── 3. Create new user ─────────────────────────────────────────────────────
    # Assign an unguessable random password so the row satisfies NOT NULL while
    # never being usable for password-based login.
    new_user = User(
        email=email,
        hashed_password=get_password_hash(secrets.token_hex(32)),
        google_sub=google_sub,
        auth_provider="google",
        avatar_url=avatar_url,
        oauth_linked_at=now,
    )
    session.add(new_user)
    await session.flush()
    await create_personal_library(session, new_user)
    await session.commit()
    await session.refresh(new_user)
    logger.info("oauth_new_user_created", user_id=str(new_user.id), email=email)
    return new_user
