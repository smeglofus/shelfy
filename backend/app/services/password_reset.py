from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import redis.asyncio as aioredis
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.models.password_reset_token import PasswordResetToken
from app.models.user import User

TOKEN_TTL_MINUTES = 60
REQUEST_LIMIT_PER_EMAIL = 3


def _hash_token(plaintext: str) -> str:
    """SHA-256 hex digest for token lookup/storage."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


async def _check_and_bump_email_rate_limit(
    redis_client: aioredis.Redis, email: str
) -> bool:
    """Atomic INCR + first-write EXPIRE limiter keyed by lowercase email."""
    ttl_seconds = get_settings().password_reset_ttl_minutes * 60
    key = f"pwreset:email:{email.lower()}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, ttl_seconds)
    return count <= REQUEST_LIMIT_PER_EMAIL


async def create_reset_token(
    session: AsyncSession,
    user: User,
    *,
    requested_ip: str | None,
    requested_user_agent: str | None,
) -> str:
    """Create and persist a password-reset token hash; return plaintext token."""
    plaintext = secrets.token_urlsafe(32)
    token = PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_token(plaintext),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MINUTES),
        requested_ip=requested_ip,
        requested_user_agent=(requested_user_agent or "")[:512],
    )
    session.add(token)
    await session.flush()
    return plaintext


async def consume_reset_token(
    session: AsyncSession, plaintext_token: str, new_password: str
) -> User:
    """Verify + consume reset token and rotate password atomically."""
    token_hash = _hash_token(plaintext_token)
    result = await session.execute(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == token_hash)
        .with_for_update()
    )
    token = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if token is None or token.used_at is not None or token.expires_at < now:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = await session.get(User, token.user_id)
    if user is None or not user.has_local_password:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.hashed_password = get_password_hash(new_password)
    user.password_changed_at = now
    token.used_at = now

    await session.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.id != token.id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )

    await session.commit()
    return user
