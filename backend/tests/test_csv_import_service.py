"""Service-level tests for app/services/csv_import.py.

Covers the functions that are SQLite-compatible and that ASGI-layer tests
miss due to the coverage gap (HTTP-layer calls do not instrument service
function bodies in pytest-cov when the session is shared across the transport).

Functions under test:
  build_books_export_csv  — SQL query + CSV serialisation
  _parse_csv_bytes        — decode / detect delimiter / parse headers
  _validate_row           — field validation and truncation
  _load_books_for_dedup   — SQL query returning isbn/norm-key maps
  preview_csv_import      — file-size gate, dedup logic, Redis store (mocked)
"""
from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.book import Book, BookProcessingStatus, ReadingStatus
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.location import Location
from app.models.user import User
from app.services.csv_import import (
    EXPORT_COLUMNS,
    MAX_FILE_SIZE,
    _load_books_for_dedup,
    _parse_csv_bytes,
    _validate_row,
    build_books_export_csv,
    preview_csv_import,
)


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
    loc = Location(library_id=library_id, room="Study", furniture="Bookcase", shelf="A1")
    session.add(loc)
    await session.commit()
    await session.refresh(loc)
    return loc


# ── build_books_export_csv ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_build_books_export_csv_empty_library(test_session: AsyncSession) -> None:
    """Empty library → CSV with only the header row."""
    _, lib_id = await _make_library(test_session)
    result = await build_books_export_csv(test_session, lib_id)

    # UTF-8 BOM prefix
    assert result.startswith(b"\xef\xbb\xbf")
    text = result.decode("utf-8-sig")
    lines = [ln for ln in text.splitlines() if ln]
    assert len(lines) == 1  # header only
    assert lines[0] == ",".join(EXPORT_COLUMNS)


@pytest.mark.asyncio
async def test_build_books_export_csv_with_books_and_location(test_session: AsyncSession) -> None:
    """Library with books attached to a location → all 12 columns serialised correctly."""
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    test_session.add(Book(
        library_id=lib_id,
        title="Clean Code",
        author="Robert C. Martin",
        isbn="9780132350884",
        publisher="Prentice Hall",
        language="en",
        publication_year=2008,
        description="A handbook of agile software craftsmanship.",
        reading_status=ReadingStatus.READ,
        processing_status=BookProcessingStatus.MANUAL,
        location_id=loc.id,
        shelf_position=0,
    ))
    await test_session.commit()

    result = await build_books_export_csv(test_session, lib_id)
    text = result.decode("utf-8-sig")
    lines = [ln for ln in text.splitlines() if ln]
    assert len(lines) == 2  # header + 1 book
    row = lines[1]
    assert "Clean Code" in row
    assert "Robert C. Martin" in row
    assert "9780132350884" in row
    assert "Study" in row    # room
    assert "Bookcase" in row  # furniture
    assert "A1" in row        # shelf


@pytest.mark.asyncio
async def test_build_books_export_csv_book_without_location(test_session: AsyncSession) -> None:
    """Book with no location → location columns are empty strings, no crash."""
    _, lib_id = await _make_library(test_session)

    test_session.add(Book(
        library_id=lib_id,
        title="Floating Book",
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    ))
    await test_session.commit()

    result = await build_books_export_csv(test_session, lib_id)
    text = result.decode("utf-8-sig")
    lines = [ln for ln in text.splitlines() if ln]
    assert len(lines) == 2
    # Room / furniture / shelf columns are at the end; they should be empty
    assert "Floating Book" in lines[1]


@pytest.mark.asyncio
async def test_build_books_export_csv_formula_injection_sanitized(test_session: AsyncSession) -> None:
    """Title starting with '=' is prefixed with a single-quote to prevent formula injection."""
    _, lib_id = await _make_library(test_session)

    test_session.add(Book(
        library_id=lib_id,
        title="=DANGEROUS()",
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    ))
    await test_session.commit()

    result = await build_books_export_csv(test_session, lib_id)
    text = result.decode("utf-8-sig")
    assert "'=DANGEROUS()" in text


@pytest.mark.asyncio
async def test_build_books_export_csv_filtered_by_location(test_session: AsyncSession) -> None:
    """location_id filter: only books on that shelf are returned."""
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    test_session.add(Book(
        library_id=lib_id, title="On Shelf",
        location_id=loc.id, shelf_position=0,
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    ))
    test_session.add(Book(
        library_id=lib_id, title="Not On Shelf",
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    ))
    await test_session.commit()

    result = await build_books_export_csv(test_session, lib_id, location_id=loc.id)
    text = result.decode("utf-8-sig")
    lines = [ln for ln in text.splitlines() if ln]
    assert len(lines) == 2
    assert "On Shelf" in lines[1]
    assert "Not On Shelf" not in text


