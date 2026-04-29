"""Service-level tests for app/services/scan.py.

Covers _normalize_isbn and confirm_shelf_scan including append mode,
duplicate-ISBN/position handling, and error paths.
"""
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
from app.schemas.scan import ConfirmBookItem, ShelfScanConfirmRequest
from app.services.scan import _normalize_isbn, confirm_shelf_scan


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
async def test_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()

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


def _item(position: int, title: str, isbn: str | None = None) -> ConfirmBookItem:
    return ConfirmBookItem(position=position, title=title, isbn=isbn)


# ── _normalize_isbn ───────────────────────────────────────────────────────────

def test_normalize_isbn_none() -> None:
    assert _normalize_isbn(None) is None


def test_normalize_isbn_empty() -> None:
    assert _normalize_isbn("") is None
    assert _normalize_isbn("   ") is None


def test_normalize_isbn_sentinel_values() -> None:
    for val in ("none", "None", "null", "NULL", "n/a", "N/A", "na", "NA", "unknown", "UNKNOWN", "-"):
        assert _normalize_isbn(val) is None, f"expected None for {val!r}"


def test_normalize_isbn_valid() -> None:
    assert _normalize_isbn("9780134494166") == "9780134494166"
    assert _normalize_isbn("  978-0-13-468599-1  ") == "978-0-13-468599-1"


# ── confirm_shelf_scan ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_confirm_scan_location_not_found(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload = ShelfScanConfirmRequest(
        location_id=uuid.uuid4(),
        books=[_item(0, "Ghost Book")],
    )
    with pytest.raises(HTTPException) as exc:
        await confirm_shelf_scan(test_session, payload, lib_id)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_confirm_scan_creates_new_books(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    payload = ShelfScanConfirmRequest(
        location_id=loc.id,
        books=[
            _item(0, "Clean Code", "9780132350884"),
            _item(1, "Clean Architecture", "9780134494166"),
        ],
    )
    ids = await confirm_shelf_scan(test_session, payload, lib_id)

    assert len(ids) == 2
    book = (await test_session.get(Book, ids[0]))
    assert book is not None
    assert book.title == "Clean Code"
    assert book.shelf_position == 0
    assert book.location_id == loc.id
    assert book.processing_status == BookProcessingStatus.PARTIAL
    assert book.reading_status == ReadingStatus.UNREAD


@pytest.mark.asyncio
async def test_confirm_scan_duplicate_isbn_updates_existing(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    existing = Book(
        library_id=lib_id, title="Old Title", isbn="9780132350884",
        location_id=loc.id, shelf_position=5,
        reading_status=ReadingStatus.READ,
        processing_status=BookProcessingStatus.DONE,
    )
    test_session.add(existing)
    await test_session.commit()
    await test_session.refresh(existing)

    payload = ShelfScanConfirmRequest(
        location_id=loc.id,
        books=[_item(0, "New Title", "9780132350884")],
    )
    ids = await confirm_shelf_scan(test_session, payload, lib_id)

    assert len(ids) == 1
    assert ids[0] == existing.id
    await test_session.refresh(existing)
    assert existing.title == "New Title"
    assert existing.shelf_position == 0
    assert existing.reading_status == ReadingStatus.READ  # preserved


@pytest.mark.asyncio
async def test_confirm_scan_duplicate_position_updates_existing(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    occupant = Book(
        library_id=lib_id, title="Occupant", isbn=None,
        location_id=loc.id, shelf_position=0,
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    )
    test_session.add(occupant)
    await test_session.commit()
    await test_session.refresh(occupant)

    payload = ShelfScanConfirmRequest(
        location_id=loc.id,
        books=[_item(0, "Replacement", isbn=None)],
    )
    ids = await confirm_shelf_scan(test_session, payload, lib_id)

    assert len(ids) == 1
    assert ids[0] == occupant.id
    await test_session.refresh(occupant)
    assert occupant.title == "Replacement"


@pytest.mark.asyncio
async def test_confirm_scan_new_book_reading_status_set_to_unread(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    payload = ShelfScanConfirmRequest(
        location_id=loc.id,
        books=[_item(0, "New Book")],
    )
    ids = await confirm_shelf_scan(test_session, payload, lib_id)
    book = await test_session.get(Book, ids[0])
    assert book is not None
    assert book.reading_status == ReadingStatus.UNREAD


@pytest.mark.asyncio
async def test_confirm_scan_append_anchor_not_found(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    payload = ShelfScanConfirmRequest(
        location_id=loc.id,
        append_after_book_id=uuid.uuid4(),
        books=[_item(0, "Book")],
    )
    with pytest.raises(HTTPException) as exc:
        await confirm_shelf_scan(test_session, payload, lib_id)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_confirm_scan_append_anchor_wrong_location(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc1 = await _make_location(test_session, lib_id)
    loc2 = await _make_location(test_session, lib_id)

    anchor = Book(
        library_id=lib_id, title="Anchor",
        location_id=loc1.id, shelf_position=0,
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    )
    test_session.add(anchor)
    await test_session.commit()
    await test_session.refresh(anchor)

    payload = ShelfScanConfirmRequest(
        location_id=loc2.id,
        append_after_book_id=anchor.id,
        books=[_item(0, "New Book")],
    )
    with pytest.raises(HTTPException) as exc:
        await confirm_shelf_scan(test_session, payload, lib_id)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_confirm_scan_existing_book_null_reading_status_gets_unread(test_session: AsyncSession) -> None:
    """Existing book with reading_status=None gets set to UNREAD on scan (line 126)."""
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    # Create a book without reading_status (nullable)
    existing = Book(
        library_id=lib_id, title="Old", isbn="9780132350884",
        location_id=loc.id, shelf_position=5,
        reading_status=None,
        processing_status=BookProcessingStatus.MANUAL,
    )
    test_session.add(existing)
    await test_session.commit()
    await test_session.refresh(existing)

    payload = ShelfScanConfirmRequest(
        location_id=loc.id,
        books=[_item(0, "New Title", "9780132350884")],
    )
    ids = await confirm_shelf_scan(test_session, payload, lib_id)
    assert len(ids) == 1
    await test_session.refresh(existing)
    assert existing.reading_status == ReadingStatus.UNREAD


@pytest.mark.asyncio
async def test_confirm_scan_append_mode_shifts_existing(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    anchor = Book(
        library_id=lib_id, title="Anchor",
        location_id=loc.id, shelf_position=0,
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    )
    after = Book(
        library_id=lib_id, title="After",
        location_id=loc.id, shelf_position=1,
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    )
    test_session.add_all([anchor, after])
    await test_session.commit()
    for b in (anchor, after):
        await test_session.refresh(b)

    payload = ShelfScanConfirmRequest(
        location_id=loc.id,
        append_after_book_id=anchor.id,
        books=[_item(0, "Inserted")],
    )
    ids = await confirm_shelf_scan(test_session, payload, lib_id)
    assert len(ids) == 1

    await test_session.refresh(after)
    # "After" was at position 1; with one inserted book it should be at 2
    assert after.shelf_position == 2
