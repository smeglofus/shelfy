"""Tests for the actor-audit columns on Borrower (issue #245).

Covers:
- ``created_by_user_id`` is stamped on creation
- ``anonymized_by_user_id`` is stamped on per-borrower anonymize
- ``anonymized_by_user_id`` is stamped on bulk anonymize
- ``merged_into_by_user_id`` is stamped only on the target row (not the
  deleted source) when a merge runs
- Each editor who acts is recorded individually when multiple editors
  share a library (multi-editor scenario)
"""
from collections.abc import AsyncIterator, Iterator
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
    session: AsyncSession,
    email: str = "owner@example.com",
) -> tuple[User, Library]:
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(email=email, hashed_password=get_password_hash("secret"))
        session.add(user)
        await session.flush()
    existing = (await session.execute(
        select(Library)
        .join(LibraryMember, LibraryMember.library_id == Library.id)
        .where(LibraryMember.user_id == user.id)
        .limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        return user, existing
    lib = Library(name=f"Library of {email}", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return user, lib


async def _add_editor(session: AsyncSession, lib_id: uuid.UUID, email: str) -> User:
    user = User(email=email, hashed_password=get_password_hash("secret"))
    session.add(user)
    await session.flush()
    session.add(LibraryMember(library_id=lib_id, user_id=user.id, role=LibraryRole.EDITOR))
    await session.commit()
    return user


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    resp = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "secret"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio
async def test_created_by_user_id_is_stamped_on_creation(test_session: AsyncSession) -> None:
    user, _lib = await _seed_user_with_library(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            "/api/v1/borrowers", json={"name": "Alice"}, headers=headers
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["created_by_user_id"] == str(user.id)
    assert body["anonymized_by_user_id"] is None
    assert body["merged_into_by_user_id"] is None


@pytest.mark.asyncio
async def test_anonymized_by_user_id_is_stamped_on_anonymize(
    test_session: AsyncSession,
) -> None:
    """Two editors share a library; one creates, the other anonymizes. The
    rows should reflect *both* actors independently."""
    _owner, lib = await _seed_user_with_library(test_session)
    editor = await _add_editor(test_session, lib.id, "editor@example.com")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        owner_headers = await _login(client, "owner@example.com")
        created = await client.post(
            "/api/v1/borrowers", json={"name": "Alice"}, headers=owner_headers
        )
        assert created.status_code == 201
        borrower_id = created.json()["id"]
        assert created.json()["created_by_user_id"] is not None
        creator_id = created.json()["created_by_user_id"]

        editor_headers = await _login(client, "editor@example.com")
        anonymized = await client.post(
            f"/api/v1/borrowers/{borrower_id}/anonymize", headers=editor_headers
        )

    assert anonymized.status_code == 200
    body = anonymized.json()
    # created_by stayed the owner; anonymized_by is the editor.
    assert body["created_by_user_id"] == creator_id
    assert body["anonymized_by_user_id"] == str(editor.id)


@pytest.mark.asyncio
async def test_anonymized_by_user_id_is_stamped_on_bulk_anonymize(
    test_session: AsyncSession,
) -> None:
    owner, lib = await _seed_user_with_library(test_session)
    first = Borrower(library_id=lib.id, name="Alice")
    second = Borrower(library_id=lib.id, name="Bob")
    test_session.add_all([first, second])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            "/api/v1/borrowers/bulk/anonymize",
            headers=headers,
            json={"ids": [str(first.id), str(second.id)]},
        )

    assert resp.status_code == 200
    refreshed = (
        await test_session.execute(
            select(Borrower).where(Borrower.id.in_([first.id, second.id]))
        )
    ).scalars().all()
    assert all(row.anonymized_by_user_id == owner.id for row in refreshed)


@pytest.mark.asyncio
async def test_merged_into_by_user_id_is_stamped_only_on_target(
    test_session: AsyncSession,
) -> None:
    owner, lib = await _seed_user_with_library(test_session)
    source = Borrower(library_id=lib.id, name="Alice (dup)")
    target = Borrower(library_id=lib.id, name="Alice Liddell")
    test_session.add_all([source, target])
    await test_session.commit()
    target_id = target.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            f"/api/v1/borrowers/{target_id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(target_id)
    assert body["merged_into_by_user_id"] == str(owner.id)
    # Source was deleted; nothing to assert beyond that.
    survived = (
        await test_session.execute(select(Borrower).where(Borrower.id == source.id))
    ).scalar_one_or_none()
    assert survived is None


@pytest.mark.asyncio
async def test_audit_fields_are_null_for_legacy_rows(test_session: AsyncSession) -> None:
    """Pre-#245 rows have NULL audit columns — the API must return them as null
    rather than raising or fabricating a value."""
    _, lib = await _seed_user_with_library(test_session)
    legacy = Borrower(library_id=lib.id, name="Pre-audit")
    # Deliberately do NOT set created_by_user_id; simulates a row created
    # before the migration.
    test_session.add(legacy)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.get(f"/api/v1/borrowers/{legacy.id}", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["created_by_user_id"] is None
    assert body["anonymized_by_user_id"] is None
    assert body["merged_into_by_user_id"] is None
    # #261: legacy rows ship null *_email resolvers too.
    assert body["created_by_email"] is None
    assert body["anonymized_by_email"] is None
    assert body["merged_into_by_email"] is None


# ── #261: detail endpoint resolves audit user IDs to emails ───────────────────


@pytest.mark.asyncio
async def test_detail_endpoint_resolves_created_by_email(
    test_session: AsyncSession,
) -> None:
    """Creating a borrower then fetching the detail page surfaces the
    creator's email under ``created_by_email`` (#261)."""
    owner, _lib = await _seed_user_with_library(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        created = await client.post(
            "/api/v1/borrowers", json={"name": "Alice"}, headers=headers
        )
        assert created.status_code == 201
        borrower_id = created.json()["id"]

        detail = await client.get(f"/api/v1/borrowers/{borrower_id}", headers=headers)

    assert detail.status_code == 200
    body = detail.json()
    assert body["created_by_user_id"] == str(owner.id)
    assert body["created_by_email"] == "owner@example.com"
    # The other two actors haven't acted yet — both columns and resolvers null.
    assert body["anonymized_by_email"] is None
    assert body["merged_into_by_email"] is None


@pytest.mark.asyncio
async def test_detail_endpoint_resolves_all_three_audit_emails(
    test_session: AsyncSession,
) -> None:
    """When a borrower has gone through create → merge → anonymize by
    different editors, all three resolver fields point at the right users."""
    _owner, lib = await _seed_user_with_library(test_session)
    editor_a = await _add_editor(test_session, lib.id, "editor-a@example.com")
    editor_b = await _add_editor(test_session, lib.id, "editor-b@example.com")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        owner_headers = await _login(client, "owner@example.com")
        # Owner creates a source + target.
        target = await client.post(
            "/api/v1/borrowers", json={"name": "Alice Liddell"}, headers=owner_headers
        )
        source = await client.post(
            "/api/v1/borrowers", json={"name": "Alice (dup)"}, headers=owner_headers
        )
        target_id = target.json()["id"]
        source_id = source.json()["id"]

        # Editor A merges source into target.
        editor_a_headers = await _login(client, "editor-a@example.com")
        merged = await client.post(
            f"/api/v1/borrowers/{target_id}/merge",
            json={"source_id": source_id},
            headers=editor_a_headers,
        )
        assert merged.status_code == 200

        # Editor B anonymizes the merged target.
        editor_b_headers = await _login(client, "editor-b@example.com")
        anonymized = await client.post(
            f"/api/v1/borrowers/{target_id}/anonymize", headers=editor_b_headers
        )
        assert anonymized.status_code == 200

        detail = await client.get(
            f"/api/v1/borrowers/{target_id}", headers=owner_headers
        )

    assert detail.status_code == 200
    body = detail.json()
    assert body["created_by_email"] == "owner@example.com"
    assert body["merged_into_by_email"] == "editor-a@example.com"
    assert body["anonymized_by_email"] == "editor-b@example.com"


@pytest.mark.asyncio
async def test_detail_endpoint_resolves_null_when_user_deleted(
    test_session: AsyncSession,
) -> None:
    """``ondelete=SET NULL`` on the FK means an actor who later deletes their
    account leaves the audit columns at NULL — the resolver must mirror that
    by returning ``None`` for the email (no fallback string, no exception)."""
    _, lib = await _seed_user_with_library(test_session)
    # Simulate a row whose creator's account was deleted: column is NULL.
    borrower = Borrower(
        library_id=lib.id, name="Orphan", created_by_user_id=None
    )
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        detail = await client.get(f"/api/v1/borrowers/{borrower.id}", headers=headers)

    assert detail.status_code == 200
    body = detail.json()
    assert body["created_by_user_id"] is None
    assert body["created_by_email"] is None


@pytest.mark.asyncio
async def test_list_endpoint_does_not_include_resolved_emails(
    test_session: AsyncSession,
) -> None:
    """The list endpoint stays on ``BorrowerResponse`` (no audit resolver
    fields). Confirms the separation between the cheap list path and the
    detail path — list must not pay for 3 JOINs per row."""
    owner, _lib = await _seed_user_with_library(test_session)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        await client.post(
            "/api/v1/borrowers", json={"name": "Alice"}, headers=headers
        )
        listing = await client.get("/api/v1/borrowers", headers=headers)

    assert listing.status_code == 200
    items = listing.json()["items"]
    assert len(items) == 1
    item = items[0]
    # ID columns survive into list (cheap, no JOIN).
    assert item["created_by_user_id"] == str(owner.id)
    # Resolved-email fields are NOT shipped on list rows.
    assert "created_by_email" not in item
    assert "anonymized_by_email" not in item
    assert "merged_into_by_email" not in item
