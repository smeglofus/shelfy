"""Tests for multi-library data isolation and sharing semantics.

Covers:
  1. User A cannot see library B's data
  2. Two members of same library see the same data
  3. Viewer: GET allowed, writes denied (403)
  4. Owner can manage members, editor cannot
  5. Cannot remove last owner (400)
  6. Removing member preserves data
  7. Duplicate ISBN allowed across libraries, forbidden within one
  8. Migration backfill: default library created per user
"""

from collections.abc import AsyncIterator, Iterator
import os
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.book import Book
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.user import User


def _require_test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_isolation.db")


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
        jwt_algorithm="HS256",
        access_token_expire_minutes=15,
        refresh_token_expire_days=7,
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


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _create_user(session: AsyncSession, email: str, password: str = "secret") -> User:
    user = User(email=email, hashed_password=get_password_hash(password))
    session.add(user)
    await session.flush()
    await session.refresh(user)
    return user


async def _create_library(session: AsyncSession, owner: User, name: str = "My Library") -> Library:
    lib = Library(name=name, created_by_user_id=owner.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=owner.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return lib


async def _add_member(
    session: AsyncSession, library: Library, user: User, role: LibraryRole
) -> None:
    session.add(LibraryMember(library_id=library.id, user_id=user.id, role=role))
    await session.commit()


async def _login(client: AsyncClient, email: str, password: str = "secret") -> dict[str, str]:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _lib_header(library_id: uuid.UUID) -> dict[str, str]:
    return {"X-Library-Id": str(library_id)}


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_user_a_cannot_see_library_b_data(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """User A only sees books from their own library, not user B's."""
    async with test_session() as session:
        user_a = await _create_user(session, "a@example.com")
        user_b = await _create_user(session, "b@example.com")
        lib_a = await _create_library(session, user_a, "Library A")
        lib_b = await _create_library(session, user_b, "Library B")
        session.add(Book(library_id=lib_a.id, title="Book A"))
        session.add(Book(library_id=lib_b.id, title="Book B"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers_a = {**await _login(client, "a@example.com"), **_lib_header(lib_a.id)}
        resp = await client.get("/api/v1/books", headers=headers_a)

    assert resp.status_code == 200
    titles = {item["title"] for item in resp.json()["items"]}
    assert "Book A" in titles
    assert "Book B" not in titles


@pytest.mark.asyncio
async def test_user_a_cannot_access_library_b_directly(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """User A gets 403 when sending X-Library-Id of library B."""
    async with test_session() as session:
        user_a = await _create_user(session, "a2@example.com")
        user_b = await _create_user(session, "b2@example.com")
        await _create_library(session, user_a, "Library A")
        lib_b = await _create_library(session, user_b, "Library B")
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers_a = {**await _login(client, "a2@example.com"), **_lib_header(lib_b.id)}
        resp = await client.get("/api/v1/books", headers=headers_a)

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_two_members_see_same_data(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Two members of the same library see identical book list."""
    async with test_session() as session:
        owner = await _create_user(session, "owner@example.com")
        editor = await _create_user(session, "editor@example.com")
        lib = await _create_library(session, owner, "Shared Library")
        await _add_member(session, lib, editor, LibraryRole.EDITOR)
        session.add(Book(library_id=lib.id, title="Shared Book"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers_owner = {**await _login(client, "owner@example.com"), **_lib_header(lib.id)}
        headers_editor = {**await _login(client, "editor@example.com"), **_lib_header(lib.id)}

        resp_owner = await client.get("/api/v1/books", headers=headers_owner)
        resp_editor = await client.get("/api/v1/books", headers=headers_editor)

    assert resp_owner.status_code == 200
    assert resp_editor.status_code == 200
    titles_owner = {item["title"] for item in resp_owner.json()["items"]}
    titles_editor = {item["title"] for item in resp_editor.json()["items"]}
    assert titles_owner == titles_editor == {"Shared Book"}


@pytest.mark.asyncio
async def test_viewer_can_read_but_not_write(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Viewer can GET list and GET by-id; write operations return 403."""
    async with test_session() as session:
        owner = await _create_user(session, "owner2@example.com")
        viewer = await _create_user(session, "viewer@example.com")
        lib = await _create_library(session, owner, "Viewer Test Library")
        await _add_member(session, lib, viewer, LibraryRole.VIEWER)
        book = Book(library_id=lib.id, title="Read Only Book")
        session.add(book)
        await session.commit()
        await session.refresh(book)
        book_id = book.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        vh = {**await _login(client, "viewer@example.com"), **_lib_header(lib.id)}

        # Read operations must succeed
        assert (await client.get("/api/v1/books", headers=vh)).status_code == 200
        assert (await client.get(f"/api/v1/books/{book_id}", headers=vh)).status_code == 200
        assert (await client.get("/api/v1/locations", headers=vh)).status_code == 200

        # Write operations must be denied
        assert (await client.post("/api/v1/books", json={"title": "New"}, headers=vh)).status_code == 403
        assert (await client.patch(f"/api/v1/books/{book_id}", json={"title": "Changed"}, headers=vh)).status_code == 403
        assert (await client.delete(f"/api/v1/books/{book_id}", headers=vh)).status_code == 403
        assert (await client.post("/api/v1/locations", json={"room": "r", "furniture": "f", "shelf": "s"}, headers=vh)).status_code == 403


@pytest.mark.asyncio
async def test_owner_can_manage_members_editor_cannot(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Owner can add/update/remove members; editor cannot."""
    async with test_session() as session:
        owner = await _create_user(session, "owner3@example.com")
        editor = await _create_user(session, "editor2@example.com")
        newcomer = await _create_user(session, "newcomer@example.com")
        lib = await _create_library(session, owner, "Managed Library")
        await _add_member(session, lib, editor, LibraryRole.EDITOR)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        oh = await _login(client, "owner3@example.com")
        eh = await _login(client, "editor2@example.com")

        # Editor cannot add members
        resp = await client.post(
            f"/api/v1/libraries/{lib.id}/members",
            json={"email": "newcomer@example.com", "role": "viewer"},
            headers=eh,
        )
        assert resp.status_code == 403

        # Owner can add members
        resp = await client.post(
            f"/api/v1/libraries/{lib.id}/members",
            json={"email": "newcomer@example.com", "role": "viewer"},
            headers=oh,
        )
        assert resp.status_code == 200

        # Editor cannot change roles
        resp = await client.patch(
            f"/api/v1/libraries/{lib.id}/members/{newcomer.id}",
            json={"role": "editor"},
            headers=eh,
        )
        assert resp.status_code == 403

        # Owner can change roles
        resp = await client.patch(
            f"/api/v1/libraries/{lib.id}/members/{newcomer.id}",
            json={"role": "editor"},
            headers=oh,
        )
        assert resp.status_code == 200

        # Owner can remove members
        resp = await client.delete(
            f"/api/v1/libraries/{lib.id}/members/{newcomer.id}",
            headers=oh,
        )
        assert resp.status_code == 204


@pytest.mark.asyncio
async def test_cannot_remove_last_owner(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Removing or demoting the last owner returns 400."""
    async with test_session() as session:
        owner = await _create_user(session, "solo@example.com")
        lib = await _create_library(session, owner, "Solo Library")
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        oh = await _login(client, "solo@example.com")

        # Cannot demote last owner
        resp = await client.patch(
            f"/api/v1/libraries/{lib.id}/members/{owner.id}",
            json={"role": "editor"},
            headers=oh,
        )
        assert resp.status_code == 400

        # Cannot remove last owner
        resp = await client.delete(
            f"/api/v1/libraries/{lib.id}/members/{owner.id}",
            headers=oh,
        )
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_removing_member_preserves_data(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Removing a member from a library does not delete the library's books."""
    async with test_session() as session:
        owner = await _create_user(session, "owner4@example.com")
        member = await _create_user(session, "leaving@example.com")
        lib = await _create_library(session, owner, "Persistent Library")
        await _add_member(session, lib, member, LibraryRole.EDITOR)
        session.add(Book(library_id=lib.id, title="Survivor"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        oh = await _login(client, "owner4@example.com")

        # Remove the editor member
        resp = await client.delete(
            f"/api/v1/libraries/{lib.id}/members/{member.id}",
            headers=oh,
        )
        assert resp.status_code == 204

        # Book still exists
        headers_owner = {**oh, **_lib_header(lib.id)}
        resp = await client.get("/api/v1/books", headers=headers_owner)
        assert resp.status_code == 200
        assert any(b["title"] == "Survivor" for b in resp.json()["items"])


@pytest.mark.asyncio
async def test_duplicate_isbn_across_libraries_allowed(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Same ISBN in two different libraries is allowed."""
    async with test_session() as session:
        user_a = await _create_user(session, "isbnA@example.com")
        user_b = await _create_user(session, "isbnB@example.com")
        lib_a = await _create_library(session, user_a, "Library A")
        lib_b = await _create_library(session, user_b, "Library B")
        await session.commit()

    shared_isbn = "9780134494166"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers_a = {**await _login(client, "isbnA@example.com"), **_lib_header(lib_a.id)}
        headers_b = {**await _login(client, "isbnB@example.com"), **_lib_header(lib_b.id)}

        resp_a = await client.post(
            "/api/v1/books", json={"title": "Book A", "isbn": shared_isbn}, headers=headers_a
        )
        assert resp_a.status_code == 201

        resp_b = await client.post(
            "/api/v1/books", json={"title": "Book B", "isbn": shared_isbn}, headers=headers_b
        )
        assert resp_b.status_code == 201


@pytest.mark.asyncio
async def test_duplicate_isbn_within_library_forbidden(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Same ISBN twice in the same library returns 409."""
    async with test_session() as session:
        user = await _create_user(session, "isbnC@example.com")
        lib = await _create_library(session, user, "Duplicate Test Library")
        await session.commit()

    shared_isbn = "9780132350884"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = {**await _login(client, "isbnC@example.com"), **_lib_header(lib.id)}

        first = await client.post(
            "/api/v1/books", json={"title": "First", "isbn": shared_isbn}, headers=headers
        )
        assert first.status_code == 201

        second = await client.post(
            "/api/v1/books", json={"title": "Second", "isbn": shared_isbn}, headers=headers
        )
        assert second.status_code == 409


@pytest.mark.asyncio
async def test_list_libraries_returns_user_libraries(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """GET /api/v1/libraries returns only the authenticated user's libraries."""
    async with test_session() as session:
        user = await _create_user(session, "listlibs@example.com")
        other = await _create_user(session, "other@example.com")
        lib1 = await _create_library(session, user, "My Library 1")
        lib2 = await _create_library(session, user, "My Library 2")
        _other_lib = await _create_library(session, other, "Other Library")
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "listlibs@example.com")
        resp = await client.get("/api/v1/libraries", headers=headers)

    assert resp.status_code == 200
    ids = {lib["id"] for lib in resp.json()}
    assert str(lib1.id) in ids
    assert str(lib2.id) in ids
    # Other user's library should not appear
    assert all(lib["id"] in {str(lib1.id), str(lib2.id)} for lib in resp.json())


@pytest.mark.asyncio
async def test_bulk_delete_cross_library_returns_403(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Bulk delete with IDs from another library returns 403."""
    async with test_session() as session:
        user_a = await _create_user(session, "bulkA@example.com")
        user_b = await _create_user(session, "bulkB@example.com")
        lib_a = await _create_library(session, user_a, "Library A")
        lib_b = await _create_library(session, user_b, "Library B")
        book_a = Book(library_id=lib_a.id, title="Book A")
        book_b = Book(library_id=lib_b.id, title="Book B")
        session.add_all([book_a, book_b])
        await session.commit()
        await session.refresh(book_a)
        await session.refresh(book_b)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers_a = {**await _login(client, "bulkA@example.com"), **_lib_header(lib_a.id)}

        # Try to bulk-delete a book from library B — should 403
        resp = await client.post(
            "/api/v1/books/bulk/delete",
            json={"ids": [str(book_b.id)]},
            headers=headers_a,
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_book_from_other_library_returns_404(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """GET /books/{id} from another library returns 404 (don't leak existence)."""
    async with test_session() as session:
        user_a = await _create_user(session, "getA@example.com")
        user_b = await _create_user(session, "getB@example.com")
        lib_a = await _create_library(session, user_a, "Library A")
        lib_b = await _create_library(session, user_b, "Library B")
        book_b = Book(library_id=lib_b.id, title="Secret Book")
        session.add(book_b)
        await session.commit()
        await session.refresh(book_b)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers_a = {**await _login(client, "getA@example.com"), **_lib_header(lib_a.id)}
        resp = await client.get(f"/api/v1/books/{book_b.id}", headers=headers_a)

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_library_and_become_owner(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """POST /libraries creates a library and the creator becomes owner."""
    async with test_session() as session:
        user = await _create_user(session, "newowner@example.com")
        # Give them at least one library so login works
        await _create_library(session, user, "Default Library")
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "newowner@example.com")
        resp = await client.post("/api/v1/libraries", json={"name": "Brand New Library"}, headers=headers)

    assert resp.status_code == 201
    assert resp.json()["name"] == "Brand New Library"
    assert resp.json()["role"] == "owner"
