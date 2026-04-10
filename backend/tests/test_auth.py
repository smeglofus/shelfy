import secrets
from collections.abc import AsyncIterator, Iterator

from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.dependencies.redis import get_redis
from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.user import User
from app.services.auth import issue_token_pair


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


class _FakeRedis:
    """Minimal Redis stub: just enough for the endpoints tested here."""
    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        pass
    async def getdel(self, key: str) -> str | None:
        return None
    async def aclose(self) -> None:
        pass


@pytest.fixture(autouse=True)
def override_dependencies(
    test_session: AsyncSession,
    test_settings: Settings,
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield test_session

    async def _get_redis() -> AsyncIterator[_FakeRedis]:
        yield _FakeRedis()

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    app.dependency_overrides[get_redis] = _get_redis
    yield
    app.dependency_overrides.clear()


async def _seed_user(session: AsyncSession) -> None:
    session.add(User(email="admin@example.com", hashed_password=get_password_hash("secret")))
    await session.commit()


@pytest.mark.asyncio
async def test_login_with_valid_credentials_returns_tokens(test_session: AsyncSession) -> None:
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert "access_token" in body
    assert "refresh_token" in body


@pytest.mark.asyncio
async def test_login_with_invalid_credentials_returns_401(test_session: AsyncSession) -> None:
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "wrong"},
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_endpoint_without_token_returns_401() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/auth/me")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_endpoint_with_valid_token_returns_200(test_session: AsyncSession) -> None:
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )
        access_token = login_response.json()["access_token"]

        response = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert response.status_code == 200
    assert response.json()["email"] == "admin@example.com"


@pytest.mark.asyncio
async def test_refresh_returns_new_access_token(test_session: AsyncSession) -> None:
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login_response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )
        refresh_token = login_response.json()["refresh_token"]

        response = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert "access_token" in response.json()



@pytest.mark.asyncio
async def test_register_creates_user(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={"email": "new.user@example.com", "password": "secret123"},
        )

    assert response.status_code == 201
    assert response.json()["email"] == "new.user@example.com"


@pytest.mark.asyncio
async def test_register_duplicate_email_returns_409(test_session: AsyncSession) -> None:
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={"email": "admin@example.com", "password": "secret"},
        )

    assert response.status_code == 409


# ── Account deletion — password / has_local_password scenarios ─────────────────


@pytest.mark.asyncio
async def test_local_user_delete_requires_correct_password(
    test_session: AsyncSession,
    test_settings: Settings,
) -> None:
    """Regular email+password account: delete without / with wrong password → 400."""
    await _seed_user(test_session)
    access_token, _ = issue_token_pair("admin@example.com", test_settings)
    headers = {"Authorization": f"Bearer {access_token}"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Empty password
        r1 = await client.request(
            "DELETE", "/api/v1/auth/me", json={"password": ""}, headers=headers
        )
        # Wrong password
        r2 = await client.request(
            "DELETE", "/api/v1/auth/me", json={"password": "wrong"}, headers=headers
        )
        # Correct password — must succeed
        r3 = await client.request(
            "DELETE", "/api/v1/auth/me", json={"password": "secret"}, headers=headers
        )

    assert r1.status_code == 400
    assert r2.status_code == 400
    assert r3.status_code == 204


@pytest.mark.asyncio
async def test_oauth_only_user_delete_no_password_required(
    test_session: AsyncSession,
    test_settings: Settings,
) -> None:
    """OAuth-only account (has_local_password=False): delete succeeds without password."""
    oauth_user = User(
        email="oauthonly@example.com",
        hashed_password=get_password_hash(secrets.token_hex(32)),  # unknown random
        google_sub="sub-oauth-only",
        auth_provider="google",
        has_local_password=False,
    )
    test_session.add(oauth_user)
    await test_session.commit()

    access_token, _ = issue_token_pair("oauthonly@example.com", test_settings)
    headers = {"Authorization": f"Bearer {access_token}"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(
            "DELETE", "/api/v1/auth/me", json={}, headers=headers
        )

    assert response.status_code == 204


@pytest.mark.asyncio
async def test_linked_user_delete_still_requires_password(
    test_session: AsyncSession,
    test_settings: Settings,
) -> None:
    """Account that started as local and later linked Google:
    auth_provider is 'google' but has_local_password is still True →
    password confirmation is required.
    """
    linked_user = User(
        email="linked@example.com",
        hashed_password=get_password_hash("mypassword"),
        google_sub="sub-linked",
        auth_provider="google",    # provider updated by link
        has_local_password=True,   # original password still valid
    )
    test_session.add(linked_user)
    await test_session.commit()

    access_token, _ = issue_token_pair("linked@example.com", test_settings)
    headers = {"Authorization": f"Bearer {access_token}"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # No password → should be rejected even though provider is 'google'
        r1 = await client.request(
            "DELETE", "/api/v1/auth/me", json={"password": ""}, headers=headers
        )
        # Correct original password → should succeed
        r2 = await client.request(
            "DELETE", "/api/v1/auth/me", json={"password": "mypassword"}, headers=headers
        )

    assert r1.status_code == 400
    assert r2.status_code == 204
