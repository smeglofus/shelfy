"""Tests for Google OAuth 2.0 endpoints.

Strategy
--------
* GET /api/v1/auth/google/authorize — unit-level: verify URL shape and 501 when
  Google OAuth is not configured.
* POST /api/v1/auth/google/callback — integration-level: mock httpx and the
  google-auth ID-token verification so no real network calls are made.

All tests use the same SQLite-in-memory session + settings override approach as
test_auth.py.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient, Response as HttpxResponse
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.user import User
from app.services.oauth import create_oauth_state, verify_oauth_state


# ── Shared fixtures ────────────────────────────────────────────────────────────

@pytest.fixture
async def test_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
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
        google_client_id="test-client-id",
        google_client_secret="test-client-secret",
        google_redirect_uri="http://localhost:5173/auth/callback",
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


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_google_claims(
    sub: str = "google-sub-123",
    email: str = "oauth@example.com",
    email_verified: bool = True,
    picture: str | None = "https://example.com/avatar.jpg",
) -> dict[str, Any]:
    return {"sub": sub, "email": email, "email_verified": email_verified, "picture": picture}


def _mock_google_exchange(claims: dict[str, Any]) -> Any:
    """Context manager that patches httpx.post and google id_token verification."""
    token_resp = MagicMock(spec=HttpxResponse)
    token_resp.status_code = 200
    token_resp.json.return_value = {"id_token": "fake.id.token", "access_token": "fake_access"}

    mock_async_client = AsyncMock()
    mock_async_client.__aenter__.return_value.post = AsyncMock(return_value=token_resp)

    return patch.multiple(
        "app.services.oauth",
        httpx=MagicMock(AsyncClient=MagicMock(return_value=mock_async_client)),
    )


# ── State JWT tests ────────────────────────────────────────────────────────────

def test_oauth_state_create_and_verify(test_settings: Settings) -> None:
    state = create_oauth_state(test_settings)
    assert isinstance(state, str)
    assert len(state) > 20
    # Should not raise
    verify_oauth_state(state)


def test_oauth_state_invalid_raises() -> None:
    import pytest
    with pytest.raises(Exception):
        verify_oauth_state("not.a.valid.jwt")


# ── GET /authorize ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_authorize_returns_google_url(test_settings: Settings) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/auth/google/authorize")

    assert response.status_code == 200
    data = response.json()
    assert "auth_url" in data
    assert "accounts.google.com" in data["auth_url"]
    assert "test-client-id" in data["auth_url"]
    assert "state=" in data["auth_url"]


@pytest.mark.asyncio
async def test_authorize_returns_501_when_not_configured() -> None:
    # Override settings without Google credentials
    app.dependency_overrides[get_settings] = lambda: Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/auth/google/authorize")

    assert response.status_code == 501


# ── POST /callback ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_callback_creates_new_user_and_returns_tokens(
    test_settings: Settings,
) -> None:
    state = create_oauth_state(test_settings)
    claims = _make_google_claims()

    with (
        patch("app.services.oauth.httpx") as mock_httpx,
        patch("anyio.to_thread.run_sync", new_callable=AsyncMock) as mock_run_sync,
    ):
        # Set up httpx mock
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id_token": "fake.id.token", "access_token": "acc"}
        mock_cm = AsyncMock()
        mock_cm.__aenter__.return_value.post = AsyncMock(return_value=mock_resp)
        mock_httpx.AsyncClient.return_value = mock_cm

        # ID-token verification returns our fake claims
        mock_run_sync.return_value = claims

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/google/callback",
                json={"code": "auth-code-abc", "state": state},
            )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert "access_token" in body
    assert "refresh_token" in body


@pytest.mark.asyncio
async def test_callback_links_existing_email_account(
    test_session: AsyncSession,
    test_settings: Settings,
) -> None:
    """An email+password user who signs in with Google gets their account linked."""
    # Seed existing user with same email
    test_session.add(User(email="oauth@example.com", hashed_password=get_password_hash("pw")))
    await test_session.commit()

    state = create_oauth_state(test_settings)
    claims = _make_google_claims(email="oauth@example.com")

    with (
        patch("app.services.oauth.httpx") as mock_httpx,
        patch("anyio.to_thread.run_sync", new_callable=AsyncMock) as mock_run_sync,
    ):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id_token": "fake.id.token", "access_token": "acc"}
        mock_cm = AsyncMock()
        mock_cm.__aenter__.return_value.post = AsyncMock(return_value=mock_resp)
        mock_httpx.AsyncClient.return_value = mock_cm
        mock_run_sync.return_value = claims

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/google/callback",
                json={"code": "auth-code-xyz", "state": state},
            )

    assert response.status_code == 200
    assert "access_token" in response.json()


@pytest.mark.asyncio
async def test_callback_invalid_state_returns_400(test_settings: Settings) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/google/callback",
            json={"code": "some-code", "state": "tampered-state"},
        )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_callback_unverified_email_returns_400(test_settings: Settings) -> None:
    state = create_oauth_state(test_settings)
    # Google account without verified email
    claims = _make_google_claims(email_verified=False)

    with (
        patch("app.services.oauth.httpx") as mock_httpx,
        patch("anyio.to_thread.run_sync", new_callable=AsyncMock) as mock_run_sync,
    ):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id_token": "fake.id.token", "access_token": "acc"}
        mock_cm = AsyncMock()
        mock_cm.__aenter__.return_value.post = AsyncMock(return_value=mock_resp)
        mock_httpx.AsyncClient.return_value = mock_cm
        mock_run_sync.return_value = claims

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/google/callback",
                json={"code": "code-xyz", "state": state},
            )

    assert response.status_code == 400
