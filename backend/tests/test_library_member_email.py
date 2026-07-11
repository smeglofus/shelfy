"""API tests for the added-to-library notification (#312).

POST /api/v1/libraries/{id}/members schedules ``send_added_to_library``
as a fire-and-forget background task — only for a *new* membership, not
for a role upsert, and not when the owner adds themselves. ASGITransport
runs FastAPI BackgroundTasks after the response, so the patched mock is
awaited by the time the client call returns.

DB fixture pattern mirrors tests/test_isolation.py (SQLite fallback
locally, Postgres via TEST_DATABASE_URL in CI).
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
import os
from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.subscription import Subscription, SubscriptionPlan, SubscriptionStatus
from app.models.user import User


def _require_test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_member_email.db")


@pytest.fixture
async def test_session() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(_require_test_database_url())
    async with engine.begin() as connection:
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "manual", "pending", "done", "failed", "partial",
                name="book_processing_status",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "unread", "reading", "read", "lent",
                name="reading_status",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "owner", "editor", "viewer",
                name="library_role",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield session_factory
    await engine.dispose()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        database_url=_require_test_database_url(),
        jwt_secret_key="test-secret",
    )


@pytest.fixture(autouse=True)
def override_dependencies(
    test_session: async_sessionmaker[AsyncSession], test_settings: Settings
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with test_session() as session:
            yield session

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield
    app.dependency_overrides.clear()


async def _create_user(session: AsyncSession, email: str, password: str = "secret") -> User:
    user = User(email=email, hashed_password=get_password_hash(password))
    session.add(user)
    await session.flush()
    await session.refresh(user)
    return user


async def _create_library_with_owner(
    session: AsyncSession, owner: User, name: str = "Shared Library"
) -> Library:
    lib = Library(name=name, created_by_user_id=owner.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=owner.id, role=LibraryRole.OWNER))
    return lib


async def _give_plan(session: AsyncSession, user: User, plan: SubscriptionPlan) -> None:
    session.add(
        Subscription(user_id=user.id, plan=plan, status=SubscriptionStatus.active)
    )


async def _login(client: AsyncClient, email: str, password: str = "secret") -> dict[str, str]:
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_new_member_schedules_added_to_library_email(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        await _create_user(session, "member@example.com")
        lib = await _create_library_with_owner(session, owner, "Rodinná knihovna")
        await _give_plan(session, owner, SubscriptionPlan.pro)
        await session.commit()

    send_mock = AsyncMock()
    with patch("app.api.libraries.email_svc.send_added_to_library", send_mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = await _login(client, "owner@example.com")
            response = await client.post(
                f"/api/v1/libraries/{lib.id}/members",
                json={"email": "member@example.com", "role": "editor"},
                headers=headers,
                cookies={"shelfy_language": "cs"},
            )

    assert response.status_code == 200
    send_mock.assert_awaited_once_with(
        "member@example.com",
        "Rodinná knihovna",
        "editor",
        "owner@example.com",
        locale="cs",
    )


@pytest.mark.asyncio
async def test_role_upsert_does_not_schedule_email(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        member = await _create_user(session, "member@example.com")
        lib = await _create_library_with_owner(session, owner)
        session.add(LibraryMember(library_id=lib.id, user_id=member.id, role=LibraryRole.VIEWER))
        await _give_plan(session, owner, SubscriptionPlan.pro)
        await session.commit()

    send_mock = AsyncMock()
    with patch("app.api.libraries.email_svc.send_added_to_library", send_mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = await _login(client, "owner@example.com")
            response = await client.post(
                f"/api/v1/libraries/{lib.id}/members",
                json={"email": "member@example.com", "role": "editor"},
                headers=headers,
            )

    assert response.status_code == 200
    assert response.json()["role"] == "editor"
    send_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_owner_adding_self_does_not_schedule_email(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        lib = await _create_library_with_owner(session, owner)
        await _give_plan(session, owner, SubscriptionPlan.pro)
        await session.commit()

    send_mock = AsyncMock()
    with patch("app.api.libraries.email_svc.send_added_to_library", send_mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = await _login(client, "owner@example.com")
            response = await client.post(
                f"/api/v1/libraries/{lib.id}/members",
                json={"email": "owner@example.com", "role": "owner"},
                headers=headers,
            )

    assert response.status_code == 200
    send_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_member_survives_expire_on_commit_sessions(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Regression for the prod 500 (MissingGreenlet) on member add.

    The app's real ``SessionLocal`` used to expire ORM instances on commit;
    ``create_member`` then touched ``member.user_id`` after ``commit()``,
    which lazy-loads synchronously and explodes inside the async endpoint
    (the member row was already committed — user saw the member appear AND
    a 500 toast). Test fixtures all use ``expire_on_commit=False``, so this
    override reproduces the production semantics explicitly.
    """
    engine = test_session.kw["bind"]
    strict_factory = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=True
    )

    async def _strict_db() -> AsyncIterator[AsyncSession]:
        async with strict_factory() as session:
            yield session

    app.dependency_overrides[get_db_session] = _strict_db

    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        await _create_user(session, "member@example.com")
        lib = await _create_library_with_owner(session, owner, "Rodinná knihovna")
        await _give_plan(session, owner, SubscriptionPlan.pro)
        await session.commit()

    send_mock = AsyncMock()
    with patch("app.api.libraries.email_svc.send_added_to_library", send_mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = await _login(client, "owner@example.com")
            response = await client.post(
                f"/api/v1/libraries/{lib.id}/members",
                json={"email": "member@example.com", "role": "viewer"},
                headers=headers,
            )

    assert response.status_code == 200
    assert response.json()["role"] == "viewer"
    send_mock.assert_awaited_once()
