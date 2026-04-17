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
from app.models.library import Library, LibraryMember, LibraryRole
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


@pytest.mark.asyncio
async def test_purge_library_requires_password_for_local_user(
    test_settings: Settings,
) -> None:
    email = "purge.local@example.com"
    password = "secret123"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        reg = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
        assert reg.status_code == 201

        login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        bad = await client.post("/api/v1/settings/purge-library", json={"password": ""}, headers=headers)
        ok = await client.post("/api/v1/settings/purge-library", json={"password": password}, headers=headers)

    assert bad.status_code == 401
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_purge_library_oauth_only_allows_delete_confirmation_without_password(
    test_session: AsyncSession,
    test_settings: Settings,
) -> None:
    oauth_user = User(
        email="purge.oauth@example.com",
        hashed_password=get_password_hash(secrets.token_hex(32)),
        google_sub="sub-purge-oauth",
        auth_provider="google",
        has_local_password=False,
    )
    test_session.add(oauth_user)
    await test_session.flush()

    library = Library(name="OAuth Library", created_by_user_id=oauth_user.id)
    test_session.add(library)
    await test_session.flush()

    test_session.add(
        LibraryMember(
            library_id=library.id,
            user_id=oauth_user.id,
            role=LibraryRole.OWNER,
        )
    )
    await test_session.commit()

    access_token, _ = issue_token_pair("purge.oauth@example.com", test_settings)
    headers = {"Authorization": f"Bearer {access_token}"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/settings/purge-library", json={"password": ""}, headers=headers)

    assert response.status_code == 200


# ── Cookie-based auth + CSRF (issue #117) ─────────────────────────────────────


def _cookie_attrs(set_cookie_header: str) -> dict[str, str]:
    """Parse a Set-Cookie header into {attr_name_lower: value_or_empty}."""
    parts = [p.strip() for p in set_cookie_header.split(";")]
    out: dict[str, str] = {}
    for i, part in enumerate(parts):
        if "=" in part:
            k, v = part.split("=", 1)
        else:
            k, v = part, ""
        # First pair is the cookie's name=value — ignore for attribute dict
        if i == 0:
            out["__name__"] = k
            out["__value__"] = v
        else:
            out[k.lower()] = v
    return out


@pytest.mark.asyncio
async def test_login_sets_httponly_auth_cookies(test_session: AsyncSession) -> None:
    """Login must set access_token + refresh_token HttpOnly cookies and a
    non-HttpOnly csrf_token cookie readable by JS."""
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )

    assert response.status_code == 200
    set_cookies = response.headers.get_list("set-cookie")
    assert len(set_cookies) == 3, f"Expected 3 Set-Cookie headers, got {set_cookies}"

    by_name = {_cookie_attrs(c)["__name__"]: _cookie_attrs(c) for c in set_cookies}
    assert set(by_name) == {"access_token", "refresh_token", "csrf_token"}

    access = by_name["access_token"]
    assert "httponly" in access
    assert access.get("samesite", "").lower() == "lax"
    assert access.get("path") == "/api/v1"

    refresh = by_name["refresh_token"]
    assert "httponly" in refresh
    assert refresh.get("path") == "/api/v1/auth"

    csrf = by_name["csrf_token"]
    # CSRF cookie MUST be reachable from JS to enable double-submit.
    assert "httponly" not in csrf
    assert csrf["__value__"]  # non-empty token

    # Response body mirrors the csrf cookie value so a just-loaded SPA can
    # populate its header immediately.
    assert response.json()["csrf_token"] == csrf["__value__"]


@pytest.mark.asyncio
async def test_protected_endpoint_accepts_cookie_auth(test_session: AsyncSession) -> None:
    """Authenticating purely via the HttpOnly cookie (no Bearer header) succeeds."""
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )
        assert login.status_code == 200
        # AsyncClient auto-persists cookies set by the server. Drop the
        # Bearer path entirely — request is cookie-only.
        response = await client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json()["email"] == "admin@example.com"


@pytest.mark.asyncio
async def test_refresh_via_cookie_without_body(test_session: AsyncSession) -> None:
    """SPA refresh: empty body, relies on HttpOnly refresh_token cookie."""
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )
        # No refresh_token in body — the server must read the cookie.
        response = await client.post("/api/v1/auth/refresh", json={})

    assert response.status_code == 200
    assert "access_token" in response.json()


@pytest.mark.asyncio
async def test_refresh_without_cookie_or_body_returns_401(test_session: AsyncSession) -> None:
    """With no cookie AND no body, refresh must reject."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/refresh", json={})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_logout_clears_all_auth_cookies(test_session: AsyncSession) -> None:
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )
        # Read csrf_token cookie value for header echo (CSRF middleware).
        csrf = client.cookies.get("csrf_token")
        assert csrf

        response = await client.post(
            "/api/v1/auth/logout",
            headers={"X-CSRF-Token": csrf},
        )

    assert response.status_code == 204
    expired_cookies = response.headers.get_list("set-cookie")
    assert len(expired_cookies) == 3
    for c in expired_cookies:
        attrs = _cookie_attrs(c)
        # max-age=0 expires the cookie. Value is empty (Starlette emits
        # it as an empty-double-quoted string on some versions, "" or '""').
        assert attrs.get("max-age") == "0"
        assert attrs["__value__"] in ("", '""')


@pytest.mark.asyncio
async def test_csrf_blocks_cookie_auth_mutation_without_header(test_session: AsyncSession) -> None:
    """A cookie-authenticated POST / DELETE without X-CSRF-Token must 403."""
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )
        # DELETE on a mutation endpoint without the CSRF header.
        response = await client.request(
            "DELETE",
            "/api/v1/auth/me",
            json={"password": "secret"},
        )

    assert response.status_code == 403
    assert "CSRF" in response.json().get("detail", "")


@pytest.mark.asyncio
async def test_csrf_blocks_mismatched_token(test_session: AsyncSession) -> None:
    """Header present but not matching the cookie value → 403."""
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )
        response = await client.request(
            "DELETE",
            "/api/v1/auth/me",
            json={"password": "secret"},
            headers={"X-CSRF-Token": "not-the-real-token"},
        )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_csrf_allows_bearer_mutation_without_header(
    test_session: AsyncSession,
    test_settings: Settings,
) -> None:
    """Bearer clients are exempt — the Authorization header can't be forged
    cross-origin without CORS cooperation, so CSRF doesn't apply."""
    await _seed_user(test_session)
    access, _ = issue_token_pair("admin@example.com", test_settings)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(
            "DELETE",
            "/api/v1/auth/me",
            json={"password": "secret"},
            headers={"Authorization": f"Bearer {access}"},
        )

    assert response.status_code == 204


@pytest.mark.asyncio
async def test_csrf_pass_with_matching_header(test_session: AsyncSession) -> None:
    """The happy path: cookie + matching header → request proceeds."""
    await _seed_user(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )
        csrf = client.cookies.get("csrf_token")
        assert csrf

        response = await client.request(
            "DELETE",
            "/api/v1/auth/me",
            json={"password": "secret"},
            headers={"X-CSRF-Token": csrf},
        )

    assert response.status_code == 204


@pytest.mark.asyncio
async def test_csrf_whitelisted_endpoints_do_not_require_token() -> None:
    """Login/register/refresh are explicitly whitelisted — a browser visiting
    the app for the first time has no cookie yet."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Register with no cookie and no CSRF header must reach the
        # business logic (it'll succeed with 201, not 403).
        response = await client.post(
            "/api/v1/auth/register",
            json={"email": "fresh@example.com", "password": "secret123"},
        )

    assert response.status_code == 201
