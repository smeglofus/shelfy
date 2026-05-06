"""Service-level tests for app/services/book.py."""
import uuid
from collections.abc import AsyncIterator

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.book import Book, BookProcessingStatus, ReadingStatus
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.location import Location
from app.models.user import User
from app.schemas.book import BookCreateRequest, BookUpdateRequest
from app.services.book import (
    bulk_delete_books,
    bulk_move_books,
    bulk_reorder_books,
    bulk_update_status,
    create_book,
    delete_book,
    get_book_or_404,
    get_shelf_etag_metadata,
    list_all_books_for_shelf,
    list_books,
    update_book,
)


@pytest.fixture
async def test_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _make_library(session: AsyncSession) -> tuple[Library, uuid.UUID]:
    user = User(email=f"u{uuid.uuid4().hex[:6]}@x.com", hashed_password="h")
    session.add(user)
    await session.flush()
    lib = Library(name="L", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return lib, lib.id


async def _make_location(session: AsyncSession, library_id: uuid.UUID) -> Location:
    loc = Location(library_id=library_id, room="R", furniture="F", shelf="S")
    session.add(loc)
    await session.commit()
    await session.refresh(loc)
    return loc


async def _make_book(
    session: AsyncSession,
    library_id: uuid.UUID,
    *,
    title: str = "Book",
    isbn: str | None = None,
    author: str | None = None,
    location_id: uuid.UUID | None = None,
    shelf_position: int | None = None,
    reading_status: ReadingStatus = ReadingStatus.UNREAD,
    publication_year: int | None = None,
    language: str | None = None,
    publisher: str | None = None,
    is_sample: bool = False,
) -> Book:
    book = Book(
        library_id=library_id,
        title=title,
        isbn=isbn,
        author=author,
        location_id=location_id,
        shelf_position=shelf_position,
        reading_status=reading_status,
        processing_status=BookProcessingStatus.MANUAL,
        publication_year=publication_year,
        language=language,
        publisher=publisher,
        is_sample=is_sample,
    )
    session.add(book)
    await session.commit()
    await session.refresh(book)
    return book


# ── list_books ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_books_empty(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=False, reading_status=None, page=1, page_size=20,
    )
    assert books == []
    assert total == 0
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_list_books_returns_all(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    await _make_book(test_session, lib_id, title="Alpha")
    await _make_book(test_session, lib_id, title="Beta")
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=False, reading_status=None, page=1, page_size=20,
    )
    assert total == 2
    assert len(books) == 2
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_list_books_search_by_title(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    await _make_book(test_session, lib_id, title="Clean Code")
    await _make_book(test_session, lib_id, title="Design Patterns")
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search="Clean", location_id=None,
        unassigned_only=False, reading_status=None, page=1, page_size=20,
    )
    assert total == 1
    assert books[0].title == "Clean Code"
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_list_books_filter_by_reading_status(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    await _make_book(test_session, lib_id, title="Unread", reading_status=ReadingStatus.UNREAD)
    await _make_book(test_session, lib_id, title="Read", reading_status=ReadingStatus.READ)
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=False, reading_status="read", page=1, page_size=20,
    )
    assert total == 1
    assert books[0].title == "Read"
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_list_books_filter_unassigned_only(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    await _make_book(test_session, lib_id, title="Unassigned")
    await _make_book(test_session, lib_id, title="Placed", location_id=loc.id, shelf_position=0)
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=True, reading_status=None, page=1, page_size=20,
    )
    assert total == 1
    assert books[0].title == "Unassigned"
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_list_books_filter_by_location(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    await _make_book(test_session, lib_id, title="In Location", location_id=loc.id, shelf_position=0)
    await _make_book(test_session, lib_id, title="No Location")
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=loc.id,
        unassigned_only=False, reading_status=None, page=1, page_size=20,
    )
    assert total == 1
    assert books[0].title == "In Location"
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_list_books_pagination(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    for i in range(5):
        await _make_book(test_session, lib_id, title=f"Book {i}")
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=False, reading_status=None, page=1, page_size=3,
    )
    assert total == 5
    assert len(books) == 3
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_list_books_filter_by_language(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    await _make_book(test_session, lib_id, title="Czech Book", language="cs")
    await _make_book(test_session, lib_id, title="English Book", language="en")
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=False, reading_status=None, language="cs", page=1, page_size=20,
    )
    assert total == 1
    assert books[0].title == "Czech Book"
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_list_books_filter_by_year_range(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    await _make_book(test_session, lib_id, title="Old", publication_year=1990)
    await _make_book(test_session, lib_id, title="New", publication_year=2020)
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=False, reading_status=None, year_from=2000, year_to=2025,
        page=1, page_size=20,
    )
    assert total == 1
    assert books[0].title == "New"
    assert has_sample_books is False


