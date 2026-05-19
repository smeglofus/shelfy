"""Read-only borrower queries: list / get / detail.

Module split out of ``services/borrower.py`` (#244 follow-up) so the
file stops growing as features land. No business mutations live here —
that's :mod:`lifecycle`, :mod:`anonymize`, and :mod:`merge`.
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.book import Book
from app.models.borrower import Borrower
from app.models.loan import Loan
from app.services.borrower._common import (
    BorrowerLoanRow,
    BorrowerStatsPage,
    BorrowerWithStats,
)

BorrowerStatusFilter = Literal["all", "active", "pending"]


async def list_borrowers(session: AsyncSession, library_id: uuid.UUID) -> list[Borrower]:
    result = await session.execute(
        select(Borrower)
        .where(Borrower.library_id == library_id)
        .order_by(Borrower.name)
    )
    return list(result.scalars().all())


async def list_borrowers_with_stats(
    session: AsyncSession,
    library_id: uuid.UUID,
    *,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
    status: BorrowerStatusFilter = "all",
) -> BorrowerStatsPage:
    """List a library's borrowers with aggregated lending stats, paginated.

    ``search`` is a case-insensitive substring match on the borrower name.
    The match runs on the *stored* name; for anonymized rows that means
    matching against the sentinel ("Deleted borrower"). Localized labels
    are a frontend concern (see ``displayBorrowerName``).

    ``status`` filters by lifecycle state (#244):

    - ``"all"`` (default): no filter — preserves the legacy contract.
    - ``"active"``: rows that are neither anonymized nor pending — the
      day-to-day working set.
    - ``"pending"``: rows scheduled for anonymization but still
      restorable. Powers the "Recently anonymized" discovery view in the
      UI; without it a librarian could only restore via a known URL.
    """
    active_count = func.count(Loan.id).filter(Loan.returned_date.is_(None))
    total_count = func.count(Loan.id)

    where_clauses = [Borrower.library_id == library_id]
    if search:
        # ``ilike`` keeps the search case-insensitive on Postgres; SQLite's
        # default LIKE is already case-insensitive for ASCII so this is fine
        # for tests too.
        where_clauses.append(Borrower.name.ilike(f"%{search}%"))
    if status == "active":
        where_clauses.append(Borrower.anonymized_at.is_(None))
        where_clauses.append(Borrower.pending_anonymization_until.is_(None))
    elif status == "pending":
        where_clauses.append(Borrower.anonymized_at.is_(None))
        where_clauses.append(Borrower.pending_anonymization_until.is_not(None))

    # Count BEFORE applying limit/offset so the paginator knows the true
    # total. Cheap because there are no joins on the count query.
    total_stmt = select(func.count()).select_from(Borrower).where(*where_clauses)
    total = int((await session.execute(total_stmt)).scalar_one())

    # The library-id check on Loan is defensive: in normal operation a loan's
    # library_id always matches its borrower's, but pinning it here prevents a
    # malformed cross-library row from being counted into stats.
    page_stmt = (
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
        .where(*where_clauses)
        .group_by(Borrower.id)
        .order_by(Borrower.name)
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    result = await session.execute(page_stmt)
    items = [
        BorrowerWithStats(
            borrower=row[0],
            active_loans=int(row[1] or 0),
            total_loans=int(row[2] or 0),
            last_activity_at=row[3],
        )
        for row in result.all()
    ]
    return BorrowerStatsPage(items=items, total=total, page=page, page_size=page_size)


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


async def get_borrower_detail_or_404(
    session: AsyncSession, borrower_id: uuid.UUID, library_id: uuid.UUID
) -> Borrower:
    """Fetch a borrower with audit-trail user relationships eager-loaded (#261).

    Same 404 semantics as :func:`get_borrower_or_404` but the returned row
    has ``.created_by``, ``.anonymized_by`` and ``.merged_into_by`` populated
    so the detail endpoint can render audit actor emails without a second
    round-trip. Three LEFT JOINs at read time — acceptable on a single-row
    fetch, deliberately not paid by the list endpoint.
    """
    result = await session.execute(
        select(Borrower)
        .where(Borrower.id == borrower_id, Borrower.library_id == library_id)
        .options(
            selectinload(Borrower.created_by),
            selectinload(Borrower.anonymized_by),
            selectinload(Borrower.merged_into_by),
        )
    )
    borrower = result.scalar_one_or_none()
    if borrower is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found")
    return borrower
