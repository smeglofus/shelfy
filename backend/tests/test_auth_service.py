"""Service-level tests for app/services/auth.py."""
import uuid
from collections.abc import AsyncIterator

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.models.user import User
from app.services.auth import (
    authenticate_user,
    get_user_by_email,
    get_user_by_id,
    issue_token_pair,
    read_refresh_token_subject,
    register_user,
)


@pytest.fixture
async def test_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture
def settings() -> Settings:
    return Settings()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _make_user(session: AsyncSession, email: str = "user@example.com", password: str = "secret") -> User:
    user = User(email=email, hashed_password=get_password_hash(password))
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


# ── get_user_by_email ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_user_by_email_found(test_session: AsyncSession) -> None:
    await _make_user(test_session, "alice@example.com")
    result = await get_user_by_email(test_session, "alice@example.com")
    assert result is not None
    assert result.email == "alice@example.com"


@pytest.mark.asyncio
async def test_get_user_by_email_not_found(test_session: AsyncSession) -> None:
    result = await get_user_by_email(test_session, "ghost@example.com")
    assert result is None


# ── get_user_by_id ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_user_by_id_found(test_session: AsyncSession) -> None:
    user = await _make_user(test_session, "bob@example.com")
    result = await get_user_by_id(test_session, user.id)
    assert result is not None
    assert result.id == user.id


@pytest.mark.asyncio
async def test_get_user_by_id_not_found(test_session: AsyncSession) -> None:
    result = await get_user_by_id(test_session, uuid.uuid4())
    assert result is None


# ── authenticate_user ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_authenticate_user_success(test_session: AsyncSession) -> None:
    await _make_user(test_session, "carol@example.com", "mypassword")
    user = await authenticate_user(test_session, "carol@example.com", "mypassword")
    assert user.email == "carol@example.com"


@pytest.mark.asyncio
async def test_authenticate_user_wrong_password(test_session: AsyncSession) -> None:
    await _make_user(test_session, "dan@example.com", "correct")
    with pytest.raises(HTTPException) as exc:
        await authenticate_user(test_session, "dan@example.com", "wrong")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_authenticate_user_unknown_email(test_session: AsyncSession) -> None:
    with pytest.raises(HTTPException) as exc:
        await authenticate_user(test_session, "nobody@example.com", "whatever")
    assert exc.value.status_code == 401


# ── issue_token_pair ──────────────────────────────────────────────────────────

def test_issue_token_pair_returns_two_non_empty_strings(settings: Settings) -> None:
    access, refresh = issue_token_pair("user@example.com", settings)
    assert isinstance(access, str) and len(access) > 10
    assert isinstance(refresh, str) and len(refresh) > 10
    assert access != refresh


# ── read_refresh_token_subject ────────────────────────────────────────────────

def test_read_refresh_token_subject_success(settings: Settings) -> None:
    _, refresh = issue_token_pair("eve@example.com", settings)
    subject = read_refresh_token_subject(refresh)
    assert subject == "eve@example.com"


def test_read_refresh_token_subject_rejects_access_token(settings: Settings) -> None:
    access, _ = issue_token_pair("eve@example.com", settings)
    with pytest.raises(HTTPException) as exc:
        read_refresh_token_subject(access)
    assert exc.value.status_code == 401


def test_read_refresh_token_subject_rejects_garbage(settings: Settings) -> None:
    with pytest.raises(HTTPException) as exc:
        read_refresh_token_subject("not.a.token")
    assert exc.value.status_code == 401


# ── register_user ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_register_user_success(test_session: AsyncSession) -> None:
    user = await register_user(test_session, "newuser@example.com", "strongpassword")
    assert user.id is not None
    assert user.email == "newuser@example.com"

    # Subscription should have been created
    from sqlalchemy import select
    from app.models.subscription import Subscription, SubscriptionPlan, SubscriptionStatus
    sub = (await test_session.execute(
        select(Subscription).where(Subscription.user_id == user.id)
    )).scalar_one_or_none()
    assert sub is not None
    assert sub.plan == SubscriptionPlan.free
    assert sub.status == SubscriptionStatus.active


@pytest.mark.asyncio
async def test_register_user_creates_personal_library(test_session: AsyncSession) -> None:
    from sqlalchemy import select
    from app.models.library import LibraryMember, LibraryRole

    user = await register_user(test_session, "libuser@example.com", "password123")

    member = (await test_session.execute(
        select(LibraryMember).where(LibraryMember.user_id == user.id)
    )).scalar_one_or_none()
    assert member is not None
    assert member.role == LibraryRole.OWNER


@pytest.mark.asyncio
async def test_register_user_duplicate_email_raises_409(test_session: AsyncSession) -> None:
    await register_user(test_session, "dup@example.com", "password1")
    with pytest.raises(HTTPException) as exc:
        await register_user(test_session, "dup@example.com", "password2")
    assert exc.value.status_code == 409