# ── has_sample_books flag (issue #202) ────────────────────────────────────────

@pytest.mark.asyncio
async def test_has_sample_books_true_when_sample_exists(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    await _make_book(test_session, lib_id, title="Sample Book", is_sample=True)
    _, _, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=False, reading_status=None, page=1, page_size=20,
    )
    assert has_sample_books is True


@pytest.mark.asyncio
async def test_has_sample_books_false_when_only_real_books(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    await _make_book(test_session, lib_id, title="Real Book", is_sample=False)
    _, _, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=False, reading_status=None, page=1, page_size=20,
    )
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_has_sample_books_independent_of_active_filters(test_session: AsyncSession) -> None:
    """has_sample_books reflects library-wide state, not the current page/filter results."""
    _, lib_id = await _make_library(test_session)
    # Only a sample book exists — it won't match the search term below
    await _make_book(test_session, lib_id, title="Sample Only", is_sample=True)
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search="NOTHING_MATCHES", location_id=None,
        unassigned_only=False, reading_status=None, page=1, page_size=20,
    )
    assert books == []
    assert total == 0
    assert has_sample_books is True  # still True even though 0 items returned


# ── list_all_books_for_shelf ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_all_books_for_shelf_ordered(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    await _make_book(test_session, lib_id, title="Second", location_id=loc.id, shelf_position=1)
    await _make_book(test_session, lib_id, title="First", location_id=loc.id, shelf_position=0)
    await _make_book(test_session, lib_id, title="Unplaced")

    books = await list_all_books_for_shelf(test_session, library_id=lib_id)
    assert len(books) == 3
    assert books[0].shelf_position == 0
    assert books[1].shelf_position == 1
    assert books[2].location_id is None


