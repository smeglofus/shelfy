"""Business telemetry tests: users.last_seen_at touch + /metrics gauges.

DB fixture pattern mirrors tests/test_isolation.py (SQLite fallback
locally, Postgres via TEST_DATABASE_URL in CI).
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from datetime import datetime, timedelta, timezone
import os

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
from app.services.user_activity import LAST_SEEN_THROTTLE, touch_last_seen


def _require_test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_biz_metrics.db")


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


async def _create_user(
    session: AsyncSession,
    email: str,
    *,
    last_seen_at: datetime | None = None,
    plan: SubscriptionPlan | None = None,
    subscription_status: SubscriptionStatus = SubscriptionStatus.active,
) -> User:
    user = User(
        email=email,
        hashed_password=get_password_hash("secret"),
        last_seen_at=last_seen_at,
    )
    session.add(user)
    await session.flush()
    if plan is not None:
        session.add(Subscription(user_id=user.id, plan=plan, status=subscription_status))
    await session.refresh(user)
    return user


def _metric_value(payload: str, name: str, labels: str = "") -> float:
    needle = f"{name}{labels} "
    for line in payload.splitlines():
        if line.startswith(needle):
            return float(line.split()[-1])
    raise AssertionError(f"metric {name}{labels} not found in payload")


# ── touch_last_seen ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_touch_last_seen_writes_then_throttles(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        user = await _create_user(session, "active@example.com")
        await session.commit()

        t0 = datetime.now(timezone.utc)
        assert await touch_last_seen(session, user.id, now=t0) is True

        # Second touch inside the throttle window is a no-op.
        t1 = t0 + timedelta(minutes=1)
        assert await touch_last_seen(session, user.id, now=t1) is False

        # After the window it writes again.
        t2 = t0 + LAST_SEEN_THROTTLE + timedelta(seconds=1)
        assert await touch_last_seen(session, user.id, now=t2) is True

        # synchronize_session=False leaves the identity-map instance stale
        # on purpose — force a re-SELECT to observe the written value.
        refreshed = await session.get(User, user.id, populate_existing=True)
        assert refreshed is not None
        assert refreshed.last_seen_at is not None


@pytest.mark.asyncio
async def test_authenticated_request_stamps_last_seen(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """End-to-end: login + any authenticated call → last_seen_at is set."""
    async with test_session() as session:
        user = await _create_user(session, "active@example.com")
        lib = Library(name="L", created_by_user_id=user.id)
        session.add(lib)
        await session.flush()
        session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
        await session.commit()
        user_id = user.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login", json={"email": "active@example.com", "password": "secret"}
        )
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        response = await client.get("/api/v1/libraries", headers=headers)
        assert response.status_code == 200

    async with test_session() as session:
        refreshed = await session.get(User, user_id)
        assert refreshed is not None
        assert refreshed.last_seen_at is not None


# ── /metrics business gauges ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_metrics_reports_users_by_plan_and_activity_windows(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(timezone.utc)
    async with test_session() as session:
        # free: no subscription row at all.
        await _create_user(session, "free@example.com", last_seen_at=now - timedelta(hours=2))
        # pro, active sub, seen 3 days ago (counts for 7d + 30d).
        await _create_user(
            session, "pro@example.com",
            plan=SubscriptionPlan.pro, last_seen_at=now - timedelta(days=3),
        )
        # library plan but canceled → effective free; seen 12 days ago (30d only).
        await _create_user(
            session, "churned@example.com",
            plan=SubscriptionPlan.library,
            subscription_status=SubscriptionStatus.canceled,
            last_seen_at=now - timedelta(days=12),
        )
        # library plan, active, never seen.
        await _create_user(session, "lib@example.com", plan=SubscriptionPlan.library)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/metrics")

    assert response.status_code == 200
    payload = response.text

    assert _metric_value(payload, "shelfy_users_total") == 4
    assert _metric_value(payload, "shelfy_users_by_plan", '{plan="free"}') == 2
    assert _metric_value(payload, "shelfy_users_by_plan", '{plan="pro"}') == 1
    assert _metric_value(payload, "shelfy_users_by_plan", '{plan="library"}') == 1
    assert _metric_value(payload, "shelfy_users_by_plan", '{plan="home"}') == 0

    assert _metric_value(payload, "shelfy_active_users", '{window="1d"}') == 1
    assert _metric_value(payload, "shelfy_active_users", '{window="7d"}') == 2
    assert _metric_value(payload, "shelfy_active_users", '{window="30d"}') == 3


@pytest.mark.asyncio
async def test_metrics_reports_inventory_totals(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        lib = Library(name="L", created_by_user_id=owner.id)
        session.add(lib)
        await session.flush()
        session.add(LibraryMember(library_id=lib.id, user_id=owner.id, role=LibraryRole.OWNER))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/metrics")

    assert response.status_code == 200
    payload = response.text
    assert _metric_value(payload, "shelfy_libraries_total") == 1
    assert _metric_value(payload, "shelfy_books_total") == 0
    assert _metric_value(payload, "shelfy_active_loans_total") == 0
    assert _metric_value(payload, "shelfy_wishlist_items_total") == 0
