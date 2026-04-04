from collections.abc import AsyncIterator, Iterator
from datetime import date, timedelta
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
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.loan import Loan
from app.models.user import User


def _require_test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_loans.db")


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
    session.add(User(email="admin@example.com", hashed_password=get_password_hash("secret")))
    await session.commit()
    return (await session.execute(select(User).where(User.email == "admin@example.com"))).scalar_one()


async def _seed_user_with_library(session: AsyncSession) -> tuple[User, Library]:
    existing = (await session.execute(select(User).where(User.email == "admin@example.com"))).scalar_one_or_none()
    if existing is not None:
        lib = (await session.execute(
            select(Library).join(LibraryMember, LibraryMember.library_id == Library.id)
            .where(LibraryMember.user_id == existing.id).limit(1)
        )).scalar_one_or_none()
        if lib is not None:
            return existing, lib
        user = existing
    else:
        user = User(email="admin@example.com", hashed_password=get_password_hash("secret"))
        session.add(user)
        await session.flush()
    lib = Library(name="Test Library", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(user)
    await session.refresh(lib)
    return user, lib


async def _auth_headers(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    await _seed_user_with_library(session)
    login_response = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "secret"})
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def _create_book(client: AsyncClient, headers: dict[str, str], title: str = "Loanable") -> str:
    response = await client.post("/api/v1/books", json={"title": title}, headers=headers)
    assert response.status_code == 201
    return str(response.json()["id"])


