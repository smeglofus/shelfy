from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select, update
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
    library_id: uuid.UUID,
) -> list[uuid.UUID]:
    """Create books from confirmed shelf scan results, assigning positions.
    Location must belong to the current library.
    """
    # Validate location exists AND belongs to library
    loc = (await session.execute(
        select(Location).where(
            Location.id == payload.location_id,
            Location.library_id == library_id,
        )
    )).scalar_one_or_none()
    if loc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")

    book_ids: list[uuid.UUID] = []

    position_offset = 0
    if payload.append_after_book_id is not None:
        # Anchor book must also belong to this library
        anchor = (await session.execute(
            select(Book).where(
                Book.id == payload.append_after_book_id,
                Book.library_id == library_id,
            )
        )).scalar_one_or_none()
        if anchor is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anchor book not found")
        if anchor.location_id != payload.location_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Anchor book is not in selected location")

        position_offset = (anchor.shelf_position or 0) + 1
        shift_by = len(payload.books)
        await session.execute(
            update(Book)
            .where(
                Book.library_id == library_id,
                Book.location_id == payload.location_id,
                Book.shelf_position.is_not(None),
                Book.shelf_position >= position_offset,
                Book.id != anchor.id,
            )
            .values(shelf_position=Book.shelf_position + shift_by)
        )

    for item in payload.books:
        target_position = item.position + position_offset
        # Check if book with same ISBN already exists in this library
        existing: Book | None = None
        if item.isbn:
            existing = (await session.execute(
                select(Book).where(
                    Book.isbn == item.isbn,
                    Book.library_id == library_id,
                )
            )).scalar_one_or_none()

        if existing is not None:
            existing.location_id = payload.location_id
            existing.shelf_position = target_position
            book_ids.append(existing.id)
            logger.info("shelf_scan_book_updated", book_id=str(existing.id), position=target_position)
        else:
            book = Book(
                library_id=library_id,
                title=item.title,
                author=item.author,
                isbn=item.isbn if item.isbn else None,
                location_id=payload.location_id,
                shelf_position=target_position,
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
            logger.info("shelf_scan_book_created", book_id=str(book.id), title=item.title, position=target_position)

    await session.commit()
    logger.info("shelf_scan_confirmed", location_id=str(payload.location_id), books_count=len(book_ids), library_id=str(library_id))
    return book_ids
