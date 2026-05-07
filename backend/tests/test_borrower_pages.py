"""Tests for the borrower overview/detail page API surface (issue #225).

Covers:
- GET /api/v1/borrowers — now returns active/total/last_activity stats
- GET /api/v1/borrowers/{id}/loans — denormalized loan list with book info
- library isolation on the detail endpoint
"""
from collections.abc import AsyncIterator, Iterator
from datetime import date, timedelta
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
from app.models.book import Book
from app.models.borrower import Borrower
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.loan import Loan
from app.models.user import User


@pytest.fixture
async def test_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
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
    existing = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing is None:
        user = User(email=email, hashed_password=get_password_hash("secret"))
        session.add(user)
        await session.flush()
    else:
        user = existing
    lib = (await session.execute(
        select(Library)
        .join(LibraryMember, LibraryMember.library_id == Library.id)
        .where(LibraryMember.user_id == user.id)
        .limit(1)
    )).scalar_one_or_none()
    if lib is None:
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


def _make_book(library_id: uuid.UUID, title: str, author: str | None = None) -> Book:
    return Book(library_id=library_id, title=title, author=author)


def _make_loan(
    *,
    library_id: uuid.UUID,
    book_id: uuid.UUID,
    borrower_id: uuid.UUID,
    borrower_name: str,
    lent_date: date,
    returned_date: date | None = None,
    return_condition: str | None = None,
) -> Loan:
    return Loan(
        library_id=library_id,
        book_id=book_id,
        borrower_id=borrower_id,
        borrower_name=borrower_name,
        lent_date=lent_date,
        returned_date=returned_date,
        return_condition=return_condition,
    )


# ── List endpoint ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_returns_stats_for_each_borrower(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    today = date.today()

    alice = Borrower(library_id=lib.id, name="Alice")
    bob = Borrower(library_id=lib.id, name="Bob")
    test_session.add_all([alice, bob])
    await test_session.flush()

    book1 = _make_book(lib.id, "Book One", "Author 1")
    book2 = _make_book(lib.id, "Book Two")
    book3 = _make_book(lib.id, "Book Three")
    test_session.add_all([book1, book2, book3])
    await test_session.flush()

    test_session.add_all([
        # Alice: 1 active + 1 returned, total 2, last lent today
        _make_loan(
            library_id=lib.id, book_id=book1.id, borrower_id=alice.id,
            borrower_name="Alice", lent_date=today,
        ),
        _make_loan(
            library_id=lib.id, book_id=book2.id, borrower_id=alice.id,
            borrower_name="Alice", lent_date=today - timedelta(days=20),
            returned_date=today - timedelta(days=5), return_condition="good",
        ),
        # Bob: 1 active, total 1
        _make_loan(
            library_id=lib.id, book_id=book3.id, borrower_id=bob.id,
            borrower_name="Bob", lent_date=today - timedelta(days=2),
        ),
    ])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "secret"},
        )
        headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

        listed = await client.get("/api/v1/borrowers", headers=headers)
        assert listed.status_code == 200
        body = listed.json()
        assert body["total"] == 2
        assert body["page"] == 1
        assert [b["name"] for b in body["items"]] == ["Alice", "Bob"]

        alice_row = body["items"][0]
        assert alice_row["active_loans"] == 1
        assert alice_row["total_loans"] == 2
        assert alice_row["last_activity_at"] == today.isoformat()

        bob_row = body["items"][1]
        assert bob_row["active_loans"] == 1
        assert bob_row["total_loans"] == 1


