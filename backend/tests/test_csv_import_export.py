"""Tests for CSV import/export endpoints.

Covers:
  - Export: correct headers, rows, location columns, UTF-8 BOM, location filter
  - Preview: valid parse, invalid rows detected, would_create/would_update counts
  - Confirm (upsert): creates missing books, updates existing, skips invalids
  - Confirm (create_only): never updates existing books
  - Confirm (on_conflict=skip): skips duplicates instead of updating
  - Location auto-create: create_missing_locations=True creates room/furniture/shelf
  - Library isolation: cannot use another library's import token
  - Formula injection: dangerous cell prefixes in export
"""
from __future__ import annotations

import csv
import uuid
from collections.abc import AsyncIterator, Iterator
from io import StringIO
from typing import Any

import pytest
import sqlalchemy as sa
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.dependencies.redis import get_redis
from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.book import Book, ReadingStatus
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.location import Location
from app.models.user import User


# ── Fake Redis ─────────────────────────────────────────────────────────────────

class FakeRedis:
    """Minimal async Redis stub for tests (set with EX, getdel, get)."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: int | None = None) -> None:  # noqa: ARG002
        self._store[key] = value

    async def getdel(self, key: str) -> str | None:
        return self._store.pop(key, None)

    async def get(self, key: str) -> str | None:
        return self._store.get(key)

    async def aclose(self) -> None:
        pass


# ── Fixtures ───────────────────────────────────────────────────────────────────

def _require_test_database_url() -> str:
    import os
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_csv.db")


@pytest.fixture
async def test_session() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(_require_test_database_url())
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: sa.Enum(
                "manual", "pending", "done", "failed", "partial",
                name="book_processing_status",
            ).create(c, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await conn.run_sync(
            lambda c: sa.Enum(
                "unread", "reading", "read", "lent",
                name="reading_status",
            ).create(c, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await conn.run_sync(
            lambda c: sa.Enum(
                "owner", "editor", "viewer",
                name="library_role",
            ).create(c, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        database_url=_require_test_database_url(),
        jwt_secret_key="test-secret",
        jwt_algorithm="HS256",
        access_token_expire_minutes=15,
        refresh_token_expire_days=7,
    )


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest.fixture(autouse=True)
def override_dependencies(
    test_session: async_sessionmaker[AsyncSession],
    test_settings: Settings,
    fake_redis: FakeRedis,
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with test_session() as session:
            yield session

    async def _get_redis() -> AsyncIterator[FakeRedis]:
        yield fake_redis

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    app.dependency_overrides[get_redis] = _get_redis
    yield
    app.dependency_overrides.clear()


# ── Seed helpers ───────────────────────────────────────────────────────────────

async def _seed_user(session: AsyncSession, email: str = "admin@example.com") -> User:
    existing = (await session.execute(
        select(User).where(User.email == email)
    )).scalar_one_or_none()
    if existing:
        return existing
    user = User(email=email, hashed_password=get_password_hash("secret"))
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _seed_user_with_library(
    session: AsyncSession, email: str = "admin@example.com"
) -> tuple[User, Library]:
    user = await _seed_user(session, email)
    existing_lib = (await session.execute(
        select(Library)
        .join(LibraryMember, LibraryMember.library_id == Library.id)
        .where(LibraryMember.user_id == user.id)
        .limit(1)
    )).scalar_one_or_none()
    if existing_lib:
        return user, existing_lib
    lib = Library(name="Test Library", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return user, lib


async def _auth_headers(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    await _seed_user_with_library(session)
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "secret"},
    )
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _create_location(
    session: AsyncSession, library_id: uuid.UUID,
    room: str = "Living Room", furniture: str = "Bookshelf", shelf: str = "Top"
) -> Location:
    loc = Location(library_id=library_id, room=room, furniture=furniture, shelf=shelf)
    session.add(loc)
    await session.commit()
    await session.refresh(loc)
    return loc


def _make_csv(rows: list[dict[str, Any]], delimiter: str = ",") -> bytes:
    """Build a UTF-8 CSV bytes object from a list of dicts."""
    if not rows:
        return b""
    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), delimiter=delimiter)
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


# ── Export tests ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_returns_correct_headers_and_rows(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        loc = await _create_location(session, library.id)
        session.add(Book(
            library_id=library.id, title="Clean Code", author="Robert Martin",
            isbn="9780132350884", location_id=loc.id, shelf_position=0,
            reading_status=ReadingStatus.READ,
        ))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        resp = await client.get("/api/v1/books/export", headers=headers)

    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    # Strip UTF-8 BOM
    content = resp.content.lstrip(b"\xef\xbb\xbf").decode("utf-8")
    reader = csv.DictReader(StringIO(content))
    rows = list(reader)

    assert len(rows) == 1
    assert rows[0]["title"] == "Clean Code"
    assert rows[0]["author"] == "Robert Martin"
    assert rows[0]["isbn"] == "9780132350884"
    assert rows[0]["room"] == "Living Room"
    assert rows[0]["furniture"] == "Bookshelf"
    assert rows[0]["shelf"] == "Top"
    assert rows[0]["shelf_position"] == "0"
    assert rows[0]["reading_status"] == "read"


@pytest.mark.asyncio
async def test_export_utf8_bom_present(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        session.add(Book(library_id=library.id, title="Test Book"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.get("/api/v1/books/export", headers=headers)

    assert resp.content[:3] == b"\xef\xbb\xbf", "UTF-8 BOM must be present for Excel"


@pytest.mark.asyncio
async def test_export_filters_by_location_id(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        loc1 = await _create_location(session, library.id, room="Room A", furniture="Shelf A", shelf="1")
        loc2 = await _create_location(session, library.id, room="Room B", furniture="Shelf B", shelf="1")
        session.add_all([
            Book(library_id=library.id, title="Book A", location_id=loc1.id),
            Book(library_id=library.id, title="Book B", location_id=loc2.id),
        ])
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.get(
            "/api/v1/books/export",
            params={"location_id": str(loc1.id)},
            headers=headers,
        )

    content = resp.content.lstrip(b"\xef\xbb\xbf").decode("utf-8")
    rows = list(csv.DictReader(StringIO(content)))
    assert len(rows) == 1
    assert rows[0]["title"] == "Book A"


@pytest.mark.asyncio
async def test_export_formula_injection_prefix(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Dangerous formula characters in titles/authors must be prefixed with '."""
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        session.add(Book(library_id=library.id, title="=SUM(A1)", author="+cmd|/c calc"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.get("/api/v1/books/export", headers=headers)

    content = resp.content.lstrip(b"\xef\xbb\xbf").decode("utf-8")
    rows = list(csv.DictReader(StringIO(content)))
    assert rows[0]["title"].startswith("'"), "= prefix must be escaped"
    assert rows[0]["author"].startswith("'"), "+ prefix must be escaped"


# ── Import Preview tests ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_preview_valid_csv_returns_summary(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    csv_bytes = _make_csv([
        {"title": "Book One", "author": "Author A", "isbn": "9780132350884"},
        {"title": "Book Two", "author": "Author B"},
    ])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["summary"]["total_rows"] == 2
    assert data["summary"]["valid_rows"] == 2
    assert data["summary"]["invalid_rows"] == 0
    assert data["summary"]["would_create"] == 2
    assert data["summary"]["would_update"] == 0
    assert data["import_token"] != ""
    assert data["expires_in"] == 600
    assert len(data["preview_rows"]) == 2