@pytest.mark.asyncio
async def test_create_loan(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        book_id = await _create_book(client, headers)
        response = await client.post(
            f"/api/v1/books/{book_id}/loans",
            json={"borrower_name": "Alice", "borrower_contact": "alice@example.com", "notes": "Handle with care"},
            headers=headers,
        )

    assert response.status_code == 201
    body = response.json()
    assert body["book_id"] == book_id
    assert body["borrower_name"] == "Alice"
    assert body["borrower_contact"] == "alice@example.com"
    assert body["returned_date"] is None
    assert body["is_active"] is True


@pytest.mark.asyncio
async def test_create_loan_book_not_found(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.post(
            f"/api/v1/books/{uuid.uuid4()}/loans",
            json={"borrower_name": "Alice"},
            headers=headers,
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_loan_already_lent(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        book_id = await _create_book(client, headers)
        first = await client.post(f"/api/v1/books/{book_id}/loans", json={"borrower_name": "Alice"}, headers=headers)
        assert first.status_code == 201

        second = await client.post(f"/api/v1/books/{book_id}/loans", json={"borrower_name": "Bob"}, headers=headers)

    assert second.status_code == 409


@pytest.mark.asyncio
async def test_list_loans(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        book_id = await _create_book(client, headers)
        loans: list[str] = []
        for idx in range(3):
            lent_date = date.today() - timedelta(days=idx)
            created = await client.post(
                f"/api/v1/books/{book_id}/loans",
                json={"borrower_name": f"Borrower {idx}", "lent_date": lent_date.isoformat()},
                headers=headers,
            )
            assert created.status_code == 201
            loans.append(created.json()["id"])
            if idx < 2:
                returned = await client.patch(
                    f"/api/v1/books/{book_id}/loans/{loans[-1]}/return",
                    json={"return_condition": "good"},
                    headers=headers,
                )
                assert returned.status_code == 200

        listed = await client.get(f"/api/v1/books/{book_id}/loans", headers=headers)

    assert listed.status_code == 200
    payload = listed.json()
    assert len(payload) == 3
    assert payload[0]["borrower_name"] == "Borrower 0"
    assert payload[1]["borrower_name"] == "Borrower 1"
    assert payload[2]["borrower_name"] == "Borrower 2"


@pytest.mark.asyncio
async def test_return_loan(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        book_id = await _create_book(client, headers)
        created = await client.post(f"/api/v1/books/{book_id}/loans", json={"borrower_name": "Alice"}, headers=headers)
        loan_id = created.json()["id"]

        returned = await client.patch(
            f"/api/v1/books/{book_id}/loans/{loan_id}/return",
            json={"return_condition": "fair", "notes": "Slight cover wear"},
            headers=headers,
        )

    assert returned.status_code == 200
    body = returned.json()
    assert body["returned_date"] == date.today().isoformat()
    assert body["return_condition"] == "fair"
    assert body["notes"] == "Slight cover wear"
    assert body["is_active"] is False


@pytest.mark.asyncio
async def test_return_loan_already_returned(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        book_id = await _create_book(client, headers)
        created = await client.post(f"/api/v1/books/{book_id}/loans", json={"borrower_name": "Alice"}, headers=headers)
        loan_id = created.json()["id"]
        first = await client.patch(
            f"/api/v1/books/{book_id}/loans/{loan_id}/return",
            json={"return_condition": "perfect"},
            headers=headers,
        )
        assert first.status_code == 200

        second = await client.patch(
            f"/api/v1/books/{book_id}/loans/{loan_id}/return",
            json={"return_condition": "good"},
            headers=headers,
        )

    assert second.status_code == 409


@pytest.mark.asyncio
async def test_return_loan_not_found(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        book_id = await _create_book(client, headers)
        response = await client.patch(
            f"/api/v1/books/{book_id}/loans/{uuid.uuid4()}/return",
            json={"return_condition": "good"},
            headers=headers,
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_loan(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        book_id = await _create_book(client, headers)
        created = await client.post(f"/api/v1/books/{book_id}/loans", json={"borrower_name": "Alice"}, headers=headers)
        loan_id = created.json()["id"]

        deleted = await client.delete(f"/api/v1/books/{book_id}/loans/{loan_id}", headers=headers)
        listed = await client.get(f"/api/v1/books/{book_id}/loans", headers=headers)

    assert deleted.status_code == 204
    assert listed.status_code == 200
    assert listed.json() == []


@pytest.mark.asyncio
async def test_book_response_includes_active_loan(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        book_id = await _create_book(client, headers)
        created = await client.post(f"/api/v1/books/{book_id}/loans", json={"borrower_name": "Alice"}, headers=headers)
        assert created.status_code == 201

        fetched = await client.get(f"/api/v1/books/{book_id}", headers=headers)

    assert fetched.status_code == 200
    body = fetched.json()
    assert body["is_currently_lent"] is True
    assert body["active_loan"] is not None
    assert body["active_loan"]["borrower_name"] == "Alice"


@pytest.mark.asyncio
async def test_reading_status_independent_from_lending(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        created = await client.post(
            "/api/v1/books",
            json={"title": "Already Read", "reading_status": "read"},
            headers=headers,
        )
        assert created.status_code == 201
        book_id = created.json()["id"]

        loan = await client.post(f"/api/v1/books/{book_id}/loans", json={"borrower_name": "Alice"}, headers=headers)
        assert loan.status_code == 201

        fetched = await client.get(f"/api/v1/books/{book_id}", headers=headers)

    assert fetched.status_code == 200
    body = fetched.json()
    assert body["reading_status"] == "read"
    assert body["is_currently_lent"] is True


@pytest.mark.asyncio
async def test_cascade_delete_book_deletes_loans(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        book_id = await _create_book(client, headers)
        created = await client.post(f"/api/v1/books/{book_id}/loans", json={"borrower_name": "Alice"}, headers=headers)
        assert created.status_code == 201
        loan_id = created.json()["id"]

        deleted_book = await client.delete(f"/api/v1/books/{book_id}", headers=headers)
        assert deleted_book.status_code == 204

        async with test_session() as session:
            loan = await session.get(Loan, uuid.UUID(loan_id))

    assert loan is None


@pytest.mark.asyncio
async def test_list_loans_book_not_found(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get(f"/api/v1/books/{uuid.uuid4()}/loans", headers=headers)

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_return_loan_wrong_book_returns_404(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        first_book_id = await _create_book(client, headers, title="First")
        second_book_id = await _create_book(client, headers, title="Second")
        created = await client.post(
            f"/api/v1/books/{first_book_id}/loans",
            json={"borrower_name": "Alice"},
            headers=headers,
        )
        assert created.status_code == 201
        loan_id = created.json()["id"]

        response = await client.patch(
            f"/api/v1/books/{second_book_id}/loans/{loan_id}/return",
            json={"return_condition": "good"},
            headers=headers,
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_loan_wrong_book_returns_404(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        first_book_id = await _create_book(client, headers, title="First")
        second_book_id = await _create_book(client, headers, title="Second")
        created = await client.post(
            f"/api/v1/books/{first_book_id}/loans",
            json={"borrower_name": "Alice"},
            headers=headers,
        )
        assert created.status_code == 201
        loan_id = created.json()["id"]

        response = await client.delete(
            f"/api/v1/books/{second_book_id}/loans/{loan_id}",
            headers=headers,
        )

    assert response.status_code == 404
