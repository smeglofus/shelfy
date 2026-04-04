from collections.abc import AsyncIterator, Iterator

from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.user import User


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
def test_settings() -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        jwt_algorithm="HS256",
        access_token_expire_minutes=15,
        refresh_token_expire_days=7,
    )


@pytest.fixture(autouse=True)
def override_dependencies(
    test_session: AsyncSession,
    test_settings: Settings,
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield test_session

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield
    app.dependency_overrides.clear()


async def _seed_and_login(session: AsyncSession, client: AsyncClient) -> dict[str, str]:
    """Create a test user and return auth headers."""
    session.add(User(email="admin@example.com", hashed_password=get_password_hash("secret")))
    await session.commit()

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "secret"},
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ── Auth guard ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_onboarding_endpoints_require_auth() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/v1/settings/onboarding")).status_code == 401
        assert (await client.post("/api/v1/settings/onboarding/complete")).status_code == 401
        assert (await client.post("/api/v1/settings/onboarding/skip")).status_code == 401
        assert (await client.post("/api/v1/settings/onboarding/reset")).status_code == 401


# ── Initial state ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_new_user_should_show_onboarding(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _seed_and_login(test_session, client)
        response = await client.get("/api/v1/settings/onboarding", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["should_show"] is True
    assert body["completed_at"] is None
    assert body["skipped_at"] is None


# ── Complete ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_complete_onboarding(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _seed_and_login(test_session, client)

        response = await client.post("/api/v1/settings/onboarding/complete", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["should_show"] is False
        assert body["completed_at"] is not None
        assert body["skipped_at"] is None

        # GET should confirm
        response = await client.get("/api/v1/settings/onboarding", headers=headers)
        assert response.json()["should_show"] is False


# ── Skip ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_skip_onboarding(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _seed_and_login(test_session, client)

        response = await client.post("/api/v1/settings/onboarding/skip", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["should_show"] is False
        assert body["skipped_at"] is not None
        assert body["completed_at"] is None

        # GET should confirm
        response = await client.get("/api/v1/settings/onboarding", headers=headers)
        assert response.json()["should_show"] is False


# ── Reset ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reset_after_complete(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _seed_and_login(test_session, client)

        # Complete first
        await client.post("/api/v1/settings/onboarding/complete", headers=headers)

        # Reset
        response = await client.post("/api/v1/settings/onboarding/reset", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["should_show"] is True
        assert body["completed_at"] is None
        assert body["skipped_at"] is None


@pytest.mark.asyncio
async def test_reset_after_skip(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _seed_and_login(test_session, client)

        # Skip first
        await client.post("/api/v1/settings/onboarding/skip", headers=headers)

        # Reset
        response = await client.post("/api/v1/settings/onboarding/reset", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["should_show"] is True


# ── Full state cycle ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_cycle_show_skip_reset_complete(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _seed_and_login(test_session, client)

        # 1. Initial: should show
        r = await client.get("/api/v1/settings/onboarding", headers=headers)
        assert r.json()["should_show"] is True

        # 2. Skip
        r = await client.post("/api/v1/settings/onboarding/skip", headers=headers)
        assert r.json()["should_show"] is False

        # 3. Reset
        r = await client.post("/api/v1/settings/onboarding/reset", headers=headers)
        assert r.json()["should_show"] is True

        # 4. Complete
        r = await client.post("/api/v1/settings/onboarding/complete", headers=headers)
        assert r.json()["should_show"] is False
        assert r.json()["completed_at"] is not None
