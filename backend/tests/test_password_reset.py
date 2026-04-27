from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Iterator
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

from httpx import ASGITransport, AsyncClient
import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.dependencies.redis import get_redis
from app.core.config import Settings, get_settings
from app.core.security import decode_token, get_password_hash, verify_password
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.password_reset_token import PasswordResetToken
from app.models.user import User
from app.services.password_reset import _hash_token

# Read token TTL from settings — the service resolves it the same way, so
# tests stay in sync with any env-driven override.
TOKEN_TTL_MINUTES = get_settings().password_reset_token_ttl_minutes


class FakeRedis:
    def __init__(self) -> None:
        self._counts: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self._counts[key] = self._counts.get(key, 0) + 1
        return self._counts[key]

    async def expire(self, key: str, seconds: int) -> bool:  # noqa: ARG002
        return True

    async def aclose(self) -> None:
        pass


def _require_test_database_url() -> str:
    import os
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_password_reset.db")


@pytest.fixture
async def test_session() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(_require_test_database_url())
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        database_url=_require_test_database_url(),
        jwt_secret_key="test-secret",
        jwt_algorithm="HS256",
        access_token_expire_minutes=15,
        refresh_token_expire_days=7,
    )


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest.fixture
def sent_emails() -> list[tuple[str, str]]:
    return []


@pytest.fixture
def enabled_limiter() -> Iterator[None]:
    """Temporarily enable the module-level limiter with fresh in-memory storage.

    The global limiter is disabled when TESTING=true so ordinary tests are not
    affected by rate limits.  Swapping app.state.limiter with a new instance
    does NOT work: the @limiter.limit() decorator captures self (the original
    limiter instance) in its closure and calls self._check_request_limit() at
    request time, so any new limiter put in app.state has no effect on the
    per-route limit check.

    Instead we mutate the original limiter: enable it and replace its storage
    with a fresh MemoryStorage (no Redis dependency), then restore everything
    after the test.
    """
    import app.core.limiter as limiter_mod
    from limits.storage import MemoryStorage
    from limits.strategies import STRATEGIES

    lim = limiter_mod.limiter
    saved_enabled = lim.enabled
    saved_storage = lim._storage
    saved_rate_limiter = lim._limiter

    new_storage = MemoryStorage()
    strategy = lim._strategy or "fixed-window"
    lim.enabled = True
    lim._storage = new_storage
    lim._limiter = STRATEGIES[strategy](new_storage)

    yield

    lim.enabled = saved_enabled
    lim._storage = saved_storage
    lim._limiter = saved_rate_limiter


@pytest.fixture(autouse=True)
def override_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    test_session: async_sessionmaker[AsyncSession],
    test_settings: Settings,
    fake_redis: FakeRedis,
    sent_emails: list[tuple[str, str]],
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with test_session() as session:
            yield session

    async def _get_redis() -> AsyncIterator[FakeRedis]:
        yield fake_redis

    async def _fake_send_password_reset(to: str, reset_url: str) -> None:
        sent_emails.append((to, reset_url))

    monkeypatch.setattr("app.services.email.send_password_reset", _fake_send_password_reset)
    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    app.dependency_overrides[get_redis] = _get_redis
    yield
    app.dependency_overrides.clear()


def _csrf() -> tuple[dict[str, str], dict[str, str]]:
    csrf = "csrf-test-token"
    return ({"x-csrf-token": csrf}, {"csrf_token": csrf})


