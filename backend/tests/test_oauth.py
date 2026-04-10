"""Tests for Google OAuth 2.0 endpoints and security hardening.

Covers:
  - State JWT creation / verification (unit)
  - GET /google/authorize (returns URL, 501 when unconfigured)
  - POST /google/callback (creates user, links existing account, rejects bad state,
    rejects unverified email)
  - Anti-replay: same state cannot be submitted twice
  - Expired / never-stored state is rejected
"""
from __future__ import annotations

import secrets
from collections.abc import AsyncIterator, Iterator
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from fastapi import HTTPException

from app.api.dependencies.redis import get_redis
from app.core.config import Settings, get_settings
from app.core.security import create_token, get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.user import User
from app.services.oauth import _STATE_PREFIX, _STATE_TTL_SECONDS, create_oauth_state, verify_oauth_state


# ── Fake Redis ─────────────────────────────────────────────────────────────────

class FakeRedis:
    """Minimal async Redis stub: supports SET with EX and GETDEL.

    TTL is intentionally not enforced — tests control expiry via the JWT.
    """

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: int | None = None) -> None:  # noqa: ARG002
        self._store[key] = value

    async def getdel(self, key: str) -> str | None:
        return self._store.pop(key, None)

    async def aclose(self) -> None:
        pass


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


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest.fixture(autouse=True)
def override_dependencies(
    test_session: AsyncSession,
    test_settings: Settings,
    fake_redis: FakeRedis,
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield test_session

    async def _get_redis() -> AsyncIterator[FakeRedis]:
        yield fake_redis

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    app.dependency_overrides[get_redis] = _get_redis
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


# ── State JWT unit tests ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_state_create_and_verify(fake_redis: FakeRedis) -> None:
    """Happy-path: created state can be verified once."""
    state = await create_oauth_state(fake_redis)
    assert isinstance(state, str) and len(state) > 20
    # First verify succeeds and consumes the nonce
    await verify_oauth_state(state, fake_redis)  # must not raise


@pytest.mark.asyncio
async def test_state_cannot_be_verified_twice(fake_redis: FakeRedis) -> None:
    """Anti-replay: second verify of the same state must raise HTTP 400."""
    state = await create_oauth_state(fake_redis)
    await verify_oauth_state(state, fake_redis)  # first use — OK

    with pytest.raises(HTTPException) as exc_info:
        await verify_oauth_state(state, fake_redis)  # second use — must fail
    assert exc_info.value.status_code == 400
    assert "already been used" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_state_with_tampered_jwt_is_rejected(fake_redis: FakeRedis) -> None:
    """Invalid JWT signature raises HTTP 400."""
    with pytest.raises(Exception):
        await verify_oauth_state("not.a.valid.jwt", fake_redis)


@pytest.mark.asyncio
async def test_state_not_stored_in_redis_is_rejected(fake_redis: FakeRedis) -> None:
    """A valid JWT whose nonce was never stored (or already expired in Redis) is rejected."""
    # Build a syntactically valid oauth_state JWT without writing to fake_redis
    nonce = secrets.token_urlsafe(16)
    orphan_state = create_token(
        subject=nonce,
        expires_delta=timedelta(seconds=_STATE_TTL_SECONDS),
        token_type="oauth_state",
    )
    # Redis has no entry → getdel returns None → must raise
    with pytest.raises(HTTPException) as exc_info:
        await verify_oauth_state(orphan_state, fake_redis)
    assert exc_info.value.status_code == 400
    assert "already been used" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_state_wrong_token_type_is_rejected(fake_redis: FakeRedis) -> None:
    """A JWT with type != 'oauth_state' is rejected even if nonce is in Redis."""
    nonce = secrets.token_urlsafe(16)
    # Store nonce but issue JWT with wrong type
    await fake_redis.set(f"{_STATE_PREFIX}{nonce}", "1", ex=600)
    wrong_type_state = create_token(
        subject=nonce,
        expires_delta=timedelta(seconds=_STATE_TTL_SECONDS),
        token_type="access",  # wrong
    )
    with pytest.raises(Exception):
        await verify_oauth_state(wrong_type_state, fake_redis)


# ── GET /authorize ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_authorize_returns_google_url_and_stores_nonce(
    fake_redis: FakeRedis,
) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/auth/google/authorize")

    assert response.status_code == 200
    data = response.json()
    assert "auth_url" in data
    assert "accounts.google.com" in data["auth_url"]
    assert "test-client-id" in data["auth_url"]
    assert "state=" in data["auth_url"]
    # Nonce must be stored in Redis
    assert any(k.startswith(_STATE_PREFIX) for k in fake_redis._store)


@pytest.mark.asyncio
async def test_authorize_returns_501_when_not_configured() -> None:
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
    fake_redis: FakeRedis,
) -> None:
    state = await create_oauth_state(fake_redis)
    claims = _make_google_claims()

    with patch("app.api.auth.exchange_code_for_claims", new_callable=AsyncMock) as mock_exchange:
        mock_exchange.return_value = claims

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/google/callback",
                json={"code": "auth-code-abc", "state": state},
            )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert "access_token" in body and "refresh_token" in body


@pytest.mark.asyncio
async def test_callback_state_cannot_be_replayed(
    fake_redis: FakeRedis,
) -> None:
    """Using the same state twice: first request succeeds, second is rejected."""
    state = await create_oauth_state(fake_redis)
    claims = _make_google_claims(sub="sub-replay-test")

    with patch("app.api.auth.exchange_code_for_claims", new_callable=AsyncMock) as mock_exchange:
        mock_exchange.return_value = claims

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp1 = await client.post(
                "/api/v1/auth/google/callback",
                json={"code": "code-1", "state": state},
            )
            # Nonce is now consumed; second attempt must fail at verify_oauth_state
            # (before exchange_code_for_claims is even reached).
            resp2 = await client.post(
                "/api/v1/auth/google/callback",
                json={"code": "code-1", "state": state},
            )

    assert resp1.status_code == 200
    assert resp2.status_code == 400
    assert "already been used" in resp2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_callback_links_existing_email_account(
    test_session: AsyncSession,
    fake_redis: FakeRedis,
) -> None:
    """Existing email+password user who signs in via Google gets account linked."""
    test_session.add(User(email="oauth@example.com", hashed_password=get_password_hash("pw")))
    await test_session.commit()

    state = await create_oauth_state(fake_redis)
    claims = _make_google_claims(email="oauth@example.com")

    with patch("app.api.auth.exchange_code_for_claims", new_callable=AsyncMock) as mock_exchange:
        mock_exchange.return_value = claims

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/google/callback",
                json={"code": "code-link", "state": state},
            )

    assert response.status_code == 200
    assert "access_token" in response.json()


@pytest.mark.asyncio
async def test_callback_invalid_state_returns_400(fake_redis: FakeRedis) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/google/callback",
            json={"code": "some-code", "state": "tampered-state"},
        )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_callback_unverified_email_returns_400(fake_redis: FakeRedis) -> None:
    state = await create_oauth_state(fake_redis)
    claims = _make_google_claims(email_verified=False)

    with patch("app.api.auth.exchange_code_for_claims", new_callable=AsyncMock) as mock_exchange:
        mock_exchange.return_value = claims

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/google/callback",
                json={"code": "code-xyz", "state": state},
            )

    assert response.status_code == 400