# ── _parse_csv_bytes ──────────────────────────────────────────────────────────

def test_parse_csv_bytes_empty_raises_400() -> None:
    """Completely empty CSV → no header row → HTTPException 400."""
    with pytest.raises(HTTPException) as exc:
        _parse_csv_bytes(b"")
    assert exc.value.status_code == 400


def test_parse_csv_bytes_valid_comma_delimited() -> None:
    """Standard comma-delimited CSV is parsed and headers are normalised."""
    csv_bytes = b"title,author,isbn\nClean Code,Robert Martin,9780132350884\n"
    rows = _parse_csv_bytes(csv_bytes)
    assert len(rows) == 1
    assert rows[0]["title"] == "Clean Code"
    assert rows[0]["author"] == "Robert Martin"
    assert rows[0]["isbn"] == "9780132350884"


def test_parse_csv_bytes_valid_semicolon_delimited() -> None:
    """Semicolon delimiter is auto-detected."""
    csv_bytes = "title;author\nRefactoring;Fowler\n".encode("utf-8")
    rows = _parse_csv_bytes(csv_bytes)
    assert len(rows) == 1
    assert rows[0]["title"] == "Refactoring"


def test_parse_csv_bytes_bom_prefix_stripped() -> None:
    """UTF-8 BOM is stripped so the first header column name is clean."""
    csv_bytes = b"\xef\xbb\xbftitle,author\nBook,Author\n"
    rows = _parse_csv_bytes(csv_bytes)
    assert len(rows) == 1
    assert rows[0]["title"] == "Book"


# ── _validate_row ─────────────────────────────────────────────────────────────

def test_validate_row_missing_title() -> None:
    data, err = _validate_row({"title": ""}, 1)
    assert data is None
    assert err is not None
    assert "title" in err.lower()


def test_validate_row_title_too_long() -> None:
    """Title exceeding 500 chars → error (line 218)."""
    data, err = _validate_row({"title": "x" * 501}, 2)
    assert data is None
    assert err is not None
    assert "500" in err


def test_validate_row_year_out_of_range() -> None:
    """Year outside 0-9999 → error (line 227)."""
    data, err = _validate_row({"title": "T", "publication_year": "10000"}, 3)
    assert data is None
    assert err is not None
    assert "range" in err.lower()


def test_validate_row_year_not_a_number() -> None:
    """Non-numeric year string → error (line 229)."""
    data, err = _validate_row({"title": "T", "publication_year": "abc"}, 4)
    assert data is None
    assert err is not None
    assert "number" in err.lower()


def test_validate_row_invalid_shelf_position_becomes_none() -> None:
    """Non-integer shelf_position is silently ignored (set to None), no error (lines 235-238)."""
    data, err = _validate_row({"title": "T", "shelf_position": "not_a_number"}, 5)
    assert err is None
    assert data is not None
    assert data["shelf_position"] is None


def test_validate_row_author_truncated() -> None:
    """Author longer than 500 chars is truncated to exactly 500 (line 252)."""
    long_author = "A" * 501
    data, err = _validate_row({"title": "T", "author": long_author}, 6)
    assert err is None
    assert data is not None
    assert len(data["author"]) == 500


def test_validate_row_publisher_truncated() -> None:
    """Publisher longer than 300 chars is truncated to exactly 300 (line 256)."""
    long_publisher = "P" * 301
    data, err = _validate_row({"title": "T", "publisher": long_publisher}, 7)
    assert err is None
    assert data is not None
    assert len(data["publisher"]) == 300


def test_validate_row_language_truncated() -> None:
    """Language longer than 10 chars is truncated to exactly 10 (line 260)."""
    data, err = _validate_row({"title": "T", "language": "toolonglang"}, 8)
    assert err is None
    assert data is not None
    assert len(data["language"]) == 10


def test_validate_row_success_full_row() -> None:
    """All valid fields → success, correct types."""
    data, err = _validate_row({
        "title": "Clean Code",
        "author": "R. Martin",
        "isbn": "9780132350884",
        "publisher": "Prentice Hall",
        "language": "en",
        "publication_year": "2008",
        "description": "A great book.",
        "reading_status": "read",
        "room": "Office",
        "furniture": "Bookcase",
        "shelf": "Top",
        "shelf_position": "3",
    }, 1)
    assert err is None
    assert data is not None
    assert data["title"] == "Clean Code"
    assert data["publication_year"] == 2008
    assert data["shelf_position"] == 3
    assert data["reading_status"] == "read"


def test_validate_row_unknown_reading_status_becomes_unread() -> None:
    """Unrecognised reading_status is mapped to 'unread'."""
    data, err = _validate_row({"title": "T", "reading_status": "whatever"}, 9)
    assert err is None
    assert data is not None
    assert data["reading_status"] == "unread"


