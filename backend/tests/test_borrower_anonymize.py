"""Tests for the borrower anonymization endpoint (issue #226).

Covers:
- anonymizing a borrower with an active loan clears identifying data
- anonymizing a borrower with a returned loan keeps history but strips PII
- the loan history endpoint still renders the borrower's loans afterwards
- already-anonymized borrowers are a no-op (idempotent)
- anonymization across libraries returns 404
- viewer role cannot anonymize (403)
- 401 without auth
"""
from collections.abc import AsyncIterator, Iterator
from datetime import date, datetime, timedelta, timezone
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
    email: str = "admin@example.com",
    role: LibraryRole = LibraryRole.OWNER,
) -> tuple[User, Library]:
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(email=email, hashed_password=get_password_hash("secret"))
        session.add(user)
        await session.flush()
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
        session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=role))
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


def _make_book(library_id: uuid.UUID, title: str = "Some Book") -> Book:
    return Book(library_id=library_id, title=title)


def _make_loan(
    *,
    library_id: uuid.UUID,
    book_id: uuid.UUID,
    borrower_id: uuid.UUID,
    borrower_name: str,
    borrower_contact: str | None,
    lent_date: date,
    returned_date: date | None = None,
    return_condition: str | None = None,
) -> Loan:
    return Loan(
        library_id=library_id,
        book_id=book_id,
        borrower_id=borrower_id,
        borrower_name=borrower_name,
        borrower_contact=borrower_contact,
        lent_date=lent_date,
        returned_date=returned_date,
        return_condition=return_condition,
    )


# ── Happy path ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_anonymize_strips_borrower_pii_and_sets_anonymized_at(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    borrower = Borrower(
        library_id=lib.id, name="Alice Liddell", contact="alice@x.com", notes="VIP"
    )
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Deleted borrower"
    assert body["contact"] is None
    assert body["notes"] is None
    assert body["anonymized_at"] is not None


@pytest.mark.asyncio
async def test_anonymize_clears_borrower_text_on_active_loan(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    today = date.today()

    borrower = Borrower(library_id=lib.id, name="Alice", contact="alice@x.com")
    test_session.add(borrower)
    await test_session.flush()

    book = _make_book(lib.id)
    test_session.add(book)
    await test_session.flush()

    loan = _make_loan(
        library_id=lib.id, book_id=book.id, borrower_id=borrower.id,
        borrower_name="Alice", borrower_contact="alice@x.com", lent_date=today,
    )
    test_session.add(loan)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers)
        assert resp.status_code == 200

    refreshed = (await test_session.execute(select(Loan).where(Loan.id == loan.id))).scalar_one()
    assert refreshed.borrower_name == "Deleted borrower"
    assert refreshed.borrower_contact is None
    assert refreshed.borrower_id == borrower.id  # link is preserved


@pytest.mark.asyncio
async def test_anonymize_clears_borrower_text_on_returned_loan(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    today = date.today()

    borrower = Borrower(library_id=lib.id, name="Bob", contact="bob@x.com")
    test_session.add(borrower)
    await test_session.flush()

    book = _make_book(lib.id, "Returned Book")
    test_session.add(book)
    await test_session.flush()

    loan = _make_loan(
        library_id=lib.id, book_id=book.id, borrower_id=borrower.id,
        borrower_name="Bob", borrower_contact="bob@x.com",
        lent_date=today - timedelta(days=20),
        returned_date=today - timedelta(days=2),
        return_condition="good",
    )
    test_session.add(loan)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers)
        assert resp.status_code == 200

    refreshed = (await test_session.execute(select(Loan).where(Loan.id == loan.id))).scalar_one()
    assert refreshed.borrower_name == "Deleted borrower"
    assert refreshed.borrower_contact is None
    # History fields preserved
    assert refreshed.returned_date == today - timedelta(days=2)
    assert refreshed.return_condition == "good"


