from collections.abc import AsyncIterator, Iterator

from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.book import Book, BookProcessingStatus, ReadingStatus
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.loan import Loan
from app.models.location import Location
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


@pytest.mark.asyncio
async def test_csrf_still_enforced_for_cookie_session(test_session: AsyncSession) -> None:
    """Regression: cookie-auth POST without CSRF header → 403, not 401.

    The CSRF fix must only relax enforcement for unauthenticated requests
    (no access_token cookie). Once a session exists, CSRF must still block
    requests that omit the X-CSRF-Token header.
    """
    test_session.add(User(email="csrf-guard@example.com", hashed_password=get_password_hash("secret")))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "csrf-guard@example.com", "password": "secret"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]

        # Inject the access_token cookie manually so it reaches the CSRF
        # middleware (Python's CookieJar skips Secure cookies on plain HTTP
        # in tests, so we bypass the jar).  No X-CSRF-Token header → 403.
        resp = await client.post(
            "/api/v1/settings/onboarding/complete",
            cookies={"access_token": token},
        )

    assert resp.status_code == 403
    assert "CSRF" in resp.json().get("detail", "")


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


# ── DELETE /api/v1/settings/sample-library (issue #202) ──────────────────────

async def _seed_user_with_library(session: AsyncSession, email: str = "sample@example.com") -> tuple[User, Library]:
    """Create a user + personal library, return both."""
    user = User(email=email, hashed_password=get_password_hash("secret"))
    session.add(user)
    await session.flush()
    lib = Library(name="Test Library", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return user, lib


async def _login(client: AsyncClient, email: str = "sample@example.com") -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": "secret"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_clear_sample_library_requires_auth() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.delete("/api/v1/settings/sample-library")).status_code == 401


@pytest.mark.asyncio
async def test_clear_sample_library_removes_only_sample_data(test_session: AsyncSession) -> None:
    user, lib = await _seed_user_with_library(test_session)

    # Sample location + book
    sample_loc = Location(library_id=lib.id, room="R", furniture="F", shelf="S", is_sample=True)
    test_session.add(sample_loc)
    await test_session.flush()
    sample_book = Book(
        library_id=lib.id, title="Sample", processing_status=BookProcessingStatus.MANUAL,
        reading_status=ReadingStatus.UNREAD, location_id=sample_loc.id, is_sample=True,
    )
    test_session.add(sample_book)

    # Real location + book
    real_loc = Location(library_id=lib.id, room="R2", furniture="F2", shelf="S2", is_sample=False)
    test_session.add(real_loc)
    await test_session.flush()
    real_book = Book(
        library_id=lib.id, title="Real", processing_status=BookProcessingStatus.MANUAL,
        reading_status=ReadingStatus.UNREAD, location_id=real_loc.id, is_sample=False,
    )
    test_session.add(real_book)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, user.email)
        r = await client.delete("/api/v1/settings/sample-library", headers=headers)

    assert r.status_code == 200
    body = r.json()
    assert body["deleted_books"] == 1
    assert body["deleted_locations"] == 1

    # Verify DB state: sample gone, real remains
    remaining_books = (await test_session.execute(select(Book).where(Book.library_id == lib.id))).scalars().all()
    remaining_locs = (await test_session.execute(select(Location).where(Location.library_id == lib.id))).scalars().all()
    assert len(remaining_books) == 1
    assert remaining_books[0].title == "Real"
    assert len(remaining_locs) == 1
    assert remaining_locs[0].shelf == "S2"


@pytest.mark.asyncio
async def test_clear_sample_library_also_deletes_loans_on_sample_books(test_session: AsyncSession) -> None:
    """Verifies the loan-deletion branch runs when a sample book has an active loan."""
    from datetime import date
    user, lib = await _seed_user_with_library(test_session, email="loansample@example.com")

    sample_loc = Location(library_id=lib.id, room="R", furniture="F", shelf="S", is_sample=True)
    test_session.add(sample_loc)
    await test_session.flush()
    sample_book = Book(
        library_id=lib.id, title="Sample with Loan", processing_status=BookProcessingStatus.MANUAL,
        reading_status=ReadingStatus.LENT, location_id=sample_loc.id, is_sample=True,
    )
    test_session.add(sample_book)
    await test_session.flush()
    loan = Loan(
        library_id=lib.id,
        book_id=sample_book.id,
        borrower_name="Test Borrower",
        lent_date=date.today(),
    )
    test_session.add(loan)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, user.email)
        r = await client.delete("/api/v1/settings/sample-library", headers=headers)

    assert r.status_code == 200
    assert r.json()["deleted_books"] == 1
    remaining = (await test_session.execute(
        select(Loan).where(Loan.library_id == lib.id)
    )).scalars().all()
    assert remaining == []


@pytest.mark.asyncio
async def test_clear_sample_library_idempotent_when_no_sample_data(test_session: AsyncSession) -> None:
    user, _ = await _seed_user_with_library(test_session, email="nosample@example.com")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, user.email)
        r = await client.delete("/api/v1/settings/sample-library", headers=headers)

    assert r.status_code == 200
    assert r.json()["deleted_books"] == 0
    assert r.json()["deleted_locations"] == 0
