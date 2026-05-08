"""Tests for the loan -> borrower backfill helper."""
from collections.abc import AsyncIterator
from datetime import date
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import get_password_hash
from app.db.base import Base
from app.models.book import Book
from app.models.borrower import Borrower
from app.models.library import Library
from app.models.loan import Loan
from app.models.user import User
from app.schemas.borrower import BorrowerCreate
from app.services.borrower import create_borrower, link_loans_to_borrowers


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


# These tests are service-level (they call ``link_loans_to_borrowers`` directly,
# bypassing the API). They previously fabricated ``library_id``/``book_id`` as
# bare ``uuid.uuid4()`` values and relied on SQLite not enforcing FKs. Since
# conftest.py turns FK enforcement on, every Loan needs a real Library +
# real Book row to attach to.
_SEED_USER_COUNTER = 0


async def _seed_library(session: AsyncSession) -> uuid.UUID:
    """Seed a Library row (with a fresh creator user) and return its id."""
    global _SEED_USER_COUNTER
    _SEED_USER_COUNTER += 1
    user = User(
        email=f"link-test-{_SEED_USER_COUNTER}@example.com",
        hashed_password=get_password_hash("x"),
    )
    session.add(user)
    await session.flush()
    lib = Library(name=f"Link test lib {_SEED_USER_COUNTER}", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    return lib.id


async def _seed_book(session: AsyncSession, library_id: uuid.UUID) -> uuid.UUID:
    book = Book(library_id=library_id, title="Book")
    session.add(book)
    await session.flush()
    return book.id


def _make_loan(
    library_id: uuid.UUID,
    book_id: uuid.UUID,
    *,
    borrower_name: str,
    borrower_contact: str | None = None,
    borrower_id: uuid.UUID | None = None,
) -> Loan:
    return Loan(
        library_id=library_id,
        book_id=book_id,
        borrower_id=borrower_id,
        borrower_name=borrower_name,
        borrower_contact=borrower_contact,
        lent_date=date.today(),
    )


async def _all_borrowers(session: AsyncSession, library_id: uuid.UUID) -> list[Borrower]:
    result = await session.execute(
        select(Borrower).where(Borrower.library_id == library_id)
    )
    return list(result.scalars().all())


@pytest.mark.asyncio
async def test_links_two_loans_with_same_name_and_contact_to_one_borrower(
    session: AsyncSession,
) -> None:
    lib_id = await _seed_library(session)
    book_id = await _seed_book(session, lib_id)
    session.add(_make_loan(lib_id, book_id, borrower_name="Alice", borrower_contact="alice@x.com"))
    session.add(_make_loan(lib_id, book_id, borrower_name="Alice", borrower_contact="alice@x.com"))
    await session.commit()

    linked = await link_loans_to_borrowers(session, lib_id)

    borrowers = await _all_borrowers(session, lib_id)
    assert linked == 2
    assert len(borrowers) == 1

    loans = (await session.execute(select(Loan).where(Loan.library_id == lib_id))).scalars().all()
    assert {loan.borrower_id for loan in loans} == {borrowers[0].id}


@pytest.mark.asyncio
async def test_same_name_in_two_libraries_creates_separate_borrowers(
    session: AsyncSession,
) -> None:
    lib_a = await _seed_library(session)
    book_a = await _seed_book(session, lib_a)
    lib_b = await _seed_library(session)
    book_b = await _seed_book(session, lib_b)
    session.add(_make_loan(lib_a, book_a, borrower_name="Alice"))
    session.add(_make_loan(lib_b, book_b, borrower_name="Alice"))
    await session.commit()

    await link_loans_to_borrowers(session, lib_a)
    await link_loans_to_borrowers(session, lib_b)

    borrowers_a = await _all_borrowers(session, lib_a)
    borrowers_b = await _all_borrowers(session, lib_b)
    assert len(borrowers_a) == 1
    assert len(borrowers_b) == 1
    assert borrowers_a[0].id != borrowers_b[0].id


@pytest.mark.asyncio
async def test_existing_borrower_id_is_not_overwritten(session: AsyncSession) -> None:
    lib_id = await _seed_library(session)
    book_id = await _seed_book(session, lib_id)
    pinned = await create_borrower(
        session, BorrowerCreate(name="Pre-existing", contact="pre@x.com"), lib_id
    )
    # Loan that *looks* the same as the pinned borrower but already has a
    # different borrower_id set; we must not touch it.
    other_id = (
        await create_borrower(session, BorrowerCreate(name="Other"), lib_id)
    ).id
    session.add(
        _make_loan(
            lib_id,
            book_id,
            borrower_name="Pre-existing",
            borrower_contact="pre@x.com",
            borrower_id=other_id,
        )
    )
    await session.commit()

    linked = await link_loans_to_borrowers(session, lib_id)

    assert linked == 0
    loan = (
        await session.execute(select(Loan).where(Loan.library_id == lib_id))
    ).scalar_one()
    assert loan.borrower_id == other_id
    assert pinned.id != other_id


@pytest.mark.asyncio
async def test_null_or_empty_contact_is_handled(session: AsyncSession) -> None:
    lib_id = await _seed_library(session)
    book_id = await _seed_book(session, lib_id)
    session.add(_make_loan(lib_id, book_id, borrower_name="Bob", borrower_contact=None))
    session.add(_make_loan(lib_id, book_id, borrower_name="Bob", borrower_contact=""))
    session.add(_make_loan(lib_id, book_id, borrower_name="Bob", borrower_contact="   "))
    await session.commit()

    await link_loans_to_borrowers(session, lib_id)

    borrowers = await _all_borrowers(session, lib_id)
    # All three loans normalize to the same (Bob, None) key.
    assert len(borrowers) == 1
    assert borrowers[0].contact is None


@pytest.mark.asyncio
async def test_extra_whitespace_in_borrower_name_does_not_crash(
    session: AsyncSession,
) -> None:
    lib_id = await _seed_library(session)
    book_id = await _seed_book(session, lib_id)
    session.add(_make_loan(lib_id, book_id, borrower_name="  Alice  Smith  "))
    session.add(_make_loan(lib_id, book_id, borrower_name="Alice Smith"))
    await session.commit()

    await link_loans_to_borrowers(session, lib_id)

    borrowers = await _all_borrowers(session, lib_id)
    assert len(borrowers) == 1
    assert borrowers[0].name == "Alice Smith"


@pytest.mark.asyncio
async def test_blank_borrower_name_is_skipped(session: AsyncSession) -> None:
    lib_id = await _seed_library(session)
    book_id = await _seed_book(session, lib_id)
    session.add(_make_loan(lib_id, book_id, borrower_name="   "))
    session.add(_make_loan(lib_id, book_id, borrower_name="Real Person"))
    await session.commit()

    linked = await link_loans_to_borrowers(session, lib_id)

    assert linked == 1
    borrowers = await _all_borrowers(session, lib_id)
    assert [b.name for b in borrowers] == ["Real Person"]


@pytest.mark.asyncio
async def test_helper_is_idempotent(session: AsyncSession) -> None:
    lib_id = await _seed_library(session)
    book_id = await _seed_book(session, lib_id)
    session.add(_make_loan(lib_id, book_id, borrower_name="Alice"))
    session.add(_make_loan(lib_id, book_id, borrower_name="Bob", borrower_contact="bob@x.com"))
    await session.commit()

    first = await link_loans_to_borrowers(session, lib_id)
    second = await link_loans_to_borrowers(session, lib_id)

    assert first == 2
    assert second == 0
    borrowers = await _all_borrowers(session, lib_id)
    assert len(borrowers) == 2


@pytest.mark.asyncio
async def test_reuses_borrower_created_via_create_borrower(session: AsyncSession) -> None:
    """A pre-existing Borrower record should not be duplicated by the linker."""
    lib_id = await _seed_library(session)
    book_id = await _seed_book(session, lib_id)
    existing = await create_borrower(
        session, BorrowerCreate(name="Alice", contact="alice@x.com"), lib_id
    )
    session.add(_make_loan(lib_id, book_id, borrower_name="Alice", borrower_contact="alice@x.com"))
    await session.commit()

    await link_loans_to_borrowers(session, lib_id)

    borrowers = await _all_borrowers(session, lib_id)
    assert len(borrowers) == 1
    loan = (
        await session.execute(select(Loan).where(Loan.library_id == lib_id))
    ).scalar_one()
    assert loan.borrower_id == existing.id
