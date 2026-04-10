import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, case, delete, update
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.book import Book, ReadingStatus
from app.models.location import Location
from app.schemas.book import BookCreateRequest, BookUpdateRequest

# Re-export CSV helpers so existing imports from this module still work
from app.services.csv_import import build_books_export_csv as build_books_export_csv  # noqa: F401

logger = structlog.get_logger()


async def list_books(
    session: AsyncSession,
    *,
    library_id: uuid.UUID,
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
    filters: list[ColumnElement[bool]] = [Book.library_id == library_id]

    if unassigned_only:
        filters.append(Book.location_id.is_(None))
    elif location_id is not None:
        filters.append(Book.location_id == location_id)

    if reading_status:
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
            tsvector = func.to_tsvector("simple", func.concat_ws(" ", Book.title, func.coalesce(Book.author, "")))
            fts_match = tsvector.op("@@")(func.plainto_tsquery("simple", normalized_search))
            trigram_match = or_(
                func.similarity(Book.title, normalized_search) > 0.2,
                func.similarity(func.coalesce(Book.author, ""), normalized_search) > 0.15,
            )
            filters.append(or_(fts_match, trigram_match))
        else:
            like_pattern = f"%{normalized_search}%"
            filters.append(or_(Book.title.ilike(like_pattern), Book.author.ilike(like_pattern)))

    count_query = select(func.count()).select_from(Book).where(*filters)
    query = (
        select(Book)
        .options(selectinload(Book.loans))
        .where(*filters)
        .order_by(Book.created_at.desc(), Book.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    total = int((await session.execute(count_query)).scalar_one())
    books = list((await session.execute(query)).scalars().all())
    return books, total


async def create_book(session: AsyncSession, payload: BookCreateRequest, library_id: uuid.UUID) -> Book:
    await _validate_location_belongs_to_library(session, payload.location_id, library_id)
    book = Book(**payload.model_dump(), library_id=library_id)
    session.add(book)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if _is_isbn_conflict(exc):
            raise _isbn_conflict_error() from exc
        raise

    await session.refresh(book)
    await session.refresh(book, attribute_names=["loans"])
    logger.info("book_created", book_id=str(book.id), library_id=str(library_id))
    return book


async def get_book_or_404(session: AsyncSession, book_id: uuid.UUID, library_id: uuid.UUID) -> Book:
    result = await session.execute(
        select(Book)
        .options(selectinload(Book.loans))
        .where(Book.id == book_id, Book.library_id == library_id)
    )
    book = result.scalar_one_or_none()
    if book is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")
    return book


async def update_book(
    session: AsyncSession, book_id: uuid.UUID, payload: BookUpdateRequest, library_id: uuid.UUID
) -> Book:
    book = await get_book_or_404(session, book_id, library_id)
    update_data = payload.model_dump(exclude_unset=True)

    if "location_id" in update_data:
        await _validate_location_belongs_to_library(session, update_data["location_id"], library_id)

    for field_name, value in update_data.items():
        if field_name in {"location_id", "shelf_position"}:
            continue
        setattr(book, field_name, value)

    try:
        if "location_id" in update_data or "shelf_position" in update_data:
            target_location = update_data.get("location_id", book.location_id)
            target_position = update_data.get("shelf_position", book.shelf_position)
            await bulk_move_books(session, [book.id], target_location, target_position, library_id)
        else:
            await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if _is_isbn_conflict(exc):
            raise _isbn_conflict_error() from exc
        raise

    await session.refresh(book)
    await session.refresh(book, attribute_names=["loans"])
    logger.info("book_updated", book_id=str(book.id), fields=list(update_data.keys()))
    return book


async def delete_book(session: AsyncSession, book_id: uuid.UUID, library_id: uuid.UUID) -> None:
    book = await get_book_or_404(session, book_id, library_id)
    await session.delete(book)
    await session.commit()
    logger.info("book_deleted", book_id=str(book_id), library_id=str(library_id))


# ── Bulk operations ────────────────────────────────────────────────────────────

async def bulk_delete_books(
    session: AsyncSession,
    ids: list[uuid.UUID],
    library_id: uuid.UUID,
) -> int:
    """Delete multiple books by ID. All IDs must belong to library; raises 403 otherwise."""
    if not ids:
        return 0
    await _assert_all_books_owned(session, ids, library_id)
    stmt = delete(Book).where(Book.id.in_(ids), Book.library_id == library_id)
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount  # type: ignore[return-value]


async def bulk_move_books(
    session: AsyncSession,
    ids: list[uuid.UUID],
    location_id: uuid.UUID | None,
    insert_position: int | None = None,
    library_id: uuid.UUID | None = None,
) -> int:
    """Move books to location and optionally insert at position with right-shift.
    When library_id is provided, membership is enforced on both books and target location.
    """
    if not ids:
        return 0

    # Build base query — always scope to library when known
    book_query = select(Book).where(Book.id.in_(ids))
    if library_id is not None:
        book_query = book_query.where(Book.library_id == library_id)

    moving_books = list((await session.execute(book_query)).scalars().all())
    if not moving_books:
        return 0

    # If fewer books found than requested IDs, some IDs don't belong to library → 403
    if library_id is not None and len(moving_books) < len(ids):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="One or more books do not belong to the current library",
        )

    affected = len(moving_books)
    source_location_ids = {b.location_id for b in moving_books if b.location_id is not None}

    # Unassign flow
    if location_id is None:
        stmt = update(Book).where(Book.id.in_(ids))
        if library_id is not None:
            stmt = stmt.where(Book.library_id == library_id)
        stmt = stmt.values(location_id=None, shelf_position=None)
        await session.execute(stmt)
        for src_id in source_location_ids:
            await _normalize_location_positions(session, src_id, library_id)
        await session.commit()
        return affected

    # Validate target location belongs to library
    if library_id is not None:
        await _validate_location_belongs_to_library(session, location_id, library_id)

    loc = await session.get(Location, location_id)
    if loc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")

    moving_books.sort(key=lambda b: ((b.shelf_position if b.shelf_position is not None else 999999), b.title.lower()))

    selected_ids = {b.id for b in moving_books}
    target_query = select(Book).where(Book.location_id == location_id, Book.id.not_in(selected_ids))
    target_query = target_query.order_by(Book.shelf_position.asc().nulls_last(), Book.id.asc())
    target_books = list((await session.execute(target_query)).scalars().all())

    insert_at = len(target_books) if insert_position is None else max(0, min(insert_position, len(target_books)))
    ordered = target_books[:insert_at] + moving_books + target_books[insert_at:]

    ordered_ids = [b.id for b in ordered]

    # Two-phase reorder to avoid transient unique-constraint collisions on
    # (location_id, shelf_position) during UPDATE.
    temp_whens = [(Book.id == bid, -(idx + 1)) for idx, bid in enumerate(ordered_ids)]
    await session.execute(
        update(Book)
        .where(Book.id.in_(ordered_ids))
        .values(
            location_id=location_id,
            shelf_position=case(*temp_whens, else_=Book.shelf_position),
        )
    )

    final_whens = [(Book.id == bid, idx) for idx, bid in enumerate(ordered_ids)]
    await session.execute(
        update(Book)
        .where(Book.id.in_(ordered_ids))
        .values(shelf_position=case(*final_whens, else_=Book.shelf_position))
    )

    for src_id in source_location_ids:
        if src_id != location_id:
            await _normalize_location_positions(session, src_id, library_id)

    await session.commit()
    return affected


async def bulk_reorder_books(
    session: AsyncSession,
    *,
    items: list[tuple[uuid.UUID, uuid.UUID, int]],
    library_id: uuid.UUID,
) -> int:
    if not items:
        return 0

    ids = [book_id for book_id, _, _ in items]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate book id in reorder payload")

    books = list((await session.execute(select(Book).where(Book.id.in_(ids), Book.library_id == library_id))).scalars().all())
    if len(books) != len(ids):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="One or more books do not belong to the current library")

    location_ids = {loc_id for _, loc_id, _ in items}
    found_locations = set((await session.execute(select(Location.id).where(Location.id.in_(location_ids), Location.library_id == library_id))).scalars().all())
    if found_locations != location_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")

    seen_pairs: set[tuple[uuid.UUID, int]] = set()
    for _, loc_id, pos in items:
        key = (loc_id, pos)
        if key in seen_pairs:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate target shelf position in payload")
        seen_pairs.add(key)

    whens_loc = [(Book.id == bid, lid) for bid, lid, _ in items]
    temp_whens_pos = [(Book.id == bid, -(idx + 1)) for idx, (bid, _, _) in enumerate(items)]

    await session.execute(
        update(Book)
        .where(Book.id.in_(ids), Book.library_id == library_id)
        .values(
            location_id=case(*whens_loc, else_=Book.location_id),
            shelf_position=case(*temp_whens_pos, else_=Book.shelf_position),
        )
    )

    final_whens_pos = [(Book.id == bid, pos) for bid, _, pos in items]
    await session.execute(
        update(Book)
        .where(Book.id.in_(ids), Book.library_id == library_id)
        .values(shelf_position=case(*final_whens_pos, else_=Book.shelf_position))
    )

    await session.commit()
    return len(items)


async def bulk_update_status(
    session: AsyncSession,
    ids: list[uuid.UUID],
    reading_status: ReadingStatus,
    library_id: uuid.UUID,
) -> int:
    """Update reading status for multiple books. All IDs must belong to library."""
    if not ids:
        return 0
    await _assert_all_books_owned(session, ids, library_id)
    stmt = (
        update(Book)
        .where(Book.id.in_(ids), Book.library_id == library_id)
        .values(reading_status=reading_status)
    )
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount  # type: ignore[return-value]


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _assert_all_books_owned(
    session: AsyncSession, ids: list[uuid.UUID], library_id: uuid.UUID
) -> None:
    """Raise 403 if any of the given book IDs are not in the library."""
    count_result = await session.execute(
        select(func.count())
        .select_from(Book)
        .where(Book.id.in_(ids), Book.library_id == library_id)
    )
    owned_count = int(count_result.scalar_one())
    if owned_count < len(ids):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="One or more books do not belong to the current library",
        )


