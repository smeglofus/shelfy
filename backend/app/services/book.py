import csv
from io import StringIO
import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, case, delete, update
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.book import Book, ReadingStatus
from app.models.loan import Loan
from app.models.location import Location
from app.schemas.book import BookCreateRequest, BookUpdateRequest

logger = structlog.get_logger()


async def list_books(
    session: AsyncSession,
    *,
    search: str | None,
    location_id: uuid.UUID | None,
    unassigned_only: bool,
    reading_status: str | None,
    language: str | None = None,
    publisher: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
    page: int,
    page_size: int,
) -> tuple[list[Book], int]:
    filters: list[ColumnElement[bool]] = []

    if unassigned_only:
        filters.append(Book.location_id.is_(None))
    elif location_id is not None:
        filters.append(Book.location_id == location_id)

    if reading_status:
        # Fix: was incorrectly filtering on processing_status
        filters.append(Book.reading_status == reading_status)

    if language:
        filters.append(Book.language.ilike(f"%{language.strip()}%"))

    if publisher:
        filters.append(Book.publisher.ilike(f"%{publisher.strip()}%"))

    if year_from is not None:
        filters.append(Book.publication_year >= year_from)

    if year_to is not None:
        filters.append(Book.publication_year <= year_to)

    normalized_search = search.strip() if search else ""
    if normalized_search:
        if session.bind is not None and session.bind.dialect.name == "postgresql":
            # Full-text search (fast, GIN FTS index)
            tsvector = func.to_tsvector("simple", func.concat_ws(" ", Book.title, func.coalesce(Book.author, "")))
            fts_match = tsvector.op("@@")(func.plainto_tsquery("simple", normalized_search))
            # Trigram similarity for typo-tolerant fuzzy matching (pg_trgm GIN index)
            trigram_match = or_(
                func.similarity(Book.title, normalized_search) > 0.2,
                func.similarity(func.coalesce(Book.author, ""), normalized_search) > 0.15,
            )
            filters.append(or_(fts_match, trigram_match))
        else:
            like_pattern = f"%{normalized_search}%"
            filters.append(or_(Book.title.ilike(like_pattern), Book.author.ilike(like_pattern)))

    count_query = select(func.count()).select_from(Book)
    if filters:
        count_query = count_query.where(*filters)

    query = select(Book).options(selectinload(Book.loans)).order_by(Book.created_at.desc(), Book.id.desc())
    if filters:
        query = query.where(*filters)
    query = query.offset((page - 1) * page_size).limit(page_size)

    total = int((await session.execute(count_query)).scalar_one())
    books = list((await session.execute(query)).scalars().all())
    return books, total


async def create_book(session: AsyncSession, payload: BookCreateRequest) -> Book:
    await _validate_location_exists(session, payload.location_id)
    book = Book(**payload.model_dump())
    session.add(book)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        orig = str(exc.orig).lower() if exc.orig else ""
        if (
            "ix_books_isbn" in orig
            or "uq_books_isbn" in orig
            or "books_isbn" in orig
            or "books.isbn" in orig
        ):
            raise _map_integrity_error(exc) from exc
        raise

    await session.refresh(book)
    await session.refresh(book, attribute_names=["loans"])
    logger.info("book_created", book_id=str(book.id), location_id=str(book.location_id) if book.location_id else None)
    return book


async def get_book_or_404(session: AsyncSession, book_id: uuid.UUID) -> Book:
    result = await session.execute(select(Book).options(selectinload(Book.loans)).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if book is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")
    return book


async def update_book(session: AsyncSession, book_id: uuid.UUID, payload: BookUpdateRequest) -> Book:
    book = await get_book_or_404(session, book_id)
    update_data = payload.model_dump(exclude_unset=True)

    if "location_id" in update_data:
        await _validate_location_exists(session, update_data["location_id"])

    # Apply non-position fields first
    for field_name, value in update_data.items():
        if field_name in {"location_id", "shelf_position"}:
            continue
        setattr(book, field_name, value)

    try:
        # If location/position changes, use reorder-aware move logic
        if "location_id" in update_data or "shelf_position" in update_data:
            target_location = update_data.get("location_id", book.location_id)
            target_position = update_data.get("shelf_position", book.shelf_position)
            await bulk_move_books(session, [book.id], target_location, target_position)
        else:
            await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        orig = str(exc.orig).lower() if exc.orig else ""
        if (
            "ix_books_isbn" in orig
            or "uq_books_isbn" in orig
            or "books_isbn" in orig
            or "books.isbn" in orig
        ):
            raise _map_integrity_error(exc) from exc
        raise

    await session.refresh(book)
    await session.refresh(book, attribute_names=["loans"])
    logger.info("book_updated", book_id=str(book.id), fields=list(update_data.keys()))
    return book


async def delete_book(session: AsyncSession, book_id: uuid.UUID) -> None:
    book = await get_book_or_404(session, book_id)
    await session.delete(book)
    await session.commit()
    logger.info("book_deleted", book_id=str(book_id))


async def _validate_location_exists(session: AsyncSession, location_id: uuid.UUID | None) -> None:
    if location_id is None:
        return

    exists = (
        await session.execute(select(Location.id).where(Location.id == location_id).limit(1))
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")


def _map_integrity_error(_exc: IntegrityError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Book with this ISBN already exists",
    )



async def build_books_export_csv(session: AsyncSession) -> bytes:
    result = await session.execute(
        select(Book, Location, Loan.id)
        .outerjoin(Location, Book.location_id == Location.id)
        .outerjoin(Loan, (Loan.book_id == Book.id) & (Loan.returned_date.is_(None)))
        .order_by(Book.created_at.desc(), Book.id.desc())
    )
    rows = result.all()

    buffer = StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "title", "author", "isbn", "publisher", "language",
        "publication_year", "location", "reading_status", "is_currently_lent", "created_at",
    ])

    for book, location, active_loan_id in rows:
        location_value = ""
        if location is not None:
            location_value = f"{location.room} / {location.furniture} / {location.shelf}"

        reading_status_value = getattr(book, "reading_status", None)
        if reading_status_value is None:
            reading_status_value = getattr(book, "processing_status", "")

        writer.writerow([
            book.title,
            book.author or "",
            book.isbn or "",
            book.publisher or "",
            book.language or "",
            book.publication_year or "",
            location_value,
            str(reading_status_value or ""),
            str(active_loan_id is not None),
            book.created_at.isoformat() if book.created_at else "",
        ])

    return buffer.getvalue().encode("utf-8")