async def _create_user(
    session: AsyncSession,
    *,
    email: str,
    has_local_password: bool = True,
    linked_google: bool = False,
) -> User:
    user = User(
        email=email,
        hashed_password=get_password_hash("OldPassword123"),
        has_local_password=has_local_password,
        auth_provider="google" if linked_google or not has_local_password else "local",
        google_sub="google-sub" if linked_google or not has_local_password else None,
        password_changed_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_from_reset_url(url: str) -> str:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    return query["token"][0]


@pytest.mark.asyncio
async def test_request_returns_202_for_all_email_cases(
    test_session: async_sessionmaker[AsyncSession],
    sent_emails: list[tuple[str, str]],
) -> None:
    """5. Request endpoint returns 202 regardless of whether email exists."""
    async with test_session() as session:
        await _create_user(session, email="local@example.com")
        await _create_user(session, email="oauth@example.com", has_local_password=False)

    headers, cookies = _csrf()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r_local = await client.post(
            "/api/v1/auth/password-reset/request",
            json={"email": "local@example.com"},
            headers=headers,
            cookies=cookies,
        )
        r_oauth = await client.post(
            "/api/v1/auth/password-reset/request",
            json={"email": "oauth@example.com"},
            headers=headers,
            cookies=cookies,
        )
        r_missing = await client.post(
            "/api/v1/auth/password-reset/request",
            json={"email": "missing@example.com"},
            headers=headers,
            cookies=cookies,
        )

    assert r_local.status_code == r_oauth.status_code == r_missing.status_code == 202
    assert r_local.json() == r_oauth.json() == r_missing.json() == {"status": "ok"}

    async with test_session() as session:
        tokens = (await session.execute(select(PasswordResetToken))).scalars().all()
    assert len(tokens) == 1
    assert len(sent_emails) == 1


@pytest.mark.asyncio
async def test_token_not_stored_in_plaintext_and_ttl_is_60_minutes(
    test_session: async_sessionmaker[AsyncSession],
    sent_emails: list[tuple[str, str]],
) -> None:
    """1. Token is never stored in plaintext."""
    async with test_session() as session:
        await _create_user(session, email="hash@example.com")

    headers, cookies = _csrf()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/password-reset/request",
            json={"email": "hash@example.com"},
            headers=headers,
            cookies=cookies,
        )
    assert response.status_code == 202

    plaintext = _token_from_reset_url(sent_emails[0][1])
    async with test_session() as session:
        row = (await session.execute(select(PasswordResetToken))).scalar_one()

    assert row.token_hash == _hash_token(plaintext)
    assert row.token_hash != plaintext
    ttl_minutes = (row.expires_at - row.created_at).total_seconds() / 60
    assert 59 <= ttl_minutes <= 61


@pytest.mark.asyncio
async def test_email_rate_limit_allows_only_three_requests_per_hour(
    test_session: async_sessionmaker[AsyncSession],
    sent_emails: list[tuple[str, str]],
) -> None:
    """7. Request is rate-limited per email via Redis: 3 req/hour."""
    async with test_session() as session:
        await _create_user(session, email="limit@example.com")

    headers, cookies = _csrf()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for _ in range(4):
            response = await client.post(
                "/api/v1/auth/password-reset/request",
                json={"email": "limit@example.com"},
                headers=headers,
                cookies=cookies,
            )
            assert response.status_code == 202

    async with test_session() as session:
        count = (await session.execute(sa.select(sa.func.count()).select_from(PasswordResetToken))).scalar_one()
    assert count == 3
    assert len(sent_emails) == 3


@pytest.mark.asyncio
async def test_ip_rate_limit_returns_429_on_sixth_call(enabled_limiter: None) -> None:
    """IP rate-limited via slowapi: 5 per 15 minutes; 6th call → 429.

    Uses an isolated in-memory limiter (enabled_limiter fixture) so the test
    is not affected by the global TESTING=true bypass in app/core/limiter.py
    and does not need a Redis instance.
    """
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for i in range(5):
            resp = await client.post(
                "/api/v1/auth/password-reset/request",
                json={"email": f"ip{i}@example.com"},
            )
            assert resp.status_code == 202, f"call {i + 1} expected 202, got {resp.status_code}"

        # 6th request from the same IP (test client host) exceeds 5/15min limit.
        resp = await client.post(
            "/api/v1/auth/password-reset/request",
            json={"email": "ip5@example.com"},
        )
    assert resp.status_code == 429