async def _validate_location_belongs_to_library(
    session: AsyncSession, location_id: uuid.UUID | None, library_id: uuid.UUID
) -> None:
    """Verify location exists AND belongs to library. Returns 404 on any failure."""
    if location_id is None:
        return
    exists = (
        await session.execute(
            select(Location.id)
            .where(Location.id == location_id, Location.library_id == library_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")


def _is_isbn_conflict(exc: IntegrityError) -> bool:
    orig = str(exc.orig).lower() if exc.orig else ""
    return any(
        token in orig
        for token in (
            "ix_books_isbn",
            "uq_books_isbn",
            "books_isbn",
            "books.isbn",
            "uq_books_isbn_per_user",
            "uq_books_isbn_per_library",
        )
    )


def _isbn_conflict_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Book with this ISBN already exists",
    )


async def _normalize_location_positions(
    session: AsyncSession, location_id: uuid.UUID, library_id: uuid.UUID | None = None
) -> None:
    query = select(Book).where(Book.location_id == location_id)
    query = query.order_by(Book.shelf_position.asc().nulls_last(), Book.id.asc())

    books = list((await session.execute(query)).scalars().all())
    if not books:
        return
    whens = [(Book.id == b.id, idx) for idx, b in enumerate(books)]
    stmt = (
        update(Book)
        .where(Book.id.in_([b.id for b in books]))
        .values(shelf_position=case(*whens, else_=Book.shelf_position))
    )
    await session.execute(stmt)
