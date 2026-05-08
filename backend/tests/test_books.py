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
from app.models.borrower import Borrower
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.loan import Loan
from app.models.location import Location
from app.models.user import User


def _require_test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_books.db")


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


async def _seed_user(session: AsyncSession) -> User:
    existing = (await session.execute(select(User).where(User.email == "admin@example.com"))).scalar_one_or_none()
    if existing is not None:
        return existing
    user = User(email="admin@example.com", hashed_password=get_password_hash("secret"))
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _seed_user_with_library(session: AsyncSession) -> tuple[User, Library]:
    """Idempotent: creates or returns existing user + their default library."""
    user = await _seed_user(session)
    existing_lib = (await session.execute(
        select(Library)
        .join(LibraryMember, LibraryMember.library_id == Library.id)
        .where(LibraryMember.user_id == user.id)
        .limit(1)
    )).scalar_one_or_none()
    if existing_lib is not None:
        return user, existing_lib
    lib = Library(name="Test Library", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return user, lib


async def _auth_headers(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    await _seed_user_with_library(session)
    login_response = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "secret"})
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def _create_location(session: AsyncSession, library_id: uuid.UUID) -> uuid.UUID:
    location = Location(library_id=library_id, room="office", furniture="bookshelf", shelf="shelf-1")
    session.add(location)
    await session.commit()
    await session.refresh(location)
    return location.id


