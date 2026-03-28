from collections.abc import AsyncIterator
from datetime import date
import os
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.book import Book
from app.models.loan import Loan
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
                "manual",
                "pending",
                "done",
                "failed",
                "partial",
                name="book_processing_status",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "unread",
                "reading",
                "read",
                name="reading_status",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)

    yield async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


async def _create_book(session: AsyncSession, title: str = "Loan Service") -> Book:
    book = Book(title=title)
    session.add(book)
    await session.commit()
    await session.refresh(book)
    return book


@pytest.mark.asyncio
async def test_loan_service_happy_path(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        book = await _create_book(session)

        loan = await create_loan(session, book.id, LoanCreate(borrower_name="Alice"))
        loans = await list_loans(session, book.id)
        returned = await return_loan(
            session,
            book.id,
            loan.id,
            LoanReturn(returned_date=date.today(), return_condition="good", notes="ok"),
        )
        await delete_loan(session, book.id, loan.id)

        assert len(loans) == 1
        assert returned.return_condition == "good"
        assert await session.get(Loan, loan.id) is None


@pytest.mark.asyncio
async def test_loan_service_conflicts_and_not_found(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        book = await _create_book(session, title="Book A")
        other_book = await _create_book(session, title="Book B")

        first = await create_loan(session, book.id, LoanCreate(borrower_name="Alice"))

        with pytest.raises(Exception):
            await create_loan(session, uuid.uuid4(), LoanCreate(borrower_name="Ghost"))

        with pytest.raises(Exception):
            await create_loan(session, book.id, LoanCreate(borrower_name="Bob"))

        with pytest.raises(Exception):
            await return_loan(session, other_book.id, first.id, LoanReturn(return_condition="fair"))

        await return_loan(session, book.id, first.id, LoanReturn(return_condition="perfect"))

        with pytest.raises(Exception):
            await return_loan(session, book.id, first.id, LoanReturn(return_condition="fair"))

        with pytest.raises(Exception):
            await delete_loan(session, other_book.id, first.id)

        with pytest.raises(Exception):
            await delete_loan(session, book.id, uuid.uuid4())
