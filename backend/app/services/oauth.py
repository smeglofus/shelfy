"""Google OAuth 2.0 / OpenID Connect service.

Flow:
  1. GET /auth/google/authorize  →  build consent URL, store one-time nonce in Redis
  2. Google redirects to /auth/callback?code=…&state=…
  3. POST /auth/google/callback  →  verify state (CSRF + anti-replay), exchange code,
     verify ID token, find/create user
"""
from __future__ import annotations

import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

import anyio
import httpx
import redis.asyncio as aioredis
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

# Redis key prefix and TTL for one-time state nonces.
# The JWT expiry is set to the same value so both guards expire together.
_STATE_PREFIX = "oauth:state:"
_STATE_TTL_SECONDS = 600  # 10 minutes


# ── State JWT — CSRF + anti-replay ────────────────────────────────────────────

async def create_oauth_state(redis_client: aioredis.Redis) -> str:
    """Generate a one-time OAuth state token.

    Two-layer protection:
    * **Signed JWT** — tamper-proof; verifies origin and expiry without a
      DB/Redis lookup.
    * **Redis nonce** — single-use enforcement; the nonce is stored with a TTL
      and atomically consumed on the first callback, making replays impossible.
    """
    nonce = secrets.token_urlsafe(16)
    # Store the nonce server-side; consumed exactly once in verify_oauth_state.
    await redis_client.set(f"{_STATE_PREFIX}{nonce}", "1", ex=_STATE_TTL_SECONDS)
    return create_token(
        subject=nonce,
        expires_delta=timedelta(seconds=_STATE_TTL_SECONDS),
        token_type="oauth_state",
    )


async def verify_oauth_state(state: str, redis_client: aioredis.Redis) -> None:
    """Validate the OAuth state parameter.  Raises HTTP 400 on any failure.

    Checks (in order):
    1. JWT signature is valid and was issued by us.
    2. JWT has not expired.
    3. ``type`` claim equals ``"oauth_state"`` (prevents re-use of other JWTs).
    4. Nonce is present in Redis → atomically deleted (one-time use).
    """
    # 1 + 2. Cryptographic validation
    try:
        payload = decode_token(state)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OAuth state parameter",
        ) from exc

    # 3. Purpose check
    if payload.get("type") != "oauth_state":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OAuth state parameter",
        )

    nonce: str = payload.get("sub", "")

    # 4. One-time use: GETDEL returns the stored value and deletes the key
    #    atomically.  Returns None if the key never existed or was already used.
    stored = await redis_client.getdel(f"{_STATE_PREFIX}{nonce}")
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OAuth state has already been used or has expired",
        )


# ── Authorization URL ─────────────────────────────────────────────────────────

def build_google_authorize_url(settings: Settings, state: str) -> str:
    """Compose the Google OAuth consent-screen URL."""
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


# ── Token exchange + ID-token verification ────────────────────────────────────

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
            # Log response body truncated; never log secrets/tokens.
            body_preview=resp.text[:200],
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
        # Import lazily — only loaded when Google OAuth is actually used.
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
         ``has_local_password`` is preserved (True if they had a real password).
      3. No match                                     →  create a new user.
         ``has_local_password=False`` because no user-known password was set.
    """
    now = datetime.now(timezone.utc)

    # ── 1. Returning Google user ───────────────────────────────────────────────
    result = await session.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()
    if user is not None:
        if avatar_url and user.avatar_url != avatar_url:
            user.avatar_url = avatar_url
            await session.commit()
            await session.refresh(user)
        logger.info("oauth_login_existing", user_id=str(user.id))
        return user

    # ── 2. Link to existing email+password account ────────────────────────────
    user = await get_user_by_email(session, email)
    if user is not None:
        user.google_sub = google_sub
        user.auth_provider = "google"
        user.avatar_url = avatar_url
        user.oauth_linked_at = now
        # Deliberately NOT changing has_local_password — the user still knows
        # their original password, so account deletion must still confirm it.
        await session.commit()
        await session.refresh(user)
        logger.info("oauth_linked_existing_account", user_id=str(user.id), email=email)
        return user

    # ── 3. Create new OAuth-only user ─────────────────────────────────────────
    # Assign an unguessable random password so the NOT NULL constraint is
    # satisfied while making password-based login impossible for this account.
    new_user = User(
        email=email,
        hashed_password=get_password_hash(secrets.token_hex(32)),
        google_sub=google_sub,
        auth_provider="google",
        has_local_password=False,   # no user-known password → no password required for delete
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
