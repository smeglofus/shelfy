"""Tests for the retention-driven bulk anonymize endpoint (#246).

``POST /api/v1/borrowers/bulk-anonymize-by-date`` body
``{ inactive_since, dry_run? }`` selects every borrower in the active
library whose most recent ``lent_date`` is strictly before
``inactive_since`` AND who has no active loan, then anonymizes them.
``dry_run=true`` returns the count without mutating.
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


async def _seed_owner_with_library(
    session: AsyncSession, email: str = "owner@example.com"
) -> tuple[User, Library]:
    user = User(email=email, hashed_password=get_password_hash("secret"))
    session.add(user)
    await session.flush()
    lib = Library(name=f"Library of {email}", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return user, lib


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    resp = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "secret"}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _book(library_id: uuid.UUID, title: str = "B") -> Book:
    return Book(library_id=library_id, title=title)


def _loan(
    *,
    library_id: uuid.UUID,
    book_id: uuid.UUID,
    borrower_id: uuid.UUID,
    borrower_name: str,
    lent_date: date,
    returned_date: date | None = None,
) -> Loan:
    return Loan(
        library_id=library_id,
        book_id=book_id,
        borrower_id=borrower_id,
        borrower_name=borrower_name,
        lent_date=lent_date,
        returned_date=returned_date,
        return_condition="good" if returned_date else None,
    )


# ── Selection rules ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dry_run_counts_eligible_borrowers_without_mutating(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    cutoff = date.today() - timedelta(days=365)

    # Eligible: no loans at all, never lent to.
    test_session.add(Borrower(library_id=lib.id, name="Standalone old"))
    # Eligible: last loan ended way before the cutoff and is returned.
    eligible_returned = Borrower(library_id=lib.id, name="Returned long ago")
    test_session.add(eligible_returned)
    await test_session.flush()
    book = _book(lib.id)
    test_session.add(book)
    await test_session.flush()
    test_session.add(_loan(
        library_id=lib.id, book_id=book.id, borrower_id=eligible_returned.id,
        borrower_name="Returned long ago",
        lent_date=cutoff - timedelta(days=400),
        returned_date=cutoff - timedelta(days=380),
    ))
    # NOT eligible: lent to recently (within the cutoff window).
    recent = Borrower(library_id=lib.id, name="Lent recently")
    test_session.add(recent)
    await test_session.flush()
    test_session.add(_loan(
        library_id=lib.id, book_id=book.id, borrower_id=recent.id,
        borrower_name="Lent recently",
        lent_date=cutoff + timedelta(days=10),
        returned_date=cutoff + timedelta(days=20),
    ))
    # NOT eligible: has an active loan (returned_date IS NULL).
    has_active = Borrower(library_id=lib.id, name="Still has book")
    test_session.add(has_active)
    await test_session.flush()
    test_session.add(_loan(
        library_id=lib.id, book_id=book.id, borrower_id=has_active.id,
        borrower_name="Still has book",
        lent_date=cutoff - timedelta(days=10),
    ))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": cutoff.isoformat(), "dry_run": True},
            headers=headers,
        )

    assert resp.status_code == 200
    assert resp.json() == {"affected": 2}

    # Nothing actually anonymized.
    everyone = (await test_session.execute(select(Borrower))).scalars().all()
    assert all(b.anonymized_at is None for b in everyone)


@pytest.mark.asyncio
async def test_real_run_anonymizes_only_eligible_rows(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    cutoff = date.today() - timedelta(days=180)

    standalone = Borrower(library_id=lib.id, name="Standalone")
    returned_old = Borrower(library_id=lib.id, name="Returned long ago")
    recent = Borrower(library_id=lib.id, name="Lent recently")
    has_active = Borrower(library_id=lib.id, name="Still has book")
    test_session.add_all([standalone, returned_old, recent, has_active])
    await test_session.flush()
    book = _book(lib.id)
    test_session.add(book)
    await test_session.flush()

    # returned_old: loan well before cutoff
    test_session.add(_loan(
        library_id=lib.id, book_id=book.id, borrower_id=returned_old.id,
        borrower_name="Returned long ago",
        lent_date=cutoff - timedelta(days=200),
        returned_date=cutoff - timedelta(days=190),
    ))
    # recent: loan within cutoff window
    test_session.add(_loan(
        library_id=lib.id, book_id=book.id, borrower_id=recent.id,
        borrower_name="Lent recently",
        lent_date=cutoff + timedelta(days=1),
        returned_date=cutoff + timedelta(days=10),
    ))
    # has_active: open loan
    test_session.add(_loan(
        library_id=lib.id, book_id=book.id, borrower_id=has_active.id,
        borrower_name="Still has book",
        lent_date=cutoff - timedelta(days=50),
    ))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": cutoff.isoformat()},
            headers=headers,
        )

    assert resp.status_code == 200
    assert resp.json() == {"affected": 2}

    refreshed = {
        row.id: row
        for row in (await test_session.execute(select(Borrower))).scalars().all()
    }
    assert refreshed[standalone.id].anonymized_at is not None
    assert refreshed[returned_old.id].anonymized_at is not None
    # Untouched.
    assert refreshed[recent.id].anonymized_at is None
    assert refreshed[has_active.id].anonymized_at is None


@pytest.mark.asyncio
async def test_idempotent_re_run_returns_zero(test_session: AsyncSession) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    cutoff = date.today()
    test_session.add(Borrower(library_id=lib.id, name="Lonely"))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        first = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": cutoff.isoformat()},
            headers=headers,
        )
        second = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": cutoff.isoformat()},
            headers=headers,
        )

    assert first.json() == {"affected": 1}
    assert second.json() == {"affected": 0}


@pytest.mark.asyncio
async def test_does_not_touch_other_libraries(test_session: AsyncSession) -> None:
    _, own_lib = await _seed_owner_with_library(test_session, "own@example.com")
    _, foreign_lib = await _seed_owner_with_library(test_session, "foreign@example.com")

    own = Borrower(library_id=own_lib.id, name="Mine")
    other = Borrower(library_id=foreign_lib.id, name="Theirs")
    test_session.add_all([own, other])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "own@example.com")
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": date.today().isoformat()},
            headers=headers,
        )

    assert resp.status_code == 200
    assert resp.json() == {"affected": 1}

    refreshed = {
        row.id: row
        for row in (await test_session.execute(select(Borrower))).scalars().all()
    }
    assert refreshed[own.id].anonymized_at is not None
    assert refreshed[other.id].anonymized_at is None


@pytest.mark.asyncio
async def test_requires_editor_role(test_session: AsyncSession) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    # Add a viewer to that library.
    viewer = User(email="viewer@example.com", hashed_password=get_password_hash("secret"))
    test_session.add(viewer)
    await test_session.flush()
    test_session.add(LibraryMember(library_id=lib.id, user_id=viewer.id, role=LibraryRole.VIEWER))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "viewer@example.com")
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": date.today().isoformat()},
            headers=headers,
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_requires_authentication() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": date.today().isoformat()},
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_dry_run_returns_zero_when_no_eligible_borrowers(
    test_session: AsyncSession,
) -> None:
    """Dry-run with no eligible borrowers must return affected=0 — covers
    the short-circuit branch in ``bulk_anonymize_borrowers_by_inactivity``
    where ``candidate_ids`` is empty and we skip the call into the
    explicit-list primitive."""
    _, lib = await _seed_owner_with_library(test_session)
    cutoff = date.today() - timedelta(days=365)

    # Seed a borrower with an active loan — never eligible for retention.
    borrower = Borrower(library_id=lib.id, name="Has open loan")
    test_session.add(borrower)
    await test_session.flush()
    book = _book(lib.id)
    test_session.add(book)
    await test_session.flush()
    test_session.add(_loan(
        library_id=lib.id, book_id=book.id, borrower_id=borrower.id,
        borrower_name="Has open loan",
        lent_date=cutoff - timedelta(days=10),
    ))
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": cutoff.isoformat(), "dry_run": True},
            headers=headers,
        )

    assert resp.status_code == 200
    assert resp.json() == {"affected": 0}


@pytest.mark.asyncio
async def test_bulk_anonymize_empty_id_list_is_a_no_op(test_session: AsyncSession) -> None:
    """Service-level: ``bulk_anonymize_borrowers`` short-circuits cleanly when
    given an empty id list. Previously only tested via the API which always
    sends ≥1 id (the request schema rejects empty), so this branch had no
    direct coverage."""
    from app.services.borrower import bulk_anonymize_borrowers

    _, lib = await _seed_owner_with_library(test_session)
    affected = await bulk_anonymize_borrowers(test_session, [], lib.id)
    assert affected == 0


@pytest.mark.asyncio
async def test_select_retention_candidates_treats_cutoff_as_strict(
    test_session: AsyncSession,
) -> None:
    """``inactive_since`` is the open lower bound — a loan whose ``lent_date``
    is exactly at the cutoff counts as "recent activity", so the borrower
    stays ineligible."""
    from app.services.borrower import select_borrowers_for_retention_anonymize

    _, lib = await _seed_owner_with_library(test_session)
    cutoff = date.today() - timedelta(days=100)

    borrower_at_cutoff = Borrower(library_id=lib.id, name="At cutoff")
    borrower_before = Borrower(library_id=lib.id, name="Before cutoff")
    test_session.add_all([borrower_at_cutoff, borrower_before])
    await test_session.flush()
    book = _book(lib.id)
    test_session.add(book)
    await test_session.flush()
    # Loan exactly on the cutoff date → recent → NOT eligible
    test_session.add(_loan(
        library_id=lib.id, book_id=book.id, borrower_id=borrower_at_cutoff.id,
        borrower_name="At cutoff",
        lent_date=cutoff,
        returned_date=cutoff + timedelta(days=1),
    ))
    # Loan strictly before → eligible
    test_session.add(_loan(
        library_id=lib.id, book_id=book.id, borrower_id=borrower_before.id,
        borrower_name="Before cutoff",
        lent_date=cutoff - timedelta(days=1),
        returned_date=cutoff,
    ))
    await test_session.commit()

    ids = await select_borrowers_for_retention_anonymize(test_session, lib.id, cutoff)
    assert borrower_before.id in ids
    assert borrower_at_cutoff.id not in ids


@pytest.mark.asyncio
async def test_retention_run_stamps_anonymized_by_user_id(
    test_session: AsyncSession,
) -> None:
    """Retention bulk threads the calling user's id into
    ``anonymized_by_user_id`` for every row it touches (#245 audit trail
    + #246 retention compose)."""
    owner, lib = await _seed_owner_with_library(test_session)
    cutoff = date.today() - timedelta(days=100)
    standalone = Borrower(library_id=lib.id, name="To anonymize")
    test_session.add(standalone)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": cutoff.isoformat()},
            headers=headers,
        )
    assert resp.status_code == 200
    assert resp.json() == {"affected": 1}

    refreshed = (
        await test_session.execute(select(Borrower).where(Borrower.id == standalone.id))
    ).scalar_one()
    assert refreshed.anonymized_at is not None
    assert refreshed.anonymized_by_user_id == owner.id


@pytest.mark.asyncio
async def test_real_run_with_no_eligible_borrowers_is_a_no_op(
    test_session: AsyncSession,
) -> None:
    """Real run (dry_run=false) with no eligible borrowers also short-circuits
    and returns affected=0 without touching any row."""
    _, lib = await _seed_owner_with_library(test_session)
    cutoff = date.today() - timedelta(days=365)
    # Seed an already-anonymized borrower; ``select_borrowers_for_retention``
    # filters those out, so candidate list is empty.
    pre_anon = Borrower(
        library_id=lib.id,
        name="Deleted borrower",
        anonymized_at=date.today(),
    )
    test_session.add(pre_anon)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date?immediate=true",
            json={"inactive_since": cutoff.isoformat()},
            headers=headers,
        )

    assert resp.status_code == 200
    assert resp.json() == {"affected": 0}
