import uuid
from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.book import Book
from app.models.borrower import Borrower
from app.models.loan import Loan
from app.schemas.borrower import BorrowerCreate, BorrowerUpdate

logger = structlog.get_logger()


@dataclass(frozen=True)
class BorrowerWithStats:
    borrower: Borrower
    active_loans: int
    total_loans: int
    last_activity_at: date | None


@dataclass(frozen=True)
class BorrowerLoanRow:
    id: uuid.UUID
    book_id: uuid.UUID
    book_title: str
    book_author: str | None
    lent_date: date
    due_date: date | None
    returned_date: date | None
    return_condition: str | None
    notes: str | None


def _normalize_name(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(value.split())


def _normalize_contact(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = " ".join(value.split())
    return collapsed or None


async def list_borrowers(session: AsyncSession, library_id: uuid.UUID) -> list[Borrower]:
    result = await session.execute(
        select(Borrower)
        .where(Borrower.library_id == library_id)
        .order_by(Borrower.name)
    )
    return list(result.scalars().all())


async def list_borrowers_with_stats(
    session: AsyncSession, library_id: uuid.UUID
) -> list[BorrowerWithStats]:
    """List a library's borrowers with aggregated lending stats."""
    active_count = func.count(Loan.id).filter(Loan.returned_date.is_(None))
    total_count = func.count(Loan.id)

    # The library-id check on Loan is defensive: in normal operation a loan's
    # library_id always matches its borrower's, but pinning it here prevents a
    # malformed cross-library row from being counted into stats.
    stmt = (
        select(
            Borrower,
            active_count.label("active_loans"),
            total_count.label("total_loans"),
            func.max(Loan.lent_date).label("last_activity_at"),
        )
        .outerjoin(
            Loan,
            and_(Loan.borrower_id == Borrower.id, Loan.library_id == library_id),
        )
        .where(Borrower.library_id == library_id)
        .group_by(Borrower.id)
        .order_by(Borrower.name)
    )
    result = await session.execute(stmt)
    return [
        BorrowerWithStats(
            borrower=row[0],
            active_loans=int(row[1] or 0),
            total_loans=int(row[2] or 0),
            last_activity_at=row[3],
        )
        for row in result.all()
    ]


async def list_loans_for_borrower(
    session: AsyncSession, borrower_id: uuid.UUID, library_id: uuid.UUID
) -> list[BorrowerLoanRow]:
    """List a borrower's loans with denormalized book metadata.

    Active loans (no returned_date) come first, then returned loans by most
    recent return. Within each group, lent_date desc.
    """
    await get_borrower_or_404(session, borrower_id, library_id)

    stmt = (
        select(
            Loan.id,
            Loan.book_id,
            Book.title,
            Book.author,
            Loan.lent_date,
            Loan.due_date,
            Loan.returned_date,
            Loan.return_condition,
            Loan.notes,
        )
        .join(Book, Book.id == Loan.book_id)
        .where(Loan.borrower_id == borrower_id, Loan.library_id == library_id)
        .order_by(
            Loan.returned_date.is_(None).desc(),
            Loan.returned_date.desc().nullslast(),
            Loan.lent_date.desc(),
            Loan.id.desc(),
        )
    )
    result = await session.execute(stmt)
    return [
        BorrowerLoanRow(
            id=row[0],
            book_id=row[1],
            book_title=row[2],
            book_author=row[3],
            lent_date=row[4],
            due_date=row[5],
            returned_date=row[6],
            return_condition=row[7],
            notes=row[8],
        )
        for row in result.all()
    ]


async def create_borrower(
    session: AsyncSession, payload: BorrowerCreate, library_id: uuid.UUID
) -> Borrower:
    borrower = Borrower(
        library_id=library_id,
        name=payload.name,
        contact=payload.contact,
        notes=payload.notes,
    )
    session.add(borrower)
    await session.commit()
    await session.refresh(borrower)
    logger.info("borrower_created", borrower_id=str(borrower.id), library_id=str(library_id))
    return borrower


async def get_borrower_or_404(
    session: AsyncSession, borrower_id: uuid.UUID, library_id: uuid.UUID
) -> Borrower:
    result = await session.execute(
        select(Borrower).where(Borrower.id == borrower_id, Borrower.library_id == library_id)
    )
    borrower = result.scalar_one_or_none()
    if borrower is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found")
    return borrower


async def update_borrower(
    session: AsyncSession,
    borrower_id: uuid.UUID,
    payload: BorrowerUpdate,
    library_id: uuid.UUID,
) -> Borrower:
    borrower = await get_borrower_or_404(session, borrower_id, library_id)
    update_data = payload.model_dump(exclude_unset=True)
    for field_name, value in update_data.items():
        setattr(borrower, field_name, value)
    await session.commit()
    await session.refresh(borrower)
    logger.info("borrower_updated", borrower_id=str(borrower.id), fields=list(update_data.keys()))
    return borrower


async def link_loans_to_borrowers(session: AsyncSession, library_id: uuid.UUID) -> int:
    """Link a library's existing loans to Borrower records.

    Idempotent: loans that already have ``borrower_id`` set are skipped.
    Loans whose ``borrower_name`` is blank after whitespace normalization are
    also skipped. Within the library, loans matching the same normalized
    ``(name, contact)`` reuse a single Borrower; otherwise a new Borrower is
    created. Borrowers are never shared across libraries.

    Returns the number of loans linked in this call.
    """
    existing = (
        await session.execute(select(Borrower).where(Borrower.library_id == library_id))
    ).scalars().all()
    bucket: dict[tuple[str, str | None], Borrower] = {
        (_normalize_name(b.name), _normalize_contact(b.contact)): b for b in existing
    }

    loans = (
        await session.execute(
            select(Loan).where(Loan.library_id == library_id, Loan.borrower_id.is_(None))
        )
    ).scalars().all()

    linked = 0
    for loan in loans:
        normalized_name = _normalize_name(loan.borrower_name)
        if not normalized_name:
            continue
        normalized_contact = _normalize_contact(loan.borrower_contact)
        key = (normalized_name, normalized_contact)

        borrower = bucket.get(key)
        if borrower is None:
            borrower = Borrower(
                library_id=library_id,
                name=normalized_name,
                contact=normalized_contact,
            )
            session.add(borrower)
            await session.flush()
            bucket[key] = borrower

        loan.borrower_id = borrower.id
        linked += 1

    if linked:
        await session.commit()
        logger.info(
            "loans_linked_to_borrowers",
            library_id=str(library_id),
            linked=linked,
            borrowers_total=len(bucket),
        )
    return linked
