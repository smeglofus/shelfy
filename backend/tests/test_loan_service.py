from collections.abc import AsyncIterator
from datetime import date
import os
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.book import Book
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.loan import Loan
from app.models.user import User
from app.schemas.loan import LoanCreate, LoanReturn
from app.services.loan_service import create_loan, delete_loan, list_loans, return_loan


def _require_test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_loan_service.db")


@pytest.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
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

    yield async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


async def _create_user(session: AsyncSession, email: str = "u@example.com") -> User:
    user = User(email=email, hashed_password="x")
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _create_library(session: AsyncSession, user: User) -> Library:
    lib = Library(name=f"{user.email} Library", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return lib


async def _create_book(session: AsyncSession, library_id: uuid.UUID, title: str = "Loan Service") -> Book:
    book = Book(library_id=library_id, title=title)
    session.add(book)
    await session.commit()
    await session.refresh(book)
    return book


@pytest.mark.asyncio
async def test_loan_service_happy_path(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        user = await _create_user(session)
        library = await _create_library(session, user)
        book = await _create_book(session, library.id)

        loan = await create_loan(session, book.id, LoanCreate(borrower_name="Alice"), library.id)
        loans = await list_loans(session, book.id, library.id)
        returned = await return_loan(
            session,
            book.id,
            loan.id,
            LoanReturn(returned_date=date.today(), return_condition="good", notes="ok"),
            library.id,
        )
        await delete_loan(session, book.id, loan.id, library.id)

        assert len(loans) == 1
        assert returned.return_condition == "good"
        assert await session.get(Loan, loan.id) is None


@pytest.mark.asyncio
async def test_loan_service_conflicts_and_not_found(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        user1 = await _create_user(session, "user1@example.com")
        user2 = await _create_user(session, "user2@example.com")
        lib1 = await _create_library(session, user1)
        lib2 = await _create_library(session, user2)

        book = await _create_book(session, lib1.id, title="Book A")
        other_book = await _create_book(session, lib1.id, title="Book B")
        foreign_book = await _create_book(session, lib2.id, title="Foreign")

        first = await create_loan(session, book.id, LoanCreate(borrower_name="Alice"), lib1.id)

        # non-existent book → 404
        with pytest.raises(Exception):
            await create_loan(session, uuid.uuid4(), LoanCreate(borrower_name="Ghost"), lib1.id)

        # already lent → 409
        with pytest.raises(Exception):
            await create_loan(session, book.id, LoanCreate(borrower_name="Bob"), lib1.id)

        # return loan on wrong book → 404
        with pytest.raises(Exception):
            await return_loan(session, other_book.id, first.id, LoanReturn(return_condition="fair"), lib1.id)

        # book in foreign library → 404
        with pytest.raises(Exception):
            await create_loan(session, foreign_book.id, LoanCreate(borrower_name="Blocked"), lib1.id)

        await return_loan(session, book.id, first.id, LoanReturn(return_condition="perfect"), lib1.id)

        # already returned → 409
        with pytest.raises(Exception):
            await return_loan(session, book.id, first.id, LoanReturn(return_condition="fair"), lib1.id)

        # delete loan on wrong book → 404
        with pytest.raises(Exception):
            await delete_loan(session, other_book.id, first.id, lib1.id)

        # delete non-existent loan → 404
        with pytest.raises(Exception):
            await delete_loan(session, book.id, uuid.uuid4(), lib1.id)