@pytest.mark.asyncio
async def test_list_all_books_for_shelf_empty(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    books = await list_all_books_for_shelf(test_session, library_id=lib_id)
    assert books == []


# ── create_book ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_book_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload = BookCreateRequest(title="New Book")
    book = await create_book(test_session, payload, lib_id)
    assert book.id is not None
    assert book.title == "New Book"
    assert book.library_id == lib_id
    assert book.reading_status == ReadingStatus.UNREAD


@pytest.mark.asyncio
async def test_create_book_with_location(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    payload = BookCreateRequest(title="Placed Book", location_id=loc.id, shelf_position=0)
    book = await create_book(test_session, payload, lib_id)
    assert book.location_id == loc.id
    assert book.shelf_position == 0


@pytest.mark.asyncio
async def test_create_book_invalid_location_raises_404(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload = BookCreateRequest(title="Bad Book", location_id=uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        await create_book(test_session, payload, lib_id)
    assert exc.value.status_code == 404


# ── get_book_or_404 ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_book_or_404_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    book = await _make_book(test_session, lib_id, title="Found")
    result = await get_book_or_404(test_session, book.id, lib_id)
    assert result.id == book.id


@pytest.mark.asyncio
async def test_get_book_or_404_raises(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    with pytest.raises(HTTPException) as exc:
        await get_book_or_404(test_session, uuid.uuid4(), lib_id)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_book_or_404_wrong_library_raises(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    _, other_lib_id = await _make_library(test_session)
    book = await _make_book(test_session, lib_id, title="Mine")
    with pytest.raises(HTTPException) as exc:
        await get_book_or_404(test_session, book.id, other_lib_id)
    assert exc.value.status_code == 404


# ── delete_book ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_book_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    book = await _make_book(test_session, lib_id, title="To Delete")
    book_id = book.id
    await delete_book(test_session, book_id, lib_id)
    assert await test_session.get(Book, book_id) is None


@pytest.mark.asyncio
async def test_delete_book_not_found_raises(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    with pytest.raises(HTTPException) as exc:
        await delete_book(test_session, uuid.uuid4(), lib_id)
    assert exc.value.status_code == 404


# ── bulk_delete_books ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_bulk_delete_empty_returns_zero(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    count = await bulk_delete_books(test_session, [], lib_id)
    assert count == 0


@pytest.mark.asyncio
async def test_bulk_delete_foreign_book_raises_403(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    _, other_lib_id = await _make_library(test_session)
    foreign = await _make_book(test_session, other_lib_id, title="Foreign")
    with pytest.raises(HTTPException) as exc:
        await bulk_delete_books(test_session, [foreign.id], lib_id)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_bulk_delete_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    b1 = await _make_book(test_session, lib_id, title="A")
    b2 = await _make_book(test_session, lib_id, title="B")
    count = await bulk_delete_books(test_session, [b1.id, b2.id], lib_id)
    assert count == 2
    assert await test_session.get(Book, b1.id) is None
    assert await test_session.get(Book, b2.id) is None


# ── bulk_update_status ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_bulk_update_status_empty_returns_zero(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    count = await bulk_update_status(test_session, [], ReadingStatus.READ, lib_id)
    assert count == 0


@pytest.mark.asyncio
async def test_bulk_update_status_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    b1 = await _make_book(test_session, lib_id, title="A", reading_status=ReadingStatus.UNREAD)
    b2 = await _make_book(test_session, lib_id, title="B", reading_status=ReadingStatus.UNREAD)
    count = await bulk_update_status(test_session, [b1.id, b2.id], ReadingStatus.READ, lib_id)
    assert count == 2
    await test_session.refresh(b1)
    await test_session.refresh(b2)
    assert b1.reading_status == ReadingStatus.READ
    assert b2.reading_status == ReadingStatus.READ


@pytest.mark.asyncio
async def test_bulk_update_status_foreign_raises_403(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    _, other_lib_id = await _make_library(test_session)
    foreign = await _make_book(test_session, other_lib_id, title="Foreign")
    with pytest.raises(HTTPException) as exc:
        await bulk_update_status(test_session, [foreign.id], ReadingStatus.READ, lib_id)
    assert exc.value.status_code == 403


# ── update_book ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_book_title(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    book = await _make_book(test_session, lib_id, title="Original")
    payload = BookUpdateRequest(title="Updated")
    result = await update_book(test_session, book.id, payload, lib_id)
    assert result.title == "Updated"


@pytest.mark.asyncio
async def test_update_book_reading_status(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    book = await _make_book(test_session, lib_id, title="Book", reading_status=ReadingStatus.UNREAD)
    payload = BookUpdateRequest(reading_status=ReadingStatus.READ)
    result = await update_book(test_session, book.id, payload, lib_id)
    assert result.reading_status == ReadingStatus.READ


@pytest.mark.asyncio
async def test_update_book_move_to_location(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    book = await _make_book(test_session, lib_id, title="Book")
    payload = BookUpdateRequest(location_id=loc.id, shelf_position=0)
    result = await update_book(test_session, book.id, payload, lib_id)
    assert result.location_id == loc.id


@pytest.mark.asyncio
async def test_update_book_not_found_raises_404(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload = BookUpdateRequest(title="Anything")
    with pytest.raises(HTTPException) as exc:
        await update_book(test_session, uuid.uuid4(), payload, lib_id)
    assert exc.value.status_code == 404


# ── bulk_move_books ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_bulk_move_empty_returns_zero(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    count = await bulk_move_books(test_session, [], None, library_id=lib_id)
    assert count == 0


@pytest.mark.asyncio
async def test_bulk_move_to_none_unassigns(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    b = await _make_book(test_session, lib_id, title="Placed", location_id=loc.id, shelf_position=0)
    count = await bulk_move_books(test_session, [b.id], None, library_id=lib_id)
    assert count == 1
    await test_session.refresh(b)
    assert b.location_id is None
    assert b.shelf_position is None


@pytest.mark.asyncio
async def test_bulk_move_to_location(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    b1 = await _make_book(test_session, lib_id, title="A")
    b2 = await _make_book(test_session, lib_id, title="B")
    count = await bulk_move_books(test_session, [b1.id, b2.id], loc.id, library_id=lib_id)
    assert count == 2
    await test_session.refresh(b1)
    await test_session.refresh(b2)
    assert b1.location_id == loc.id
    assert b2.location_id == loc.id


@pytest.mark.asyncio
async def test_bulk_move_mixed_ownership_raises_403(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    _, other_lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    own_book = await _make_book(test_session, lib_id, title="Own")
    foreign = await _make_book(test_session, other_lib_id, title="Foreign")
    with pytest.raises(HTTPException) as exc:
        await bulk_move_books(test_session, [own_book.id, foreign.id], loc.id, library_id=lib_id)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_bulk_move_invalid_location_raises_404(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    b = await _make_book(test_session, lib_id, title="Book")
    with pytest.raises(HTTPException) as exc:
        await bulk_move_books(test_session, [b.id], uuid.uuid4(), library_id=lib_id)
    assert exc.value.status_code == 404


# ── bulk_reorder_books ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_bulk_reorder_empty_returns_zero(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    count = await bulk_reorder_books(test_session, items=[], library_id=lib_id)
    assert count == 0


@pytest.mark.asyncio
async def test_bulk_reorder_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    b1 = await _make_book(test_session, lib_id, title="A", location_id=loc.id, shelf_position=0)
    b2 = await _make_book(test_session, lib_id, title="B", location_id=loc.id, shelf_position=1)

    count = await bulk_reorder_books(
        test_session,
        items=[(b1.id, loc.id, 1), (b2.id, loc.id, 0)],
        library_id=lib_id,
    )
    assert count == 2
    await test_session.refresh(b1)
    await test_session.refresh(b2)
    assert b1.shelf_position == 1
    assert b2.shelf_position == 0


@pytest.mark.asyncio
async def test_bulk_reorder_duplicate_id_raises_400(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    b = await _make_book(test_session, lib_id, title="A", location_id=loc.id, shelf_position=0)
    with pytest.raises(HTTPException) as exc:
        await bulk_reorder_books(
            test_session,
            items=[(b.id, loc.id, 0), (b.id, loc.id, 1)],
            library_id=lib_id,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_bulk_reorder_foreign_book_raises_403(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    _, other_lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    foreign = await _make_book(test_session, other_lib_id, title="Foreign")
    with pytest.raises(HTTPException) as exc:
        await bulk_reorder_books(
            test_session,
            items=[(foreign.id, loc.id, 0)],
            library_id=lib_id,
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_bulk_reorder_invalid_location_raises_404(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    b = await _make_book(test_session, lib_id, title="Book")
    with pytest.raises(HTTPException) as exc:
        await bulk_reorder_books(
            test_session,
            items=[(b.id, uuid.uuid4(), 0)],
            library_id=lib_id,
        )
    assert exc.value.status_code == 404


# ── Additional edge-case tests ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_books_filter_by_publisher(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    await _make_book(test_session, lib_id, title="OReilly Book", publisher="O'Reilly Media")
    await _make_book(test_session, lib_id, title="Other Book", publisher="Penguin")
    books, total, has_sample_books = await list_books(
        test_session, library_id=lib_id, search=None, location_id=None,
        unassigned_only=False, reading_status=None, publisher="O'Reilly", page=1, page_size=20,
    )
    assert total == 1
    assert books[0].title == "OReilly Book"
    assert has_sample_books is False


@pytest.mark.asyncio
async def test_create_book_duplicate_isbn_raises_409(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload1 = BookCreateRequest(title="First", isbn="9780134494166")
    await create_book(test_session, payload1, lib_id)
    payload2 = BookCreateRequest(title="Second", isbn="9780134494166")
    with pytest.raises(HTTPException) as exc:
        await create_book(test_session, payload2, lib_id)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_update_book_duplicate_isbn_raises_409(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    await _make_book(test_session, lib_id, title="First", isbn="9780134494166")
    second = await _make_book(test_session, lib_id, title="Second", isbn="9780132350884")
    payload = BookUpdateRequest(isbn="9780134494166")
    with pytest.raises(HTTPException) as exc:
        await update_book(test_session, second.id, payload, lib_id)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_bulk_move_no_books_at_all_returns_zero(test_session: AsyncSession) -> None:
    """When ALL requested IDs don't exist and library_id=None, returns 0 (line 224)."""
    _, lib_id = await _make_library(test_session)
    count = await bulk_move_books(test_session, [uuid.uuid4(), uuid.uuid4()], None)
    assert count == 0


@pytest.mark.asyncio
async def test_bulk_move_location_not_in_db_raises_404(test_session: AsyncSession) -> None:
    """Without library_id, skip _validate_location check and hit the get() None guard (line 254)."""
    _, lib_id = await _make_library(test_session)
    b = await _make_book(test_session, lib_id, title="Book")
    with pytest.raises(HTTPException) as exc:
        # library_id=None bypasses _validate_location_belongs_to_library,
        # so the loc = session.get(...) None check at line 254 fires instead.
        await bulk_move_books(test_session, [b.id], uuid.uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_bulk_move_between_locations_normalizes_source(test_session: AsyncSession) -> None:
    """Moving SOME books out of a location triggers _normalize_location_positions (lines 288-489)."""
    _, lib_id = await _make_library(test_session)
    src = await _make_location(test_session, lib_id)
    dst = await _make_location(test_session, lib_id)

    # Put 3 books at src; gaps in position so normalization does real work
    b0 = await _make_book(test_session, lib_id, title="Stay0", location_id=src.id, shelf_position=0)
    b1 = await _make_book(test_session, lib_id, title="Move", location_id=src.id, shelf_position=1)
    b2 = await _make_book(test_session, lib_id, title="Stay2", location_id=src.id, shelf_position=10)

    # Move only b1 to dst — b0 and b2 remain at src → normalization runs
    count = await bulk_move_books(test_session, [b1.id], dst.id, library_id=lib_id)
    assert count == 1

    await test_session.refresh(b0)
    await test_session.refresh(b2)
    # After normalization b0 stays at 0, b2 should be renumbered to 1
    assert b0.shelf_position == 0
    assert b2.shelf_position == 1


@pytest.mark.asyncio
async def test_bulk_reorder_duplicate_target_position_raises_400(test_session: AsyncSession) -> None:
    """Two *different* books assigned to the same (location, position) → 400 (line 321)."""
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    b1 = await _make_book(test_session, lib_id, title="A", location_id=loc.id, shelf_position=0)
    b2 = await _make_book(test_session, lib_id, title="B", location_id=loc.id, shelf_position=1)
    with pytest.raises(HTTPException) as exc:
        await bulk_reorder_books(
            test_session,
            # Both books claim position 0 in the same location
            items=[(b1.id, loc.id, 0), (b2.id, loc.id, 0)],
            library_id=lib_id,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_bulk_reorder_partial_coverage_raises_409(test_session: AsyncSession) -> None:
    """Payload tries to place a book at a position already taken by an outsider → 409 (line 350)."""
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)
    outsider = await _make_book(test_session, lib_id, title="Outsider", location_id=loc.id, shelf_position=0)
    mover = await _make_book(test_session, lib_id, title="Mover", location_id=loc.id, shelf_position=1)
    with pytest.raises(HTTPException) as exc:
        # Payload only covers `mover`, not `outsider`, but claims position 0
        # which `outsider` already occupies.
        await bulk_reorder_books(
            test_session,
            items=[(mover.id, loc.id, 0)],
            library_id=lib_id,
        )
    assert exc.value.status_code == 409
    _ = outsider  # prevent unused-variable warning


# ── Shelf ETag metadata ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_shelf_etag_metadata_empty_library(test_session: AsyncSession) -> None:
    """Empty library returns all zeros and 0.0 timestamps."""
    _, lib_id = await _make_library(test_session)
    book_cnt, max_book_ts, loc_cnt, max_loc_ts = await get_shelf_etag_metadata(
        test_session, library_id=lib_id
    )
    assert book_cnt == 0
    assert max_book_ts == 0.0
    assert loc_cnt == 0
    assert max_loc_ts == 0.0


@pytest.mark.asyncio
async def test_get_shelf_etag_metadata_with_data(test_session: AsyncSession) -> None:
    """Library with books and locations returns counts > 0 and real timestamps."""
    _, lib_id = await _make_library(test_session)
    await _make_location(test_session, lib_id)
    await _make_location(test_session, lib_id)
    await _make_book(test_session, lib_id, title="Book 1")
    await _make_book(test_session, lib_id, title="Book 2")
    await _make_book(test_session, lib_id, title="Book 3")

    book_cnt, max_book_ts, loc_cnt, max_loc_ts = await get_shelf_etag_metadata(
        test_session, library_id=lib_id
    )
    assert book_cnt == 3
    assert max_book_ts > 0.0
    assert loc_cnt == 2
    assert max_loc_ts > 0.0
