"""Tests for the borrower merge endpoint (issue #238).

Covers:
- happy path: merging two borrowers re-points loans and deletes source
- ADR 008 archival semantic: loan.borrower_name snapshots are NOT updated
- self-merge rejected (422)
- merging anonymized rows rejected (422), either side
- cross-library access returns 404 for both source and target
- viewer role rejected (403)
- unauthenticated rejected (401)
- second merge of the same source returns 404 (idempotent in the sense that
  a stale follow-up call cleanly fails)
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


def _make_book(library_id: uuid.UUID, title: str = "Some Book") -> Book:
    return Book(library_id=library_id, title=title)


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


# ── Happy path ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_merge_repoints_active_and_returned_loans_and_deletes_source(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_user_with_library(test_session)
    today = date.today()

    source = Borrower(library_id=lib.id, name="Alice", contact="alice@old.com")
    target = Borrower(library_id=lib.id, name="Alice Liddell", contact="alice@new.com")
    test_session.add_all([source, target])
    await test_session.flush()

    book_active = _make_book(lib.id, "Active Book")
    book_returned = _make_book(lib.id, "Returned Book")
    test_session.add_all([book_active, book_returned])
    await test_session.flush()

    test_session.add_all([
        _make_loan(
            library_id=lib.id, book_id=book_active.id, borrower_id=source.id,
            borrower_name="Alice", lent_date=today,
        ),
        _make_loan(
            library_id=lib.id, book_id=book_returned.id, borrower_id=source.id,
            borrower_name="Alice", lent_date=today - timedelta(days=20),
            returned_date=today - timedelta(days=2), return_condition="good",
        ),
    ])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(target.id)
    assert body["name"] == "Alice Liddell"
    assert body["contact"] == "alice@new.com"

    # Loans now point at target
    loans = (await test_session.execute(select(Loan).where(Loan.library_id == lib.id))).scalars().all()
    assert len(loans) == 2
    assert {loan.borrower_id for loan in loans} == {target.id}

    # Source row is gone
    gone = (await test_session.execute(
        select(Borrower).where(Borrower.id == source.id)
    )).scalar_one_or_none()
    assert gone is None


@pytest.mark.asyncio
async def test_merge_does_not_update_loan_snapshots(test_session: AsyncSession) -> None:
    """ADR 008: ``Loan.borrower_name`` is the snapshot at lend time and stays
    that way even after merge. Display code reads ``loan.borrower.name`` via
    the relationship — that's what gives users the merged identity on the
    history page, not a DB rewrite."""
    _, lib = await _seed_user_with_library(test_session)
    source = Borrower(library_id=lib.id, name="Alice", contact="old@x.com")
    target = Borrower(library_id=lib.id, name="Alice Liddell", contact="new@x.com")
    test_session.add_all([source, target])
    await test_session.flush()

    book = _make_book(lib.id)
    test_session.add(book)
    await test_session.flush()

    loan = _make_loan(
        library_id=lib.id, book_id=book.id, borrower_id=source.id,
        borrower_name="Alice", lent_date=date.today(),
    )
    test_session.add(loan)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )
        assert resp.status_code == 200

    refreshed = (await test_session.execute(select(Loan).where(Loan.id == loan.id))).scalar_one()
    # Snapshot text untouched — the source's name at lend time was "Alice".
    assert refreshed.borrower_name == "Alice"
    # Relationship now points at target.
    assert refreshed.borrower_id == target.id


# ── Validation ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_merge_self_merge_returns_422(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    borrower = Borrower(library_id=lib.id, name="Lonely")
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            f"/api/v1/borrowers/{borrower.id}/merge",
            json={"source_id": str(borrower.id)},
            headers=headers,
        )
    assert resp.status_code == 422
    assert "itself" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_merge_with_anonymized_source_returns_422(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    source = Borrower(library_id=lib.id, name="Old")
    target = Borrower(library_id=lib.id, name="New")
    test_session.add_all([source, target])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        anon = await client.post(
            f"/api/v1/borrowers/{source.id}/anonymize?immediate=true", headers=headers
        )
        assert anon.status_code == 200

        resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )
    assert resp.status_code == 422
    assert "anonymized" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_merge_with_anonymized_target_returns_422(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    source = Borrower(library_id=lib.id, name="Source")
    target = Borrower(library_id=lib.id, name="Target")
    test_session.add_all([source, target])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        await client.post(f"/api/v1/borrowers/{target.id}/anonymize?immediate=true", headers=headers)

        resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )
    assert resp.status_code == 422


# ── Isolation ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_merge_with_foreign_source_returns_404(test_session: AsyncSession) -> None:
    user, lib = await _seed_user_with_library(test_session)
    foreign_lib = Library(name="Foreign", created_by_user_id=user.id)
    test_session.add(foreign_lib)
    await test_session.flush()
    target = Borrower(library_id=lib.id, name="Target")
    foreign_source = Borrower(library_id=foreign_lib.id, name="Foreign")
    test_session.add_all([target, foreign_source])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(foreign_source.id)},
            headers=headers,
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_merge_with_foreign_target_returns_404(test_session: AsyncSession) -> None:
    user, lib = await _seed_user_with_library(test_session)
    foreign_lib = Library(name="Foreign", created_by_user_id=user.id)
    test_session.add(foreign_lib)
    await test_session.flush()
    source = Borrower(library_id=lib.id, name="Source")
    foreign_target = Borrower(library_id=foreign_lib.id, name="ForeignTarget")
    test_session.add_all([source, foreign_target])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            f"/api/v1/borrowers/{foreign_target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_merge_with_unknown_source_returns_404(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session)
    target = Borrower(library_id=lib.id, name="T")
    test_session.add(target)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)
        resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(uuid.uuid4())},
            headers=headers,
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_double_merge_of_same_source_returns_404(test_session: AsyncSession) -> None:
    """The first merge succeeds and deletes the source; a stale follow-up
    call referencing the same source must cleanly 404."""
    _, lib = await _seed_user_with_library(test_session)
    source = Borrower(library_id=lib.id, name="Source")
    target = Borrower(library_id=lib.id, name="Target")
    test_session.add_all([source, target])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _auth_headers(client, test_session)

        first = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )
        assert first.status_code == 200

        second = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )
        assert second.status_code == 404


# ── Auth ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_merge_requires_editor_role(test_session: AsyncSession) -> None:
    _, lib = await _seed_user_with_library(test_session, "owner@example.com")
    source = Borrower(library_id=lib.id, name="Source")
    target = Borrower(library_id=lib.id, name="Target")
    test_session.add_all([source, target])

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
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=viewer_headers,
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_merge_requires_authentication() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            f"/api/v1/borrowers/{uuid.uuid4()}/merge",
            json={"source_id": str(uuid.uuid4())},
        )
    assert resp.status_code == 401
