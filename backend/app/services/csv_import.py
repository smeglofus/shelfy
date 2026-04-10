"""CSV import/export service for Shelfy books.

Export:
  build_books_export_csv — streams all library books (optionally filtered by
  location) as a UTF-8 BOM CSV with individual location columns.

Import (2-step):
  preview_csv_import  — parse, validate, dedup-check; stores parsed rows in
                        Redis under a short-lived token; returns preview summary.
  confirm_csv_import  — re-reads stored rows, applies upsert/create-only logic
                        transactionally, optionally auto-creates locations.
"""
from __future__ import annotations

import csv
import json
import re
import unicodedata
import uuid
from io import StringIO
from typing import Any

import redis.asyncio as aioredis
import structlog
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book, ReadingStatus
from app.models.loan import Loan
from app.models.location import Location
from app.schemas.book import (
    CsvImportConfirmRequest,
    CsvImportConfirmResponse,
    CsvImportError,
    CsvImportPreviewResponse,
    CsvImportSummary,
    CsvPreviewRow,
)

logger = structlog.get_logger()

# ── Constants ─────────────────────────────────────────────────────────────────

_IMPORT_KEY_PREFIX = "csv_import"
_IMPORT_TTL = 600           # 10 minutes
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
PREVIEW_ROWS_COUNT = 10

# CSV column order for export
EXPORT_COLUMNS = [
    "title", "author", "isbn", "publisher", "language",
    "publication_year", "description", "reading_status",
    "room", "furniture", "shelf", "shelf_position",
]

# Characters that Excel interprets as formula starters
_FORMULA_STARTERS = frozenset({"=", "+", "-", "@", "|", "%"})

# Header synonyms → canonical field name
_HEADER_MAP: dict[str, str] = {
    # title
    "title": "title", "name": "title", "book_title": "title",
    "název": "title", "nazev": "title",
    # author
    "author": "author", "authors": "author", "autor": "author",
    # isbn
    "isbn": "isbn", "isbn_10": "isbn", "isbn_13": "isbn",
    "isbn10": "isbn", "isbn13": "isbn",
    # publisher
    "publisher": "publisher", "vydavatel": "publisher",
    # language
    "language": "language", "lang": "language", "jazyk": "language",
    # publication_year
    "publication_year": "publication_year", "year": "publication_year",
    "pub_year": "publication_year", "published_year": "publication_year",
    "rok_vydani": "publication_year", "rok vydání": "publication_year",
    # description
    "description": "description", "desc": "description", "popis": "description",
    # reading_status
    "reading_status": "reading_status", "status": "reading_status",
    "stav_cteni": "reading_status", "stav čtení": "reading_status",
    # location hierarchy
    "room": "room", "pokoj": "room",
    "furniture": "furniture", "nabytek": "furniture", "nábytek": "furniture",
    "shelf": "shelf", "policka": "shelf", "polička": "shelf",
    "shelf_position": "shelf_position", "position": "shelf_position",
    "pozice": "shelf_position",
}

_VALID_READING_STATUSES = frozenset(s.value for s in ReadingStatus)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _sanitize_export_cell(value: str) -> str:
    """Prefix formula-injection dangerous values with a single quote (Excel-safe)."""
    if value and value[0] in _FORMULA_STARTERS:
        return "'" + value
    return value


def _normalize_header(raw: str) -> str:
    """Strip BOM/whitespace, lowercase, NFC-normalize, then look up synonym map."""
    cleaned = raw.strip().lstrip("\ufeff").lower()
    cleaned = unicodedata.normalize("NFC", cleaned)
    return _HEADER_MAP.get(cleaned, cleaned)


def _detect_delimiter(first_line: str) -> str:
    return ";" if first_line.count(";") > first_line.count(",") else ","