@pytest.mark.asyncio
async def test_loan_history_endpoint_still_renders_after_anonymization(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    today = date.today()

    borrower = Borrower(library_id=lib.id, name="Carol", contact="carol@x.com")
    test_session.add(borrower)
    await test_session.flush()

    book = _make_book(lib.id, "Some Title")
    test_session.add(book)
    await test_session.flush()

    test_session.add(_make_loan(
        library_id=lib.id, book_id=book.id, borrower_id=borrower.id,
        borrower_name="Carol", borrower_contact="carol@x.com", lent_date=today,
    ))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        anon = await client.post(f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers)
        assert anon.status_code == 200

        loans = await client.get(f"/api/v1/borrowers/{borrower.id}/loans", headers=headers)
        assert loans.status_code == 200
        body = loans.json()
        assert len(body) == 1
        assert body[0]["book_title"] == "Some Title"
        # The endpoint is loan-centric; the borrower-detail GET tells the
        # frontend the borrower is anonymized, so loan rows don't repeat that.

        detail = await client.get(f"/api/v1/borrowers/{borrower.id}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["anonymized_at"] is not None


# ── Idempotency, isolation, auth ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_anonymize_already_anonymized_is_idempotent(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    borrower = Borrower(library_id=lib.id, name="Dan")
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        first = await client.post(f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers)
        assert first.status_code == 200
        first_anonymized_at = first.json()["anonymized_at"]

        second = await client.post(f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers)
        assert second.status_code == 200
        assert second.json()["anonymized_at"] == first_anonymized_at
        assert second.json()["name"] == "Deleted borrower"


@pytest.mark.asyncio
async def test_anonymize_foreign_borrower_returns_404(test_session: AsyncSession) -> None:
    user, _ = await _seed_user_with_library(test_session)
    foreign_lib = Library(name="Foreign", created_by_user_id=user.id)
    test_session.add(foreign_lib)
    await test_session.flush()
    foreign = Borrower(library_id=foreign_lib.id, name="Foreign")
    test_session.add(foreign)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(f"/api/v1/borrowers/{foreign.id}/anonymize", headers=headers)
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_anonymize_unknown_borrower_returns_404(test_session: AsyncSession) -> None:
    await _seed_user_with_library(test_session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(f"/api/v1/borrowers/{uuid.uuid4()}/anonymize", headers=headers)
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_anonymize_requires_editor_role(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session, "owner@example.com")
    borrower = Borrower(library_id=lib.id, name="Eva")
    test_session.add(borrower)

    viewer = User(email="viewer@example.com", hashed_password=get_password_hash("secret"))
    test_session.add(viewer)
    await test_session.flush()
    test_session.add(LibraryMember(library_id=lib.id, user_id=viewer.id, role=LibraryRole.VIEWER))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "viewer@example.com", "password": "secret"},
        )
        viewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        resp = await client.post(
            f"/api/v1/borrowers/{borrower.id}/anonymize", headers=viewer_headers
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_anonymize_requires_authentication() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(f"/api/v1/borrowers/{uuid.uuid4()}/anonymize")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_bulk_anonymize_success(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    first = Borrower(library_id=lib.id, name="Alice", contact="alice@example.com", notes="a")
    second = Borrower(library_id=lib.id, name="Bob", contact="bob@example.com", notes="b")
    test_session.add_all([first, second])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            "/api/v1/borrowers/bulk/anonymize",
            headers=headers,
            json={"ids": [str(first.id), str(second.id)]},
        )
    assert resp.status_code == 200
    assert resp.json() == {"affected": 2}

    refreshed = (
        await test_session.execute(select(Borrower).where(Borrower.id.in_([first.id, second.id])))
    ).scalars().all()
    assert all(row.name == "Deleted borrower" for row in refreshed)
    assert all(row.contact is None for row in refreshed)
    assert all(row.notes is None for row in refreshed)
    assert all(row.anonymized_at is not None for row in refreshed)


@pytest.mark.asyncio
async def test_bulk_anonymize_foreign_borrower_returns_404(test_session: AsyncSession) -> None:
    _, own_lib = await _seed_user_with_library(test_session)
    _, foreign_lib = await _seed_user_with_library(test_session, email="other@example.com")
    own = Borrower(library_id=own_lib.id, name="Own")
    foreign = Borrower(library_id=foreign_lib.id, name="Foreign")
    test_session.add_all([own, foreign])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            "/api/v1/borrowers/bulk/anonymize",
            headers=headers,
            json={"ids": [str(own.id), str(foreign.id)]},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_bulk_anonymize_duplicate_ids_rejected(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    borrower = Borrower(library_id=lib.id, name="Dup")
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            "/api/v1/borrowers/bulk/anonymize",
            headers=headers,
            json={"ids": [str(borrower.id), str(borrower.id)]},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_bulk_anonymize_by_date_dry_run_counts_without_mutation(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    borrower = Borrower(
        library_id=lib.id,
        name="Dry Run",
        created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
    )
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date",
            headers=headers,
            json={"inactive_since": "2024-01-01", "dry_run": True},
        )
    assert resp.status_code == 200
    assert resp.json() == {"affected": 1}

    refreshed = (await test_session.execute(select(Borrower).where(Borrower.id == borrower.id))).scalar_one()
    assert refreshed.anonymized_at is None
    assert refreshed.name == "Dry Run"


@pytest.mark.asyncio
async def test_bulk_anonymize_by_date_rules_and_idempotency(test_session: AsyncSession) -> None:
    user, lib = await _seed_user_with_library(test_session)
    foreign_lib = Library(name="Foreign", created_by_user_id=user.id)
    test_session.add(foreign_lib)
    await test_session.flush()

    today = date(2026, 5, 1)
    cutoff = "2025-01-01"

    no_loans_old = Borrower(
        library_id=lib.id,
        name="NoLoansOld",
        created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
    )
    returned_old = Borrower(library_id=lib.id, name="ReturnedOld")
    active_old = Borrower(library_id=lib.id, name="ActiveOld")
    recent_returned = Borrower(library_id=lib.id, name="RecentReturned")
    already_anonymized = Borrower(
        library_id=lib.id, name="Already", anonymized_at=datetime.now(timezone.utc)
    )
    foreign = Borrower(library_id=foreign_lib.id, name="Foreign")
    test_session.add_all([no_loans_old, returned_old, active_old, recent_returned, already_anonymized, foreign])
    await test_session.flush()

    book = _make_book(lib.id, "Book")
    foreign_book = _make_book(foreign_lib.id, "Foreign Book")
    test_session.add_all([book, foreign_book])
    await test_session.flush()

    test_session.add_all([
        _make_loan(
            library_id=lib.id, book_id=book.id, borrower_id=returned_old.id,
            borrower_name="ReturnedOld", borrower_contact=None, lent_date=date(2024, 1, 1),
            returned_date=date(2024, 1, 10), return_condition="good",
        ),
        _make_loan(
            library_id=lib.id, book_id=book.id, borrower_id=active_old.id,
            borrower_name="ActiveOld", borrower_contact=None, lent_date=date(2024, 1, 1),
        ),
        _make_loan(
            library_id=lib.id, book_id=book.id, borrower_id=recent_returned.id,
            borrower_name="RecentReturned", borrower_contact=None, lent_date=today,
            returned_date=today, return_condition="good",
        ),
        _make_loan(
            library_id=foreign_lib.id, book_id=foreign_book.id, borrower_id=foreign.id,
            borrower_name="Foreign", borrower_contact=None, lent_date=date(2020, 1, 1),
            returned_date=date(2020, 1, 2), return_condition="good",
        ),
    ])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        first = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date",
            headers=headers,
            json={"inactive_since": cutoff, "dry_run": False},
        )
        second = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date",
            headers=headers,
            json={"inactive_since": cutoff, "dry_run": False},
        )
    assert first.status_code == 200
    assert first.json() == {"affected": 2}
    assert second.status_code == 200
    assert second.json() == {"affected": 0}

    borrowers = (
        await test_session.execute(
            select(Borrower).where(
                Borrower.id.in_([
                    no_loans_old.id,
                    returned_old.id,
                    active_old.id,
                    recent_returned.id,
                    already_anonymized.id,
                    foreign.id,
                ])
            )
        )
    ).scalars().all()
    by_id = {row.id: row for row in borrowers}
    assert by_id[no_loans_old.id].anonymized_at is not None
    assert by_id[returned_old.id].anonymized_at is not None
    assert by_id[active_old.id].anonymized_at is None
    assert by_id[recent_returned.id].anonymized_at is None
    assert by_id[already_anonymized.id].anonymized_at is not None
    assert by_id[foreign.id].anonymized_at is None
