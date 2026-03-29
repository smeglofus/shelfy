from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.book import Book, BookProcessingStatus, ReadingStatus
from app.models.location import Location
from app.schemas.scan import ShelfScanConfirmRequest

logger = structlog.get_logger()


async def confirm_shelf_scan(
    session: AsyncSession,
    payload: ShelfScanConfirmRequest,
) -> list[uuid.UUID]:
    """Create books from confirmed shelf scan results, assigning positions."""
    # Validate location exists
    loc = (await session.execute(
        select(Location).where(Location.id == payload.location_id)
    )).scalar_one_or_none()
    if loc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")

    book_ids: list[uuid.UUID] = []

    for item in payload.books:
        # Check if book with same ISBN already exists
        existing: Book | None = None
        if item.isbn:
            existing = (await session.execute(
                select(Book).where(Book.isbn == item.isbn)
            )).scalar_one_or_none()

        if existing is not None:
            # Update location and position of existing book
            existing.location_id = payload.location_id
            existing.shelf_position = item.position
            book_ids.append(existing.id)
            logger.info("shelf_scan_book_updated", book_id=str(existing.id), position=item.position)
        else:
            book = Book(
                title=item.title,
                author=item.author,
                isbn=item.isbn if item.isbn else None,
                location_id=payload.location_id,
                shelf_position=item.position,
                reading_status=ReadingStatus.UNREAD,
                processing_status=BookProcessingStatus.PARTIAL,
            )
            session.add(book)
            try:
                await session.flush()
            except IntegrityError:
                await session.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Duplicate ISBN: {item.isbn}",
                )
            book_ids.append(book.id)
            logger.info("shelf_scan_book_created", book_id=str(book.id), title=item.title, position=item.position)

    await session.commit()
    logger.info("shelf_scan_confirmed", location_id=str(payload.location_id), books_count=len(book_ids))
    return book_ids
