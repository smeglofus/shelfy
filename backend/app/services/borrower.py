import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.borrower import Borrower
from app.models.loan import Loan
from app.schemas.borrower import BorrowerCreate, BorrowerUpdate

logger = structlog.get_logger()


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