@pytest.mark.asyncio
async def test_books_full_crud_cycle(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
            _, library = await _seed_user_with_library(session)
            location_id = await _create_location(session, library.id)

        created = await client.post(
            "/api/v1/books",
            json={
                "title": "Clean Architecture",
                "author": "Robert C. Martin",
                "isbn": "9780134494166",
                "publisher": "Prentice Hall",
                "language": "en",
                "description": "Software architecture and design principles.",
                "publication_year": 2017,
                "cover_image_url": "https://example.com/clean-architecture.jpg",
                "location_id": str(location_id),
            },
            headers=headers,
        )
        assert created.status_code == 201
        book_id = created.json()["id"]

        listed = await client.get("/api/v1/books", headers=headers)
        assert listed.status_code == 200
        assert listed.json()["total"] == 1
        assert len(listed.json()["items"]) == 1

        fetched = await client.get(f"/api/v1/books/{book_id}", headers=headers)
        assert fetched.status_code == 200
        assert fetched.json()["isbn"] == "9780134494166"

        updated = await client.patch(
            f"/api/v1/books/{book_id}",
            json={"title": "Clean Architecture (Updated)", "location_id": None},
            headers=headers,
        )
        assert updated.status_code == 200
        assert updated.json()["title"] == "Clean Architecture (Updated)"
        assert updated.json()["location_id"] is None

        deleted = await client.delete(f"/api/v1/books/{book_id}", headers=headers)
        assert deleted.status_code == 204
        assert (await client.get(f"/api/v1/books/{book_id}", headers=headers)).status_code == 404


@pytest.mark.asyncio
async def test_books_search_returns_expected_results(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        session.add_all(
            [
                Book(library_id=library.id, title="The Pragmatic Programmer", author="Andrew Hunt"),
                Book(library_id=library.id, title="Domain-Driven Design", author="Eric Evans"),
                Book(library_id=library.id, title="Refactoring", author="Martin Fowler"),
            ]
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get("/api/v1/books", params={"search": "Evans"}, headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["title"] == "Domain-Driven Design"


@pytest.mark.asyncio
async def test_books_filter_by_location(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        location_id = await _create_location(session, library.id)
        session.add_all(
            [
                Book(library_id=library.id, title="Book A", location_id=location_id),
                Book(library_id=library.id, title="Book B", location_id=location_id),
                Book(library_id=library.id, title="Book C"),
            ]
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get(
            "/api/v1/books", params={"location_id": str(location_id)}, headers=headers
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert {item["title"] for item in payload["items"]} == {"Book A", "Book B"}


@pytest.mark.asyncio
async def test_books_pagination_returns_total_and_page_size(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        session.add_all([Book(library_id=library.id, title=f"Book {index}") for index in range(1, 6)])
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get(
            "/api/v1/books", params={"page": 2, "page_size": 2}, headers=headers
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 5
    assert payload["page"] == 2
    assert payload["page_size"] == 2
    assert len(payload["items"]) == 2


@pytest.mark.asyncio
async def test_books_require_authentication() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/v1/books")).status_code == 401


@pytest.mark.asyncio
async def test_create_book_with_duplicate_isbn_returns_409(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        first = await client.post(
            "/api/v1/books",
            json={"title": "Book One", "isbn": "9780134494166"},
            headers=headers,
        )
        assert first.status_code == 201

        duplicate = await client.post(
            "/api/v1/books",
            json={"title": "Book Two", "isbn": "9780134494166"},
            headers=headers,
        )

    assert duplicate.status_code == 409


@pytest.mark.asyncio
async def test_invalid_location_id_returns_404_on_post_and_patch(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    invalid_location_id = uuid.uuid4()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        invalid_create = await client.post(
            "/api/v1/books",
            json={"title": "Book with Invalid Location", "location_id": str(invalid_location_id)},
            headers=headers,
        )
        assert invalid_create.status_code == 404

        async with test_session() as session:
            _, library = await _seed_user_with_library(session)
            valid_location_id = await _create_location(session, library.id)
        created = await client.post(
            "/api/v1/books",
            json={"title": "Valid Book", "location_id": str(valid_location_id)},
            headers=headers,
        )
        assert created.status_code == 201
        book_id = created.json()["id"]

        invalid_patch = await client.patch(
            f"/api/v1/books/{book_id}",
            json={"location_id": str(invalid_location_id)},
            headers=headers,
        )

    assert invalid_patch.status_code == 404


@pytest.mark.asyncio
async def test_update_book_with_duplicate_isbn_returns_409(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        first = await client.post(
            "/api/v1/books",
            json={"title": "Book One", "isbn": "9780134494166"},
            headers=headers,
        )
        assert first.status_code == 201

        second = await client.post(
            "/api/v1/books",
            json={"title": "Book Two", "isbn": "9780132350884"},
            headers=headers,
        )
        assert second.status_code == 201

        second_book_id = second.json()["id"]

        conflict = await client.patch(
            f"/api/v1/books/{second_book_id}",
            json={"isbn": "9780134494166"},
            headers=headers,
        )

    assert conflict.status_code == 409


@pytest.mark.asyncio
async def test_retry_enrichment_enqueues_worker_task(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        book = Book(library_id=library.id, title="Book pending", isbn="9780134494166")
        session.add(book)
        await session.commit()
        await session.refresh(book)
        book_id = book.id

    from unittest.mock import patch

    with patch("app.api.books.get_celery_client") as celery_client:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async with test_session() as session:
                headers = await _auth_headers(client, session)

            response = await client.patch(f"/api/v1/books/{book_id}/retry-enrichment", headers=headers)

    assert response.status_code == 202
    assert response.json()["book_id"] == str(book_id)
    assert response.json()["status"] == "queued"
    celery_client.return_value.send_task.assert_called_once_with(
        "worker.celery_app.retry_book_enrichment",
        args=[str(book_id)],
    )


@pytest.mark.asyncio
async def test_retry_enrichment_missing_book_returns_404(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.patch(f"/api/v1/books/{uuid.uuid4()}/retry-enrichment", headers=headers)

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_books_export_returns_csv(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        location_id = await _create_location(session, library.id)
        session.add(Book(library_id=library.id, title="Export Me", author="Tester", location_id=location_id, isbn="1234567890"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get('/api/v1/books/export', headers=headers)

    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/csv')
    assert 'attachment; filename="shelfy-export.csv"' in response.headers.get('content-disposition', '')
    # Check new column layout (description + individual location columns, UTF-8 BOM stripped)
    content = response.content.lstrip(b"\xef\xbb\xbf").decode("utf-8")
    assert 'title,author,isbn,publisher,language,publication_year,description,reading_status,room,furniture,shelf,shelf_position' in content
    assert 'Export Me,Tester,1234567890' in content


@pytest.mark.asyncio
async def test_books_export_requires_authentication() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get('/api/v1/books/export')
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_book_with_reading_status(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.post(
            "/api/v1/books",
            json={"title": "Reading Status Book", "reading_status": "reading"},
            headers=headers,
        )

    assert response.status_code == 201
    assert response.json()["reading_status"] == "reading"


# ── Issue #128: bookshelf complete-dataset endpoint + reorder hardening ──────

@pytest.mark.asyncio
async def test_shelf_endpoint_returns_all_books_unpaginated(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Regression for #128: ``/books/shelf`` must return every book in the
    library, not just the first page. Libraries with >100 books were losing
    books from the shelf UI because the FE called the paginated list endpoint.
    """
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        location_id = await _create_location(session, library.id)
        session.add_all(
            [
                Book(
                    library_id=library.id,
                    title=f"Book {index:03d}",
                    location_id=location_id,
                    shelf_position=index,
                )
                for index in range(150)
            ]
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get("/api/v1/books/shelf", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert len(payload) == 150
    # Every book has the expected location_id and sequential shelf_position.
    positions = sorted(item["shelf_position"] for item in payload)
    assert positions == list(range(150))


@pytest.mark.asyncio
async def test_shelf_endpoint_orders_by_location_and_shelf_position(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Shelf rendering relies on a deterministic ``(location, position)`` order."""
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        location_a = Location(library_id=library.id, room="r1", furniture="f1", shelf="s1")
        location_b = Location(library_id=library.id, room="r1", furniture="f1", shelf="s2")
        session.add_all([location_a, location_b])
        await session.flush()
        session.add_all(
            [
                Book(library_id=library.id, title="B3", location_id=location_b.id, shelf_position=1),
                Book(library_id=library.id, title="A1", location_id=location_a.id, shelf_position=0),
                Book(library_id=library.id, title="B1", location_id=location_b.id, shelf_position=0),
                Book(library_id=library.id, title="A2", location_id=location_a.id, shelf_position=1),
                # Unassigned book — must still appear but at the tail.
                Book(library_id=library.id, title="Z-unassigned"),
            ]
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get("/api/v1/books/shelf", headers=headers)

    assert response.status_code == 200
    titles = [item["title"] for item in response.json()]
    # Location A (assuming its id sorts before B's) comes first with pos 0,1;
    # then Location B with pos 0,1. Unassigned is last.
    # We assert the relative ordering WITHIN each location and that the
    # unassigned book is at the end.
    assigned = [t for t in titles if t != "Z-unassigned"]
    assert titles[-1] == "Z-unassigned"
    # Within each location, positions must be increasing.
    assert assigned.index("A1") < assigned.index("A2")
    assert assigned.index("B1") < assigned.index("B3")


@pytest.mark.asyncio
async def test_shelf_endpoint_requires_authentication() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/v1/books/shelf")).status_code == 401


@pytest.mark.asyncio
async def test_shelf_endpoint_serializes_book_with_borrower_linked_active_loan(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Regression: a book whose active loan is linked to a Borrower row must
    serialize cleanly via ``GET /api/v1/books/shelf``.

    Pre-fix the ``selectinload(Book.loans)`` chain didn't reach ``Loan.borrower``,
    so async serialization tripped MissingGreenlet on ``loan.borrower`` and the
    whole shelf response 500'd — making every book disappear from the bookshelf
    UI in libraries that had at least one borrower-linked loan (i.e. anyone who
    used the Borrower picker shipped in #224).

    The same shape covers all read paths via the shared ``_book_loan_options``
    helper, so this single test pins the contract.
    """
    from datetime import date

    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        location_id = await _create_location(session, library.id)
        borrower = Borrower(
            library_id=library.id, name="Alice Liddell", contact="alice@x.com"
        )
        session.add(borrower)
        await session.flush()

        book = Book(
            library_id=library.id,
            title="Wonderland",
            location_id=location_id,
            shelf_position=0,
        )
        session.add(book)
        await session.flush()

        session.add(
            Loan(
                library_id=library.id,
                book_id=book.id,
                borrower_id=borrower.id,
                borrower_name=borrower.name,
                borrower_contact=borrower.contact,
                lent_date=date.today(),
            )
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get("/api/v1/books/shelf", headers=headers)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert isinstance(payload, list)
    assert len(payload) == 1
    body = payload[0]
    assert body["title"] == "Wonderland"
    assert body["is_currently_lent"] is True
    assert body["active_loan"] is not None
    assert body["active_loan"]["borrower"] is not None
    assert body["active_loan"]["borrower"]["name"] == "Alice Liddell"


# ── Shelf ETag / If-None-Match ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_shelf_etag_200_includes_etag_header(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """First request to /books/shelf returns 200 with ETag header."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get("/api/v1/books/shelf", headers=headers)
        assert response.status_code == 200
        assert "etag" in response.headers
        assert response.headers["etag"].startswith('W/')
        assert "Cache-Control" in response.headers


@pytest.mark.asyncio
async def test_shelf_etag_304_on_unchanged_data(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Second request with If-None-Match returns 304 when data is unchanged."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response1 = await client.get("/api/v1/books/shelf", headers=headers)
        assert response1.status_code == 200
        etag = response1.headers["etag"]

        # Second request with matching ETag
        headers["If-None-Match"] = etag
        response2 = await client.get("/api/v1/books/shelf", headers=headers)
        assert response2.status_code == 304


@pytest.mark.asyncio
async def test_shelf_etag_changes_on_book_create(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Creating a book changes the ETag — old ETag no longer returns 304."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
            user, library = await _seed_user_with_library(session)

        response1 = await client.get("/api/v1/books/shelf", headers=headers)
        assert response1.status_code == 200
        old_etag = response1.headers["etag"]

        # Create a book — must change the ETag
        await client.post(
            "/api/v1/books",
            json={"title": "New Book"},
            headers=headers,
        )

        response2 = await client.get(
            "/api/v1/books/shelf",
            headers={**headers, "If-None-Match": old_etag},
        )
        assert response2.status_code == 200, (
            f"Expected 200 (ETag should have changed), got {response2.status_code}"
        )
        assert response2.headers["etag"] != old_etag


@pytest.mark.asyncio
async def test_shelf_etag_changes_on_book_delete(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Deleting a book changes the ETag — count is part of the ETag."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
            user, library = await _seed_user_with_library(session)

        # Create a book first
        create = await client.post(
            "/api/v1/books",
            json={"title": "To Delete"},
            headers=headers,
        )
        book_id = create.json()["id"]

        response1 = await client.get("/api/v1/books/shelf", headers=headers)
        old_etag = response1.headers["etag"]

        # Delete it
        await client.delete(f"/api/v1/books/{book_id}", headers=headers)

        response2 = await client.get(
            "/api/v1/books/shelf",
            headers={**headers, "If-None-Match": old_etag},
        )
        assert response2.status_code == 200, (
            f"Expected 200 (ETag should have changed after delete), got {response2.status_code}"
        )


@pytest.mark.asyncio
async def test_shelf_etag_changes_on_location_change(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Creating a location changes the ETag — location metadata is included."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
            user, library = await _seed_user_with_library(session)

        response1 = await client.get("/api/v1/books/shelf", headers=headers)
        old_etag = response1.headers["etag"]

        # Create a location — should change ETag because location count is included
        await client.post(
            "/api/v1/locations",
            json={"room": "office", "furniture": "desk", "shelf": "top"},
            headers=headers,
        )

        response2 = await client.get(
            "/api/v1/books/shelf",
            headers={**headers, "If-None-Match": old_etag},
        )
        assert response2.status_code == 200, (
            f"Expected 200 (ETag should have changed after location create), got {response2.status_code}"
        )


@pytest.mark.asyncio
async def test_bulk_reorder_rejects_partial_payload_with_409(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Regression for #128: reorder must 4xx on partial-coverage payloads,
    not 500 from the ``uq_books_location_shelf_position`` unique index.

    Scenario: shelf has books at positions 0, 1, 2 but caller only knows
    about books at 0 and 1 and tries to swap them. The unmoved book at
    position 2 is not in the payload, so the swap itself is safe — but if
    the caller instead tries to place a book at position 2 without also
    moving book-at-2, that collides.
    """
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        location_id = await _create_location(session, library.id)
        book_ids: list[uuid.UUID] = []
        for index in range(3):
            book = Book(
                library_id=library.id,
                title=f"Book {index}",
                location_id=location_id,
                shelf_position=index,
            )
            session.add(book)
            await session.flush()
            book_ids.append(book.id)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        # Caller tries to put book 0 at position 2 (where book 2 already sits)
        # without including book 2 in the payload. That's exactly the partial
        # dataset bug from prod.
        response = await client.post(
            "/api/v1/books/bulk/reorder",
            json={
                "items": [
                    {"id": str(book_ids[0]), "location_id": str(location_id), "shelf_position": 2},
                ],
            },
            headers=headers,
        )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "shelf" in detail.lower() or "refetch" in detail.lower()


@pytest.mark.asyncio
async def test_bulk_reorder_full_coverage_succeeds(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Sanity check that the #128 hardening doesn't break legitimate reorders."""
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        location_id = await _create_location(session, library.id)
        book_ids: list[uuid.UUID] = []
        for index in range(3):
            book = Book(
                library_id=library.id,
                title=f"Book {index}",
                location_id=location_id,
                shelf_position=index,
            )
            session.add(book)
            await session.flush()
            book_ids.append(book.id)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        # Reverse the shelf — all three books in the payload, no collision.
        response = await client.post(
            "/api/v1/books/bulk/reorder",
            json={
                "items": [
                    {"id": str(book_ids[0]), "location_id": str(location_id), "shelf_position": 2},
                    {"id": str(book_ids[1]), "location_id": str(location_id), "shelf_position": 1},
                    {"id": str(book_ids[2]), "location_id": str(location_id), "shelf_position": 0},
                ],
            },
            headers=headers,
        )

    assert response.status_code == 200
    assert response.json()["affected"] == 3


@pytest.mark.asyncio
async def test_update_book_reading_status_to_read(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        created = await client.post(
            "/api/v1/books",
            json={"title": "Readable Book"},
            headers=headers,
        )
        assert created.status_code == 201
        book_id = created.json()["id"]

        updated = await client.patch(
            f"/api/v1/books/{book_id}",
            json={"reading_status": "read"},
            headers=headers,
        )

    assert updated.status_code == 200
    assert updated.json()["reading_status"] == "read"
