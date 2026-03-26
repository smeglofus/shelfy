import csv
from io import StringIO
import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.book import Book
from app.models.location import Location
from app.schemas.book import BookCreateRequest, BookUpdateRequest

logger = structlog.get_logger()


async def list_books(
    session: AsyncSession,
    *,
    search: str | None,
    location_id: uuid.UUID | None,
    reading_status: str | None,
    page: int,
    page_size: int,
) -> tuple[list[Book], int]:
    filters: list[ColumnElement[bool]] = []

    if location_id is not None:
        filters.append(Book.location_id == location_id)

    if reading_status:
        filters.append(Book.processing_status == reading_status)

    normalized_search = search.strip() if search else ""
    if normalized_search:
        if session.bind is not None and session.bind.dialect.name == "postgresql":
            tsvector = func.to_tsvector("simple", func.concat_ws(" ", Book.title, func.coalesce(Book.author, "")))
            filters.append(tsvector.op("@@")(func.plainto_tsquery("simple", normalized_search)))
        else:
            like_pattern = f"%{normalized_search}%"
            filters.append(or_(Book.title.ilike(like_pattern), Book.author.ilike(like_pattern)))

    count_query = select(func.count()).select_from(Book)
    if filters:
        count_query = count_query.where(*filters)

    query = select(Book).order_by(Book.created_at.desc(), Book.id.desc())
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
    logger.info("book_created", book_id=str(book.id), location_id=str(book.location_id) if book.location_id else None)
    return book


async def get_book_or_404(session: AsyncSession, book_id: uuid.UUID) -> Book:
    result = await session.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if book is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")
    return book


async def update_book(session: AsyncSession, book_id: uuid.UUID, payload: BookUpdateRequest) -> Book:
    book = await get_book_or_404(session, book_id)
    update_data = payload.model_dump(exclude_unset=True)

    if "location_id" in update_data:
        await _validate_location_exists(session, update_data["location_id"])

    for field_name, value in update_data.items():
        setattr(book, field_name, value)

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
        select(Book, Location)
        .outerjoin(Location, Book.location_id == Location.id)
        .order_by(Book.created_at.desc(), Book.id.desc())
    )
    rows = result.all()

    buffer = StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "title", "author", "isbn", "publisher", "language",
        "publication_year", "location", "reading_status", "lent_to", "created_at",
    ])

    for book, location in rows:
        location_value = ""
        if location is not None:
            location_value = f"{location.room} / {location.furniture} / {location.shelf}"

        reading_status_value = getattr(book, "reading_status", None)
        if reading_status_value is None:
            reading_status_value = getattr(book, "processing_status", "")

        lent_to_value = getattr(book, "lent_to", None) or ""

        writer.writerow([
            book.title,
            book.author or "",
            book.isbn or "",
            book.publisher or "",
            book.language or "",
            book.publication_year or "",
            location_value,
            str(reading_status_value or ""),
            lent_to_value,
            book.created_at.isoformat() if book.created_at else "",
        ])

    return buffer.getvalue().encode("utf-8")
