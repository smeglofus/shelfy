import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.borrower import Borrower
from app.schemas.borrower import BorrowerCreate, BorrowerUpdate

logger = structlog.get_logger()


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
