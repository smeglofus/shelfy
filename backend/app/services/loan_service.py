from typing import cast
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.loan import Loan
from app.schemas.loan import LoanCreate, LoanReturn
from app.services.borrower import get_borrower_or_404

_ALLOWED_RETURN_CONDITIONS = {"perfect", "good", "fair", "damaged", "lost"}


async def create_loan(session: AsyncSession, book_id: UUID, data: LoanCreate, library_id: UUID) -> Loan:
    await _get_book_or_404(session, book_id, library_id)  # raises 404 if book absent or not in library

    active_loan = await _get_active_loan(session, book_id)
    if active_loan is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Book already has an active loan")

    borrower_id: UUID | None = None
    borrower_name: str
    borrower_contact: str | None = data.borrower_contact

    if data.borrower_id is not None:
        borrower = await get_borrower_or_404(session, data.borrower_id, library_id)
        if borrower.anonymized_at is not None:
            # The frontend filters anonymized borrowers out of the picker, but
            # the backend has to enforce this too — otherwise a hand-crafted
            # request would attach a fresh loan to a borrower whose personal
            # data the librarian explicitly chose to delete.
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Cannot lend a book to an anonymized borrower",
            )
        borrower_id = borrower.id
        borrower_name = borrower.name
        borrower_contact = borrower.contact
    else:
        # Schema validator guarantees borrower_name is set when borrower_id is None
        borrower_name = cast(str, data.borrower_name)

    loan = Loan(
        library_id=library_id,
        book_id=book_id,
        borrower_id=borrower_id,
        borrower_name=borrower_name,
        borrower_contact=borrower_contact,
        lent_date=data.lent_date,
        due_date=data.due_date,
        notes=data.notes,
    )
    session.add(loan)
    await session.commit()
    return await _reload_loan(session, loan.id)


async def list_loans(session: AsyncSession, book_id: UUID, library_id: UUID) -> list[Loan]:
    await _get_book_or_404(session, book_id, library_id)
    result = await session.execute(
        select(Loan)
        .where(Loan.book_id == book_id, Loan.library_id == library_id)
        .options(selectinload(Loan.borrower))
        .order_by(Loan.lent_date.desc(), Loan.created_at.desc(), Loan.id.desc())
    )
    return list(result.scalars().all())


async def return_loan(
    session: AsyncSession, book_id: UUID, loan_id: UUID, data: LoanReturn, library_id: UUID
) -> Loan:
    loan = await _get_loan_or_404(session, loan_id, library_id)

    if loan.book_id != book_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")

    if loan.returned_date is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Loan already returned")

    if data.return_condition not in _ALLOWED_RETURN_CONDITIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid return condition")

    loan.returned_date = data.returned_date
    loan.return_condition = data.return_condition
    loan.notes = data.notes

    await session.commit()
    return await _reload_loan(session, loan.id)


async def delete_loan(session: AsyncSession, book_id: UUID, loan_id: UUID, library_id: UUID) -> None:
    loan = await _get_loan_or_404(session, loan_id, library_id)

    if loan.book_id != book_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")

    await session.delete(loan)
    await session.commit()


async def _get_book_or_404(session: AsyncSession, book_id: UUID, library_id: UUID) -> Book:
    """Get book scoped to library — returns 404 if book doesn't exist OR doesn't belong to library."""
    book = (
        await session.execute(
            select(Book).where(Book.id == book_id, Book.library_id == library_id)
        )
    ).scalar_one_or_none()
    if book is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")
    return book


async def _get_loan_or_404(session: AsyncSession, loan_id: UUID, library_id: UUID) -> Loan:
    """Get loan scoped to library — returns 404 if loan doesn't exist OR doesn't belong to library."""
    loan = (
        await session.execute(
            select(Loan).where(Loan.id == loan_id, Loan.library_id == library_id)
        )
    ).scalar_one_or_none()
    if loan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    return loan


async def _get_active_loan(session: AsyncSession, book_id: UUID) -> Loan | None:
    return (
        await session.execute(
            select(Loan)
            .where(Loan.book_id == book_id, Loan.returned_date.is_(None))
            .order_by(Loan.lent_date.desc(), Loan.created_at.desc(), Loan.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _reload_loan(session: AsyncSession, loan_id: UUID) -> Loan:
    """Re-fetch a loan with its borrower relationship eagerly loaded."""
    result = await session.execute(
        select(Loan).where(Loan.id == loan_id).options(selectinload(Loan.borrower))
    )
    return result.scalar_one()