@pytest.mark.asyncio
async def test_confirm_success_single_use_and_sibling_invalidation(
    test_session: async_sessionmaker[AsyncSession],
    sent_emails: list[tuple[str, str]],
) -> None:
    """10. On successful reset, all other outstanding reset tokens for that user are also consumed."""
    async with test_session() as session:
        await _create_user(session, email="multi@example.com", linked_google=True)

    headers, cookies = _csrf()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/v1/auth/password-reset/request",
            json={"email": "multi@example.com"},
            headers=headers,
            cookies=cookies,
        )
        await client.post(
            "/api/v1/auth/password-reset/request",
            json={"email": "multi@example.com"},
            headers=headers,
            cookies=cookies,
        )

    first_token = _token_from_reset_url(sent_emails[0][1])
    second_token = _token_from_reset_url(sent_emails[1][1])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": first_token, "new_password": "NewPassword456"},
            headers=headers,
            cookies=cookies,
        )
        second = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": first_token, "new_password": "NewPassword456"},
            headers=headers,
            cookies=cookies,
        )
        sibling = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": second_token, "new_password": "NewPassword456"},
            headers=headers,
            cookies=cookies,
        )

    assert first.status_code == 204
    assert second.status_code == 400
    assert sibling.status_code == 400

    async with test_session() as session:
        user = (await session.execute(select(User).where(User.email == "multi@example.com"))).scalar_one()
        assert verify_password("NewPassword456", user.hashed_password)
        rows = (await session.execute(select(PasswordResetToken).where(PasswordResetToken.user_id == user.id))).scalars().all()
    assert all(row.used_at is not None for row in rows)


@pytest.mark.asyncio
async def test_expired_unknown_and_oauth_only_token_paths_are_rejected(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """4. Expired token cannot be consumed."""
    async with test_session() as session:
        oauth_user = await _create_user(session, email="oauth-reset@example.com", has_local_password=False)
        session.add(
            PasswordResetToken(
                user_id=oauth_user.id,
                token_hash=_hash_token("oauth-token"),
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MINUTES),
            )
        )
        session.add(
            PasswordResetToken(
                user_id=oauth_user.id,
                token_hash=_hash_token("expired-token"),
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            )
        )
        await session.commit()

    headers, cookies = _csrf()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        unknown = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": "unknown-token", "new_password": "StrongPass123"},
            headers=headers,
            cookies=cookies,
        )
        expired = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": "expired-token", "new_password": "StrongPass123"},
            headers=headers,
            cookies=cookies,
        )
        oauth = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": "oauth-token", "new_password": "StrongPass123"},
            headers=headers,
            cookies=cookies,
        )

    assert unknown.status_code == 400
    assert expired.status_code == 400
    assert oauth.status_code == 400
    assert unknown.json()["detail"] == expired.json()["detail"] == oauth.json()["detail"]


@pytest.mark.asyncio
async def test_confirm_password_policy_failure_is_400() -> None:
    """12. Reset endpoint enforces same password policy as registration."""
    headers, cookies = _csrf()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": "nope", "new_password": "short"},
            headers=headers,
            cookies=cookies,
        )
    assert response.status_code == 400
    assert "at least 10 characters" in response.json()["detail"]


@pytest.mark.asyncio
async def test_reset_invalidates_existing_refresh_tokens(
    test_session: async_sessionmaker[AsyncSession],
    sent_emails: list[tuple[str, str]],
) -> None:
    """9. Successful reset invalidates all existing refresh sessions."""
    async with test_session() as session:
        await _create_user(session, email="refresh@example.com")

    headers, cookies = _csrf()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "refresh@example.com", "password": "OldPassword123"},
        )
        old_refresh = login.json()["refresh_token"]

        await client.post(
            "/api/v1/auth/password-reset/request",
            json={"email": "refresh@example.com"},
            headers=headers,
            cookies=cookies,
        )
        token = _token_from_reset_url(sent_emails[0][1])

        confirm = await client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": token, "new_password": "BrandNew1234"},
            headers=headers,
            cookies=cookies,
        )
        assert confirm.status_code == 204

        refresh = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
        assert refresh.status_code == 401

        relogin = await client.post(
            "/api/v1/auth/login",
            json={"email": "refresh@example.com", "password": "BrandNew1234"},
        )
        assert relogin.status_code == 200
        assert "iat" in decode_token(relogin.json()["refresh_token"])


@pytest.mark.asyncio
async def test_concurrent_confirm_same_token_only_one_succeeds(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """3. Token is single-use."""
    async with test_session() as session:
        user = await _create_user(session, email="race@example.com")
        session.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=_hash_token("race-token"),
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MINUTES),
            )
        )
        await session.commit()

    headers, cookies = _csrf()

    async def _confirm_once() -> int:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/password-reset/confirm",
                json={"token": "race-token", "new_password": "Concurrent123"},
                headers=headers,
                cookies=cookies,
            )
            return response.status_code

    statuses = await asyncio.gather(_confirm_once(), _confirm_once())
    assert sorted(statuses) == [204, 400]