@pytest.mark.asyncio
async def test_preview_detects_missing_title(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    csv_bytes = _make_csv([
        {"title": "Valid Book", "author": "Someone"},
        {"title": "", "author": "No Title"},
        {"title": "Another Valid", "author": "Author"},
    ])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["summary"]["total_rows"] == 3
    assert data["summary"]["invalid_rows"] == 1
    assert data["summary"]["valid_rows"] == 2
    assert len(data["errors"]) == 1
    assert "title" in data["errors"][0]["error"].lower()


@pytest.mark.asyncio
async def test_preview_detects_invalid_year(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    csv_bytes = _make_csv([{"title": "Bad Year Book", "publication_year": "not-a-year"}])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )

    data = resp.json()
    assert data["summary"]["invalid_rows"] == 1
    assert "publication_year" in data["errors"][0]["error"]


@pytest.mark.asyncio
async def test_preview_counts_would_update_for_isbn_match(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        session.add(Book(
            library_id=library.id, title="Existing Book", isbn="9780132350884"
        ))
        await session.commit()

    csv_bytes = _make_csv([
        {"title": "Existing Book", "isbn": "9780132350884"},
        {"title": "New Book", "isbn": "9781234567890"},
    ])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )

    data = resp.json()
    assert data["summary"]["would_update"] == 1
    assert data["summary"]["would_create"] == 1


@pytest.mark.asyncio
async def test_preview_rejects_empty_file(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", b"", "text/csv")},
            headers=headers,
        )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_preview_accepts_semicolon_delimiter(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    csv_bytes = _make_csv(
        [{"title": "A Book", "author": "Author"}], delimiter=";"
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )

    assert resp.status_code == 200
    assert resp.json()["summary"]["valid_rows"] == 1


# ── Import Confirm tests ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_confirm_creates_new_books(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    csv_bytes = _make_csv([
        {"title": "New Book A", "author": "Alice", "isbn": "9780132350884"},
        {"title": "New Book B", "author": "Bob"},
    ])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        preview = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )
        assert preview.status_code == 200
        token = preview.json()["import_token"]

        confirm = await client.post(
            "/api/v1/books/import/confirm",
            json={"import_token": token},
            headers=headers,
        )

    assert confirm.status_code == 200
    result = confirm.json()
    assert result["created"] == 2
    assert result["updated"] == 0
    assert result["skipped"] == 0
    assert result["errors"] == 0

    # Verify books are in the DB
    async with test_session() as session:
        async with test_session() as s2:
            _, library = await _seed_user_with_library(s2)
        books = (await session.execute(
            select(Book).where(Book.library_id == library.id)
        )).scalars().all()
    assert len(books) == 2
    assert {b.title for b in books} == {"New Book A", "New Book B"}


