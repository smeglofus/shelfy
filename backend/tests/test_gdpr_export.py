"""Tests for the GDPR data export at GET /api/v1/auth/me/export.

The export covers the user's profile, subscription, usage, and libraries
(including books, loans, and borrowers). These tests exercise the
borrower side specifically — that fix lands alongside the borrowers epic
(#221) audit follow-up.
"""
from collections.abc import AsyncIterator, Iterator
import json
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.borrower import Borrower
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.user import User


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
    )


@pytest.fixture(autouse=True)
def override_dependencies(test_session: AsyncSession, test_settings: Settings) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield test_session

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield
    app.dependency_overrides.clear()


async def _seed_user_with_library(
    session: AsyncSession, email: str = "admin@example.com"
) -> tuple[User, Library]:
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(email=email, hashed_password=get_password_hash("secret"))
        session.add(user)
        await session.flush()
    existing_lib = (await session.execute(
        select(Library)
        .join(LibraryMember, LibraryMember.library_id == Library.id)
        .where(LibraryMember.user_id == user.id)
        .limit(1)
    )).scalar_one_or_none()
    if existing_lib is not None:
        return user, existing_lib
    lib = Library(name=f"Library of {email}", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return user, lib


async def _auth_headers(
    client: AsyncClient, session: AsyncSession, email: str = "admin@example.com"
) -> dict[str, str]:
    await _seed_user_with_library(session, email)
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "secret"})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio
async def test_export_requires_authentication() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/v1/auth/me/export")
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_export_includes_borrowers_array_per_library(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    test_session.add_all([
        Borrower(library_id=lib.id, name="Alice", contact="alice@x.com", notes="VIP"),
        Borrower(library_id=lib.id, name="Bob", contact=None),
    ])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get("/api/v1/auth/me/export", headers=headers)

    assert resp.status_code == 200
    body = json.loads(resp.content)
    assert len(body["libraries"]) == 1
    library = body["libraries"][0]
    assert "borrowers" in library
    names = sorted(b["name"] for b in library["borrowers"])
    assert names == ["Alice", "Bob"]
    alice = next(b for b in library["borrowers"] if b["name"] == "Alice")
    assert alice["contact"] == "alice@x.com"
    assert alice["notes"] == "VIP"
    assert alice["anonymized_at"] is None


@pytest.mark.asyncio
async def test_export_includes_borrower_with_no_loans(test_session: AsyncSession) -> None:
    """Standalone borrowers (added via API but never lent to) must appear
    in the export. Without this they would be invisible in the user's data
    portability bundle."""
    _, lib = await _seed_user_with_library(test_session)
    test_session.add(Borrower(library_id=lib.id, name="Standalone", contact="x@y.com"))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get("/api/v1/auth/me/export", headers=headers)

    body = json.loads(resp.content)
    library = body["libraries"][0]
    assert len(library["borrowers"]) == 1
    assert library["borrowers"][0]["name"] == "Standalone"


@pytest.mark.asyncio
async def test_export_anonymized_borrower_shows_sentinel(test_session: AsyncSession) -> None:
    """The export reflects the post-anonymization state — name is the
    sentinel, contact and notes are null, anonymized_at is set."""
    _, lib = await _seed_user_with_library(test_session)
    borrower = Borrower(library_id=lib.id, name="To Be Deleted", contact="x@y.com")
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        anon = await client.post(
            f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers
        )
        assert anon.status_code == 200

        resp = await client.get("/api/v1/auth/me/export", headers=headers)

    body = json.loads(resp.content)
    library = body["libraries"][0]
    assert len(library["borrowers"]) == 1
    exported = library["borrowers"][0]
    assert exported["name"] == "Deleted borrower"
    assert exported["contact"] is None
    assert exported["notes"] is None
    assert exported["anonymized_at"] is not None


@pytest.mark.asyncio
async def test_export_does_not_leak_borrowers_from_other_libraries(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    foreign_lib_id = uuid.uuid4()

    test_session.add_all([
        Borrower(library_id=lib.id, name="Mine"),
        Borrower(library_id=foreign_lib_id, name="Not Mine"),
    ])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get("/api/v1/auth/me/export", headers=headers)

    body = json.loads(resp.content)
    all_names = [b["name"] for lib_out in body["libraries"] for b in lib_out["borrowers"]]
    assert "Mine" in all_names
    assert "Not Mine" not in all_names
