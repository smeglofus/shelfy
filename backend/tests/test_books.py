from collections.abc import AsyncIterator, Iterator
import os
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.book import Book
from app.models.location import Location
from app.models.user import User


@pytest.fixture
async def test_session() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        os.environ.get(
            "TEST_DATABASE_URL",
            "postgresql+asyncpg://test:test@localhost:5432/shelfy_test",
        )
    )
    async with engine.begin() as connection:
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "manual",
                "pending",
                "done",
                "failed",
                "partial",
                name="book_processing_status",
            ).create(sync_conn, checkfirst=True)
        )
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield session_factory

    await engine.dispose()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        database_url=os.environ.get(
            "TEST_DATABASE_URL",
            "postgresql+asyncpg://test:test@localhost:5432/shelfy_test",
        ),
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


async def _seed_user(session: AsyncSession) -> None:
    session.add(User(email="admin@example.com", hashed_password=get_password_hash("secret")))
    await session.commit()


async def _auth_headers(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    await _seed_user(session)
    login_response = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "secret"})
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def _create_location(session: AsyncSession) -> uuid.UUID:
    location = Location(room="office", furniture="bookshelf", shelf="shelf-1")
    session.add(location)
    await session.commit()
    await session.refresh(location)
    return location.id


@pytest.mark.asyncio
async def test_books_full_crud_cycle(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
            location_id = await _create_location(session)

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
        session.add_all(
            [
                Book(title="The Pragmatic Programmer", author="Andrew Hunt"),
                Book(title="Domain-Driven Design", author="Eric Evans"),
                Book(title="Refactoring", author="Martin Fowler"),
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
        location_id = await _create_location(session)
        session.add_all(
            [
                Book(title="Book A", location_id=location_id),
                Book(title="Book B", location_id=location_id),
                Book(title="Book C"),
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
        session.add_all([Book(title=f"Book {index}") for index in range(1, 6)])
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
            valid_location_id = await _create_location(session)
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
