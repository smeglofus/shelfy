from collections.abc import AsyncIterator, Iterator
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
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
def override_dependencies(test_session: AsyncSession, test_settings: Settings) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield test_session

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
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def _create_location(session: AsyncSession) -> uuid.UUID:
    location = Location(room="office", furniture="bookshelf", shelf="shelf-1")
    session.add(location)
    await session.commit()
    await session.refresh(location)
    return location.id


@pytest.mark.asyncio
async def test_books_full_crud_cycle(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        location_id = await _create_location(test_session)

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
async def test_books_search_returns_expected_results(test_session: AsyncSession) -> None:
    test_session.add_all(
        [
            Book(title="The Pragmatic Programmer", author="Andrew Hunt"),
            Book(title="Domain-Driven Design", author="Eric Evans"),
            Book(title="Refactoring", author="Martin Fowler"),
        ]
    )
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)

        response = await client.get("/api/v1/books", params={"search": "Evans"}, headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["title"] == "Domain-Driven Design"


@pytest.mark.asyncio
async def test_books_filter_by_location(test_session: AsyncSession) -> None:
    location_id = await _create_location(test_session)
    test_session.add_all(
        [
            Book(title="Book A", location_id=location_id),
            Book(title="Book B", location_id=location_id),
            Book(title="Book C"),
        ]
    )
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)

        response = await client.get(
            "/api/v1/books", params={"location_id": str(location_id)}, headers=headers
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert {item["title"] for item in payload["items"]} == {"Book A", "Book B"}


@pytest.mark.asyncio
async def test_books_pagination_returns_total_and_page_size(test_session: AsyncSession) -> None:
    test_session.add_all([Book(title=f"Book {index}") for index in range(1, 6)])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)

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