# ── _load_books_for_dedup ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_load_books_for_dedup_empty_library(test_session: AsyncSession) -> None:
    """Empty library → both maps are empty dicts."""
    _, lib_id = await _make_library(test_session)
    by_isbn, by_norm = await _load_books_for_dedup(test_session, lib_id)
    assert by_isbn == {}
    assert by_norm == {}


@pytest.mark.asyncio
async def test_load_books_for_dedup_with_isbn(test_session: AsyncSession) -> None:
    """Book with ISBN appears in by_isbn; all books appear in by_norm."""
    _, lib_id = await _make_library(test_session)
    loc = await _make_location(test_session, lib_id)

    book = Book(
        library_id=lib_id,
        title="Clean Code",
        author="R. Martin",
        isbn="9780132350884",
        location_id=loc.id,
        shelf_position=0,
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    )
    test_session.add(book)
    await test_session.commit()
    await test_session.refresh(book)

    by_isbn, by_norm = await _load_books_for_dedup(test_session, lib_id)
    assert "9780132350884" in by_isbn
    assert by_isbn["9780132350884"] == book.id
    # at least one entry in by_norm
    assert len(by_norm) >= 1


@pytest.mark.asyncio
async def test_load_books_for_dedup_book_without_isbn(test_session: AsyncSession) -> None:
    """Book with no ISBN is absent from by_isbn but present in by_norm."""
    _, lib_id = await _make_library(test_session)

    book = Book(
        library_id=lib_id,
        title="No ISBN Book",
        author="Anonymous",
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    )
    test_session.add(book)
    await test_session.commit()
    await test_session.refresh(book)

    by_isbn, by_norm = await _load_books_for_dedup(test_session, lib_id)
    assert by_isbn == {}
    assert len(by_norm) == 1


# ── preview_csv_import ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_preview_csv_import_file_too_large(test_session: AsyncSession) -> None:
    """File that exceeds MAX_FILE_SIZE raises HTTP 413 before any parsing (line 358)."""
    _, lib_id = await _make_library(test_session)
    oversized = b"x" * (MAX_FILE_SIZE + 1)
    with pytest.raises(HTTPException) as exc:
        await preview_csv_import(oversized, lib_id, test_session, None)  # type: ignore[arg-type]
    assert exc.value.status_code == 413


@pytest.mark.asyncio
async def test_preview_csv_import_no_data_rows_raises_400(test_session: AsyncSession) -> None:
    """CSV with header but zero data rows raises HTTP 400 (line 367)."""
    _, lib_id = await _make_library(test_session)
    header_only = b"title,author\n"  # valid header, no data rows
    with pytest.raises(HTTPException) as exc:
        await preview_csv_import(header_only, lib_id, test_session, None)  # type: ignore[arg-type]
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_preview_csv_import_happy_path(test_session: AsyncSession) -> None:
    """Valid CSV → dedup check → Redis store (mocked) → preview response returned.

    Covers the main body of preview_csv_import (lines 374-427): row validation
    loop, _find_existing_id, mock redis.set, preview-row construction, and the
    CsvImportPreviewResponse return value.
    """
    _, lib_id = await _make_library(test_session)
    csv_bytes = (
        b"title,author,isbn,publication_year\n"
        b"Clean Code,R. Martin,9780132350884,2008\n"
        b"Refactoring,,Invalid-ISBN,\n"           # bad ISBN → isbn=None, still valid
        b"Bad Row,,,(also bad year)\n"             # invalid year → row error
    )

    mock_redis = MagicMock()
    mock_redis.set = AsyncMock()

    result = await preview_csv_import(csv_bytes, lib_id, test_session, mock_redis)

    assert result.import_token is not None
    assert len(result.import_token) > 0
    # Two valid rows ("Clean Code" and "Refactoring"), one error row
    assert result.summary.total_rows == 3
    assert result.summary.valid_rows == 2
    assert result.summary.invalid_rows == 1
    assert result.summary.would_create == 2   # no existing books → all creates
    assert result.summary.would_update == 0
    mock_redis.set.assert_called_once()


@pytest.mark.asyncio
async def test_preview_csv_import_dedup_detects_existing_isbn(test_session: AsyncSession) -> None:
    """Row matching an existing book's ISBN → would_update increments (line 388)."""
    _, lib_id = await _make_library(test_session)

    # Pre-existing book with known ISBN
    test_session.add(Book(
        library_id=lib_id,
        title="Old Title",
        isbn="9780132350884",
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    ))
    await test_session.commit()

    csv_bytes = b"title,isbn\nUpdated Title,9780132350884\n"
    mock_redis = MagicMock()
    mock_redis.set = AsyncMock()

    result = await preview_csv_import(csv_bytes, lib_id, test_session, mock_redis)

    assert result.summary.would_update == 1
    assert result.summary.would_create == 0