# ── Bulk operations ────────────────────────────────────────────────────────────

async def bulk_delete_books(
    session: AsyncSession,
    ids: list[uuid.UUID],
) -> int:
    """Delete multiple books by ID. Returns count of deleted rows."""
    if not ids:
        return 0
    stmt = delete(Book).where(Book.id.in_(ids))
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount  # type: ignore[return-value]


async def bulk_move_books(
    session: AsyncSession,
    ids: list[uuid.UUID],
    location_id: uuid.UUID | None,
    insert_position: int | None = None,
) -> int:
    """Move books to location and optionally insert at position with right-shift."""
    if not ids:
        return 0

    moving_books = list((await session.execute(
        select(Book).where(Book.id.in_(ids))
    )).scalars().all())
    if not moving_books:
        return 0

    affected = len(moving_books)
    source_location_ids = {b.location_id for b in moving_books if b.location_id is not None}

    # Unassign flow
    if location_id is None:
        stmt = update(Book).where(Book.id.in_(ids)).values(location_id=None, shelf_position=None)
        await session.execute(stmt)
        # normalize former shelves
        for src_id in source_location_ids:
            await _normalize_location_positions(session, src_id)
        await session.commit()
        return affected

    loc = await session.get(Location, location_id)
    if loc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")

    # preserve selected order by current shelf position then title
    moving_books.sort(key=lambda b: ((b.shelf_position if b.shelf_position is not None else 999999), b.title.lower()))

    selected_ids = {b.id for b in moving_books}
    target_books = list((await session.execute(
        select(Book)
        .where(Book.location_id == location_id, Book.id.not_in(selected_ids))
        .order_by(Book.shelf_position.asc().nulls_last(), Book.id.asc())
    )).scalars().all())

    insert_at = len(target_books) if insert_position is None else max(0, min(insert_position, len(target_books)))
    ordered = target_books[:insert_at] + moving_books + target_books[insert_at:]

    # one UPDATE statement for full target shelf reorder
    whens = [(Book.id == b.id, idx) for idx, b in enumerate(ordered)]
    reorder_stmt = (
        update(Book)
        .where(Book.id.in_([b.id for b in ordered]))
        .values(
            location_id=location_id,
            shelf_position=case(*whens, else_=Book.shelf_position),
        )
    )
    await session.execute(reorder_stmt)

    # normalize all affected source shelves (except target, already normalized by explicit reorder)
    for src_id in source_location_ids:
        if src_id != location_id:
            await _normalize_location_positions(session, src_id)

    await session.commit()
    return affected


async def bulk_update_status(
    session: AsyncSession,
    ids: list[uuid.UUID],
    reading_status: ReadingStatus,
) -> int:
    """Update reading status for multiple books. Returns count of updated rows."""
    if not ids:
        return 0
    stmt = update(Book).where(Book.id.in_(ids)).values(reading_status=reading_status)
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount  # type: ignore[return-value]


async def _normalize_location_positions(session: AsyncSession, location_id: uuid.UUID) -> None:
    books = list((await session.execute(
        select(Book)
        .where(Book.location_id == location_id)
        .order_by(Book.shelf_position.asc().nulls_last(), Book.id.asc())
    )).scalars().all())
    if not books:
        return
    whens = [(Book.id == b.id, idx) for idx, b in enumerate(books)]
    stmt = (
        update(Book)
        .where(Book.id.in_([b.id for b in books]))
        .values(shelf_position=case(*whens, else_=Book.shelf_position))
    )
    await session.execute(stmt)
