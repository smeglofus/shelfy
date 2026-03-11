from datetime import timedelta
import uuid

from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.core.config import Settings
from app.core.security import create_token, decode_token, verify_password
from app.models.user import User

logger = structlog.get_logger()


async def authenticate_user(session: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(session, email)
    if user is None or not verify_password(password, user.hashed_password):
        logger.warning("authentication_failed", email=email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    logger.info("authentication_success", user_id=str(user.id))
    return user


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    result = await session.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_id(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await session.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


def issue_token_pair(email: str, settings: Settings) -> tuple[str, str]:
    access_token = create_token(
        subject=email,
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
        token_type="access",
    )
    refresh_token = create_token(
        subject=email,
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
        token_type="refresh",
    )
    return access_token, refresh_token


def read_refresh_token_subject(token: str) -> str:
    try:
        payload = decode_token(token)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    token_type = payload.get("type")
    subject = payload.get("sub")
    if token_type != "refresh" or not isinstance(subject, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return subject