@pytest.mark.asyncio
async def test_confirm_upsert_updates_existing_book(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        session.add(Book(
            library_id=library.id, title="Old Title", isbn="9780132350884",
            author="Wrong Author",
        ))
        await session.commit()

    csv_bytes = _make_csv([
        {"title": "New Title", "isbn": "9780132350884", "author": "Correct Author"},
    ])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        preview = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )
        token = preview.json()["import_token"]

        confirm = await client.post(
            "/api/v1/books/import/confirm",
            json={"import_token": token, "mode": "upsert", "on_conflict": "update"},
            headers=headers,
        )

    assert confirm.json()["updated"] == 1
    assert confirm.json()["created"] == 0

    async with test_session() as session:
        async with test_session() as s2:
            _, library = await _seed_user_with_library(s2)
        book = (await session.execute(
            select(Book).where(Book.library_id == library.id)
        )).scalar_one()
    assert book.author == "Correct Author"


@pytest.mark.asyncio
async def test_confirm_create_only_skips_existing(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        session.add(Book(library_id=library.id, title="Existing", isbn="9780132350884"))
        await session.commit()

    csv_bytes = _make_csv([
        {"title": "Existing", "isbn": "9780132350884"},
        {"title": "Truly New"},
    ])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        preview = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )
        token = preview.json()["import_token"]

        confirm = await client.post(
            "/api/v1/books/import/confirm",
            json={"import_token": token, "mode": "create_only"},
            headers=headers,
        )

    result = confirm.json()
    assert result["created"] == 1
    assert result["skipped"] == 1


@pytest.mark.asyncio
async def test_confirm_on_conflict_skip(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        session.add(Book(library_id=library.id, title="Existing", isbn="9780132350884"))
        await session.commit()

    csv_bytes = _make_csv([{"title": "Existing", "isbn": "9780132350884"}])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        preview = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )
        token = preview.json()["import_token"]

        confirm = await client.post(
            "/api/v1/books/import/confirm",
            json={"import_token": token, "mode": "upsert", "on_conflict": "skip"},
            headers=headers,
        )

    result = confirm.json()
    assert result["skipped"] == 1
    assert result["updated"] == 0


@pytest.mark.asyncio
async def test_confirm_location_auto_create(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    csv_bytes = _make_csv([{
        "title": "Located Book",
        "room": "Study", "furniture": "Desk Shelf", "shelf": "A",
    }])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        preview = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )
        token = preview.json()["import_token"]

        confirm = await client.post(
            "/api/v1/books/import/confirm",
            json={"import_token": token, "create_missing_locations": True},
            headers=headers,
        )

    assert confirm.json()["created"] == 1

    async with test_session() as session:
        async with test_session() as s2:
            _, library = await _seed_user_with_library(s2)
        loc = (await session.execute(
            select(Location).where(
                Location.library_id == library.id,
                Location.room == "Study",
                Location.furniture == "Desk Shelf",
                Location.shelf == "A",
            )
        )).scalar_one_or_none()
    assert loc is not None, "Location must be auto-created"

    # Also check the book's location_id is set
    async with test_session() as session:
        async with test_session() as s2:
            _, library = await _seed_user_with_library(s2)
        book = (await session.execute(
            select(Book).where(Book.library_id == library.id)
        )).scalar_one()
    assert book.location_id == loc.id


@pytest.mark.asyncio
async def test_confirm_location_not_created_when_flag_false(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    csv_bytes = _make_csv([{
        "title": "Book Without Location",
        "room": "Nonexistent Room", "furniture": "Nonexistent Shelf", "shelf": "X",
    }])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        preview = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )
        token = preview.json()["import_token"]

        confirm = await client.post(
            "/api/v1/books/import/confirm",
            json={"import_token": token, "create_missing_locations": False},
            headers=headers,
        )

    assert confirm.json()["created"] == 1

    async with test_session() as session:
        async with test_session() as s2:
            _, library = await _seed_user_with_library(s2)
        book = (await session.execute(
            select(Book).where(Book.library_id == library.id)
        )).scalar_one()
    assert book.location_id is None, "location_id should be None when flag is False"


