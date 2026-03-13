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


@pytest.mark.asyncio
async def test_locations_full_crud_cycle(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        created = await client.post(
            "/api/v1/locations",
            json={"room": "office", "furniture": "bookshelf-2", "shelf": "shelf-3"},
            headers=headers,
        )
        assert created.status_code == 201
        location_id = created.json()["id"]

        assert (await client.get("/api/v1/locations", headers=headers)).status_code == 200
        assert (await client.get(f"/api/v1/locations/{location_id}", headers=headers)).status_code == 200

        patched = await client.patch(
            f"/api/v1/locations/{location_id}", json={"shelf": "shelf-4"}, headers=headers
        )
        assert patched.status_code == 200
        assert patched.json()["shelf"] == "shelf-4"

        patched_null = await client.patch(
            f"/api/v1/locations/{location_id}",
            json={"shelf": None},
            headers=headers,
        )
        assert 400 <= patched_null.status_code < 500

        deleted = await client.delete(f"/api/v1/locations/{location_id}", headers=headers)
        assert deleted.status_code == 204
        assert (await client.get(f"/api/v1/locations/{location_id}", headers=headers)).status_code == 404


@pytest.mark.asyncio
async def test_locations_require_authentication() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/v1/locations")).status_code == 401


@pytest.mark.asyncio
async def test_delete_location_blocked_when_books_assigned(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        created = await client.post(
            "/api/v1/locations",
            json={"room": "office", "furniture": "bookshelf-2", "shelf": "shelf-3"},
            headers=headers,
        )
        location_id = uuid.UUID(created.json()["id"])

        test_session.add(Book(title="Domain-Driven Design", location_id=location_id))
        await test_session.commit()

        blocked = await client.delete(f"/api/v1/locations/{location_id}", headers=headers)

    assert blocked.status_code == 409


@pytest.mark.asyncio
async def test_delete_location_succeeds_when_no_books_assigned(test_session: AsyncSession) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        created = await client.post(
            "/api/v1/locations",
            json={"room": "office", "furniture": "bookshelf-2", "shelf": "shelf-3"},
            headers=headers,
        )
        location_id = created.json()["id"]

        delete_response = await client.delete(f"/api/v1/locations/{location_id}", headers=headers)

    assert delete_response.status_code == 204