def _normalize_text(text: str | None) -> str:
    """Lowercase, strip, collapse whitespace — used for fuzzy dedup matching."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", text.strip().lower())


def _parse_isbn(raw: str) -> str | None:
    """Strip hyphens/spaces; return cleaned ISBN-10/13 or None if malformed."""
    cleaned = re.sub(r"[-\s]", "", raw.strip())
    return cleaned if len(cleaned) in (10, 13) else None


# ── Export ────────────────────────────────────────────────────────────────────

async def build_books_export_csv(
    session: AsyncSession,
    library_id: uuid.UUID,
    location_id: uuid.UUID | None = None,
) -> bytes:
    """Return UTF-8 BOM CSV bytes for all books in *library_id*.

    Columns: title, author, isbn, publisher, language, publication_year,
    description, reading_status, room, furniture, shelf, shelf_position.
    Formula-injection dangerous values are prefixed with a single quote.
    """
    filters = [Book.library_id == library_id]
    if location_id is not None:
        filters.append(Book.location_id == location_id)

    result = await session.execute(
        select(Book, Location)
        .where(*filters)
        .outerjoin(Location, Book.location_id == Location.id)
        .order_by(Book.created_at.desc(), Book.id.desc())
    )
    rows = result.all()

    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(EXPORT_COLUMNS)

    for book, location in rows:
        reading_status_val = ""
        if book.reading_status is not None:
            reading_status_val = book.reading_status.value if hasattr(book.reading_status, "value") else str(book.reading_status)

        def _cell(v: Any) -> str:
            return _sanitize_export_cell(str(v)) if v is not None and str(v) else ""

        writer.writerow([
            _cell(book.title),
            _cell(book.author),
            _cell(book.isbn),
            _cell(book.publisher),
            _cell(book.language),
            _cell(book.publication_year),
            _cell(book.description),
            _cell(reading_status_val),
            _cell(location.room if location else None),
            _cell(location.furniture if location else None),
            _cell(location.shelf if location else None),
            _cell(book.shelf_position),
        ])

    # UTF-8 BOM for Excel compatibility
    return b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")


# ── Import — parse & validate ─────────────────────────────────────────────────

def _parse_csv_bytes(file_bytes: bytes) -> list[dict[str, str]]:
    """Decode (UTF-8 BOM-safe), detect delimiter, parse, normalise headers."""
    content = file_bytes.decode("utf-8-sig", errors="replace")
    first_line = content.split("\n")[0] if "\n" in content else content
    delimiter = _detect_delimiter(first_line)

    reader = csv.DictReader(StringIO(content), delimiter=delimiter)
    if not reader.fieldnames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV has no header row or could not be parsed.",
        )

    rows: list[dict[str, str]] = []
    for raw_row in reader:
        normalized: dict[str, str] = {
            _normalize_header(k): (v or "").strip()
            for k, v in raw_row.items()
        }
        rows.append(normalized)

    return rows


def _validate_row(
    row: dict[str, str], row_num: int
) -> tuple[dict[str, Any] | None, str | None]:
    """Return (cleaned_data, None) on success or (None, error_message) on failure."""
    title = row.get("title", "").strip()
    if not title:
        return None, f"Row {row_num}: missing required field 'title'"
    if len(title) > 500:
        return None, f"Row {row_num}: title exceeds 500 characters"

    # publication_year
    publication_year: int | None = None
    year_str = row.get("publication_year", "").strip()
    if year_str:
        try:
            publication_year = int(year_str)
            if not (0 <= publication_year <= 9999):
                return None, f"Row {row_num}: publication_year out of range (0–9999)"
        except ValueError:
            return None, f"Row {row_num}: publication_year must be a number, got '{year_str}'"

    # shelf_position (non-fatal — skip if invalid)
    shelf_position: int | None = None
    pos_str = row.get("shelf_position", "").strip()
    if pos_str:
        try:
            shelf_position = int(pos_str)
        except ValueError:
            shelf_position = None

    # reading_status — default to unread if unrecognised
    rs_raw = row.get("reading_status", "").strip().lower() or None
    reading_status = rs_raw if rs_raw in _VALID_READING_STATUSES else ("unread" if rs_raw else None)

    # ISBN normalisation
    isbn: str | None = None
    isbn_raw = row.get("isbn", "").strip()
    if isbn_raw:
        isbn = _parse_isbn(isbn_raw)

    author = (row.get("author", "").strip() or None)
    if author and len(author) > 500:
        author = author[:500]

    publisher = (row.get("publisher", "").strip() or None)
    if publisher and len(publisher) > 300:
        publisher = publisher[:300]

    language = (row.get("language", "").strip() or None)
    if language and len(language) > 10:
        language = language[:10]

    description = row.get("description", "").strip() or None
    room = row.get("room", "").strip() or None
    furniture = row.get("furniture", "").strip() or None
    shelf = row.get("shelf", "").strip() or None

    return {
        "title": title,
        "author": author,
        "isbn": isbn,
        "publisher": publisher,
        "language": language,
        "publication_year": publication_year,
        "description": description,
        "reading_status": reading_status or "unread",
        "room": room,
        "furniture": furniture,
        "shelf": shelf,
        "shelf_position": shelf_position,
    }, None


# ── Import — dedup helpers ────────────────────────────────────────────────────

def _make_norm_key(
    title: str | None,
    author: str | None,
    room: str | None,
    furniture: str | None,
    shelf: str | None,
) -> str:
    """Composite identity key for fallback dedup (no ISBN).

    Includes the full location hierarchy so that two physical copies of the
    same book on *different* shelves are treated as distinct entries.

    shelf_position is intentionally excluded: it is an ordering field that
    can change when books are reordered, not a stable identity attribute.
    """
    return "|".join([
        _normalize_text(title),
        _normalize_text(author),
        _normalize_text(room),
        _normalize_text(furniture),
        _normalize_text(shelf),
    ])


async def _load_books_for_dedup(
    session: AsyncSession, library_id: uuid.UUID
) -> tuple[dict[str, uuid.UUID], dict[str, uuid.UUID]]:
    """Return (by_isbn, by_normalized_key) maps of existing book IDs.

    The normalised key incorporates the location hierarchy (room/furniture/shelf)
    so that duplicate titles on different shelves are not confused.
    """
    result = await session.execute(
        select(Book.id, Book.isbn, Book.title, Book.author,
               Location.room, Location.furniture, Location.shelf)
        .where(Book.library_id == library_id)
        .outerjoin(Location, Book.location_id == Location.id)
    )
    by_isbn: dict[str, uuid.UUID] = {}
    by_norm: dict[str, uuid.UUID] = {}
    for book_id, isbn, title, author, room, furniture, shelf in result.all():
        if isbn:
            by_isbn[isbn] = book_id
        norm_key = _make_norm_key(title, author, room, furniture, shelf)
        by_norm[norm_key] = book_id
    return by_isbn, by_norm


def _find_existing_id(
    row: dict[str, Any],
    by_isbn: dict[str, uuid.UUID],
    by_norm: dict[str, uuid.UUID],
) -> uuid.UUID | None:
    # Primary: ISBN match (unambiguous within a library)
    if row.get("isbn") and row["isbn"] in by_isbn:
        return by_isbn[row["isbn"]]
    # Fallback: title + author + location hierarchy
    key = _make_norm_key(
        row.get("title"), row.get("author"),
        row.get("room"), row.get("furniture"), row.get("shelf"),
    )
    return by_norm.get(key)


# ── Import — Preview ──────────────────────────────────────────────────────────

async def preview_csv_import(
    file_bytes: bytes,
    library_id: uuid.UUID,
    session: AsyncSession,
    redis_client: aioredis.Redis,
) -> CsvImportPreviewResponse:
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"CSV file too large (max {MAX_FILE_SIZE // 1_048_576} MB).",
        )
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file.")

    raw_rows = _parse_csv_bytes(file_bytes)
    if not raw_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV contains no data rows.",
        )

    by_isbn, by_norm = await _load_books_for_dedup(session, library_id)

    errors: list[CsvImportError] = []
    valid_rows: list[dict[str, Any]] = []
    would_create = 0
    would_update = 0

    for i, raw in enumerate(raw_rows, start=2):  # row 1 = header
        cleaned, err = _validate_row(raw, i)
        if err:
            errors.append(CsvImportError(row=i, error=err))
            continue

        existing_id = _find_existing_id(cleaned, by_isbn, by_norm)  # type: ignore[arg-type]
        if existing_id is not None:
            cleaned["_existing_id"] = str(existing_id)  # type: ignore[index]
            would_update += 1
        else:
            would_create += 1

        valid_rows.append(cleaned)

    # Store in Redis with library-scoped key (prevents cross-library token reuse)
    import_token = uuid.uuid4().hex
    redis_key = f"{_IMPORT_KEY_PREFIX}:{library_id}:{import_token}"
    await redis_client.set(redis_key, json.dumps(valid_rows), ex=_IMPORT_TTL)

    total = len(raw_rows)
    invalid = len(errors)

    preview_rows = [
        CsvPreviewRow(
            title=r["title"],
            author=r.get("author"),
            isbn=r.get("isbn"),
            publisher=r.get("publisher"),
            language=r.get("language"),
            publication_year=r.get("publication_year"),
            description=r.get("description"),
            reading_status=r.get("reading_status"),
            room=r.get("room"),
            furniture=r.get("furniture"),
            shelf=r.get("shelf"),
            shelf_position=r.get("shelf_position"),
        )
        for r in valid_rows[:PREVIEW_ROWS_COUNT]
    ]

    logger.info(
        "csv_import_preview",
        library_id=str(library_id),
        total=total, valid=len(valid_rows),
        invalid=invalid, would_create=would_create, would_update=would_update,
    )

    return CsvImportPreviewResponse(
        import_token=import_token,
        expires_in=_IMPORT_TTL,
        summary=CsvImportSummary(
            total_rows=total,
            valid_rows=len(valid_rows),
            invalid_rows=invalid,
            would_create=would_create,
            would_update=would_update,
            would_skip=invalid,
        ),
        errors=errors,
        preview_rows=preview_rows,
    )


# ── Import — Confirm ──────────────────────────────────────────────────────────

async def confirm_csv_import(
    import_token: str,
    library_id: uuid.UUID,
    session: AsyncSession,
    redis_client: aioredis.Redis,
    options: CsvImportConfirmRequest,
) -> CsvImportConfirmResponse:
    redis_key = f"{_IMPORT_KEY_PREFIX}:{library_id}:{import_token}"
    stored = await redis_client.getdel(redis_key)

    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Import token is invalid or has expired. Please re-upload the CSV.",
        )

    rows: list[dict[str, Any]] = json.loads(stored)

    # Re-read current state for deduplication (covers concurrent imports)
    by_isbn, by_norm = await _load_books_for_dedup(session, library_id)

    # Load existing locations for lookup
    loc_result = await session.execute(
        select(Location).where(Location.library_id == library_id)
    )
    location_cache: dict[tuple[str, str, str], uuid.UUID] = {
        (loc.room.lower(), loc.furniture.lower(), loc.shelf.lower()): loc.id
        for loc in loc_result.scalars().all()
    }

    created = updated = skipped = errors = 0
    warnings: list[str] = []

    for row in rows:
        existing_id_str: str | None = row.pop("_existing_id", None)

        # ── Resolve location ─────────────────────────────────────────────────
        location_id: uuid.UUID | None = None
        room = row.get("room")
        furniture = row.get("furniture")
        shelf = row.get("shelf")

        if room and furniture and shelf:
            loc_key = (room.lower(), furniture.lower(), shelf.lower())
            if loc_key in location_cache:
                location_id = location_cache[loc_key]
            elif options.create_missing_locations:
                try:
                    async with session.begin_nested():
                        new_loc = Location(
                            library_id=library_id, room=room,
                            furniture=furniture, shelf=shelf,
                        )
                        session.add(new_loc)
                        await session.flush()
                        await session.refresh(new_loc)
                    location_id = new_loc.id
                    location_cache[loc_key] = new_loc.id
                    logger.info(
                        "csv_import_location_created",
                        room=room, furniture=furniture, shelf=shelf,
                    )
                except Exception as exc:
                    warnings.append(f"Could not create location {room}/{furniture}/{shelf}: {exc}")

        # ── Determine reading_status ─────────────────────────────────────────
        rs_val = row.get("reading_status", "unread")
        try:
            reading_status = ReadingStatus(rs_val)
        except ValueError:
            reading_status = ReadingStatus.UNREAD

        # ── Upsert / create logic ────────────────────────────────────────────
        if existing_id_str is not None:
            # ---- UPDATE path ------------------------------------------------
            if options.mode == "create_only" or options.on_conflict == "skip":
                skipped += 1
                continue

            try:
                async with session.begin_nested():
                    book = await session.get(Book, uuid.UUID(existing_id_str))
                    if book is None or book.library_id != library_id:
                        skipped += 1
                        continue

                    # Only overwrite non-None incoming values
                    update_map = {
                        "author": row.get("author"),
                        "isbn": row.get("isbn"),
                        "publisher": row.get("publisher"),
                        "language": row.get("language"),
                        "publication_year": row.get("publication_year"),
                        "description": row.get("description"),
                        "reading_status": reading_status,
                        "location_id": location_id,
                        "shelf_position": row.get("shelf_position"),
                    }
                    for field, value in update_map.items():
                        if value is not None:
                            setattr(book, field, value)

                updated += 1
            except IntegrityError:
                skipped += 1
                warnings.append(
                    f"Skipped update for '{row['title']}': ISBN conflict with existing book."
                )
            except Exception as exc:
                errors += 1
                logger.warning("csv_import_update_error", title=row.get("title"), error=str(exc))

        else:
            # ---- CREATE path ------------------------------------------------
            try:
                async with session.begin_nested():
                    book = Book(
                        library_id=library_id,
                        title=row["title"],
                        author=row.get("author"),
                        isbn=row.get("isbn"),
                        publisher=row.get("publisher"),
                        language=row.get("language"),
                        publication_year=row.get("publication_year"),
                        description=row.get("description"),
                        reading_status=reading_status,
                        location_id=location_id,
                        shelf_position=row.get("shelf_position"),
                    )
                    session.add(book)
                    await session.flush()

                created += 1
            except IntegrityError:
                skipped += 1
                warnings.append(
                    f"Skipped '{row['title']}': ISBN already exists in this library."
                )
            except Exception as exc:
                errors += 1
                logger.warning("csv_import_create_error", title=row.get("title"), error=str(exc))

    await session.commit()

    logger.info(
        "csv_import_confirmed",
        library_id=str(library_id),
        created=created, updated=updated, skipped=skipped, errors=errors,
    )

    return CsvImportConfirmResponse(
        created=created,
        updated=updated,
        skipped=skipped,
        errors=errors,
        warnings=warnings,
    )