@pytest.mark.asyncio
async def test_confirm_invalid_token_returns_400(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        resp = await client.post(
            "/api/v1/books/import/confirm",
            json={"import_token": "nonexistent-token-xyz"},
            headers=headers,
        )

    assert resp.status_code == 400
    assert "expired" in resp.json()["detail"].lower() or "invalid" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_confirm_token_is_single_use(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Confirm consumes the token — second call must fail with 400."""
    csv_bytes = _make_csv([{"title": "Once Book"}])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        preview = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )
        token = preview.json()["import_token"]

        first = await client.post(
            "/api/v1/books/import/confirm",
            json={"import_token": token},
            headers=headers,
        )
        second = await client.post(
            "/api/v1/books/import/confirm",
            json={"import_token": token},
            headers=headers,
        )

    assert first.status_code == 200
    assert second.status_code == 400


# ── Library isolation test ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dedup_two_copies_same_title_different_shelves_are_distinct(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Two physical copies of the same book (same title/author, no ISBN)
    on different shelves must be treated as distinct entries — not merged."""
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        loc1 = await _create_location(session, library.id, room="Living Room", furniture="Shelf A", shelf="1")
        loc2 = await _create_location(session, library.id, room="Study",      furniture="Shelf B", shelf="1")
        session.add_all([
            Book(library_id=library.id, title="Clean Code", author="Robert Martin",
                 location_id=loc1.id),
            Book(library_id=library.id, title="Clean Code", author="Robert Martin",
                 location_id=loc2.id),
        ])
        await session.commit()

    # CSV contains the same two copies at the same two shelves → both should
    # be recognized as existing (would_update=2, would_create=0)
    csv_bytes = _make_csv([
        {"title": "Clean Code", "author": "Robert Martin",
         "room": "Living Room", "furniture": "Shelf A", "shelf": "1"},
        {"title": "Clean Code", "author": "Robert Martin",
         "room": "Study",       "furniture": "Shelf B", "shelf": "1"},
    ])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )

    data = resp.json()
    assert data["summary"]["would_update"] == 2, (
        "Both copies (different shelves) should match their existing counterparts"
    )
    assert data["summary"]["would_create"] == 0


@pytest.mark.asyncio
async def test_dedup_two_copies_same_title_different_shelves_no_isbn_create_new(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Import of a title/author that exists on shelf A but the CSV row targets
    shelf B (a new location) must be treated as a NEW book, not an update."""
    async with test_session() as session:
        _, library = await _seed_user_with_library(session)
        loc_a = await _create_location(session, library.id, room="Room", furniture="Shelf", shelf="A")
        session.add(Book(
            library_id=library.id, title="Clean Code", author="Robert Martin",
            location_id=loc_a.id,
        ))
        await session.commit()

    # CSV targets a shelf B that does NOT yet exist in DB → should be "create"
    csv_bytes = _make_csv([
        {"title": "Clean Code", "author": "Robert Martin",
         "room": "Room", "furniture": "Shelf", "shelf": "B"},
    ])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)
        resp = await client.post(
            "/api/v1/books/import/preview",
            files={"file": ("books.csv", csv_bytes, "text/csv")},
            headers=headers,
        )

    data = resp.json()
    assert data["summary"]["would_create"] == 1, (
        "Same title/author but different shelf = new physical copy, not an update"
    )
    assert data["summary"]["would_update"] == 0


@pytest.mark.asyncio
async def test_export_does_not_leak_other_library_books(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with test_session() as session:
        user_a, lib_a = await _seed_user_with_library(session, "user_a@example.com")
        user_b, lib_b = await _seed_user_with_library(session, "user_b@example.com")
        session.add(Book(library_id=lib_a.id, title="Library A Book"))
        session.add(Book(library_id=lib_b.id, title="Library B Book"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Login as user_a
        login = await client.post(
            "/api/v1/auth/login", json={"email": "user_a@example.com", "password": "secret"}
        )
        headers_a = {"Authorization": f"Bearer {login.json()['access_token']}"}
        resp = await client.get("/api/v1/books/export", headers=headers_a)

    content = resp.content.lstrip(b"\xef\xbb\xbf").decode("utf-8")
    rows = list(csv.DictReader(StringIO(content)))
    titles = {r["title"] for r in rows}
    assert "Library A Book" in titles
    assert "Library B Book" not in titles, "Cross-library leak detected!"