@pytest.mark.asyncio
async def test_list_returns_zero_stats_for_borrower_without_loans(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    test_session.add(Borrower(library_id=lib.id, name="Zoe"))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get("/api/v1/borrowers", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert len(body["items"]) == 1
        assert body["items"][0]["active_loans"] == 0
        assert body["items"][0]["total_loans"] == 0
        assert body["items"][0]["last_activity_at"] is None


@pytest.mark.asyncio
async def test_list_stats_does_not_count_cross_library_loans(
    test_session: AsyncSession,
) -> None:
    """A malformed cross-library loan must not leak into the borrower's stats.

    In practice the API's create_loan validates library matching, but the JOIN
    in list_borrowers_with_stats pins ``Loan.library_id`` defensively so that
    a row with the wrong library_id (e.g. from a future bulk import bug) does
    not inflate the counts.
    """
    _, lib = await _seed_user_with_library(test_session)
    foreign_lib_id = uuid.uuid4()

    alice = Borrower(library_id=lib.id, name="Alice")
    test_session.add(alice)
    await test_session.flush()

    book = _make_book(lib.id, "B")
    foreign_book = _make_book(foreign_lib_id, "FB")
    test_session.add_all([book, foreign_book])
    await test_session.flush()

    # One legitimate loan in our library
    test_session.add(_make_loan(
        library_id=lib.id, book_id=book.id, borrower_id=alice.id,
        borrower_name="Alice", lent_date=date.today(),
    ))
    # Cross-library loan pointing at our alice.id — this should be ignored.
    # SQLite test DB does not enforce FKs so we can construct this dangling row.
    test_session.add(_make_loan(
        library_id=foreign_lib_id, book_id=foreign_book.id, borrower_id=alice.id,
        borrower_name="Alice", lent_date=date.today(),
    ))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get("/api/v1/borrowers", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["total_loans"] == 1
        assert body["items"][0]["active_loans"] == 1


# ── Pagination + search ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_paginates_with_page_and_page_size(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    for name in ["Alice", "Bob", "Carol", "Dan", "Eve"]:
        test_session.add(Borrower(library_id=lib.id, name=name))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)

        first = await client.get(
            "/api/v1/borrowers", headers=headers, params={"page": 1, "page_size": 2}
        )
        assert first.status_code == 200
        body = first.json()
        assert body["total"] == 5
        assert body["page"] == 1
        assert body["page_size"] == 2
        assert [b["name"] for b in body["items"]] == ["Alice", "Bob"]

        second = await client.get(
            "/api/v1/borrowers", headers=headers, params={"page": 2, "page_size": 2}
        )
        assert [b["name"] for b in second.json()["items"]] == ["Carol", "Dan"]

        third = await client.get(
            "/api/v1/borrowers", headers=headers, params={"page": 3, "page_size": 2}
        )
        assert [b["name"] for b in third.json()["items"]] == ["Eve"]


@pytest.mark.asyncio
async def test_list_search_filters_by_name_substring(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    for name in ["Alice Liddell", "Bob Builder", "Alicia Keys"]:
        test_session.add(Borrower(library_id=lib.id, name=name))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get("/api/v1/borrowers", headers=headers, params={"search": "Ali"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        names = sorted(b["name"] for b in body["items"])
        assert names == ["Alice Liddell", "Alicia Keys"]


@pytest.mark.asyncio
async def test_list_search_is_case_insensitive(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    test_session.add(Borrower(library_id=lib.id, name="Alice"))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get("/api/v1/borrowers", headers=headers, params={"search": "ALICE"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1


@pytest.mark.asyncio
async def test_list_search_combined_with_pagination(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    for name in ["Alice", "Alicia", "Alibaba", "Bob"]:
        test_session.add(Borrower(library_id=lib.id, name=name))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get(
            "/api/v1/borrowers",
            headers=headers,
            params={"search": "Ali", "page": 1, "page_size": 2},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 3  # all three "Ali*" rows count, not just the page slice
        assert len(body["items"]) == 2
        assert [b["name"] for b in body["items"]] == ["Alibaba", "Alice"]


@pytest.mark.asyncio
async def test_list_pagination_validates_params(test_session: AsyncSession) -> None:
    await _seed_user_with_library(test_session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        # page must be >= 1
        bad_page = await client.get("/api/v1/borrowers", headers=headers, params={"page": 0})
        assert bad_page.status_code == 422
        # page_size capped at 100
        too_big = await client.get(
            "/api/v1/borrowers", headers=headers, params={"page_size": 101}
        )
        assert too_big.status_code == 422


# ── Borrower loans endpoint ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_borrower_loans_returns_active_and_returned_with_book_info(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    today = date.today()

    alice = Borrower(library_id=lib.id, name="Alice")
    test_session.add(alice)
    await test_session.flush()

    active_book = _make_book(lib.id, "Active Title", "Author A")
    returned_book = _make_book(lib.id, "Returned Title", None)
    test_session.add_all([active_book, returned_book])
    await test_session.flush()

    test_session.add_all([
        _make_loan(
            library_id=lib.id, book_id=active_book.id, borrower_id=alice.id,
            borrower_name="Alice", lent_date=today - timedelta(days=1),
        ),
        _make_loan(
            library_id=lib.id, book_id=returned_book.id, borrower_id=alice.id,
            borrower_name="Alice", lent_date=today - timedelta(days=30),
            returned_date=today - timedelta(days=10), return_condition="good",
        ),
    ])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get(f"/api/v1/borrowers/{alice.id}/loans", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2

        # Active loan should come first
        assert body[0]["book_title"] == "Active Title"
        assert body[0]["book_author"] == "Author A"
        assert body[0]["returned_date"] is None
        assert body[0]["return_condition"] is None

        assert body[1]["book_title"] == "Returned Title"
        assert body[1]["book_author"] is None
        assert body[1]["returned_date"] == (today - timedelta(days=10)).isoformat()
        assert body[1]["return_condition"] == "good"


@pytest.mark.asyncio
async def test_borrower_loans_returns_empty_list_when_no_loans(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    alice = Borrower(library_id=lib.id, name="Alice")
    test_session.add(alice)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get(f"/api/v1/borrowers/{alice.id}/loans", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []


@pytest.mark.asyncio
async def test_borrower_loans_returns_404_for_foreign_borrower(
    test_session: AsyncSession,
) -> None:
    await _seed_user_with_library(test_session)
    foreign_lib_id = uuid.uuid4()
    foreign = Borrower(library_id=foreign_lib_id, name="Foreign")
    test_session.add(foreign)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get(f"/api/v1/borrowers/{foreign.id}/loans", headers=headers)
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_borrower_loans_returns_404_for_unknown_borrower(
    test_session: AsyncSession,
) -> None:
    await _seed_user_with_library(test_session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.get(f"/api/v1/borrowers/{uuid.uuid4()}/loans", headers=headers)
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_borrower_loans_requires_authentication() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/v1/borrowers/{uuid.uuid4()}/loans")
        assert resp.status_code == 401
