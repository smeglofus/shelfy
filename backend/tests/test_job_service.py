"""Service-level tests for app/services/job.py.

Covers get_job_or_404 and get_job_book_id — both are simple SQLite-compatible
functions.  create_upload_job is excluded because it calls upload_image_bytes
(MinIO), which is not available in the test environment.
"""
from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.book import Book, BookProcessingStatus, ReadingStatus
from app.models.book_image import BookImage
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.processing_job import ProcessingJob, ProcessingJobStatus
from app.models.user import User
from app.services.job import MAX_UPLOAD_SIZE_BYTES, create_upload_job, get_job_book_id, get_job_or_404


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


async def _make_job(
    session: AsyncSession,
    library_id: uuid.UUID,
    book_id: uuid.UUID | None = None,
) -> tuple[ProcessingJob, BookImage]:
    """Create a BookImage (optionally linked to a book) and a ProcessingJob."""
    img = BookImage(minio_path="uploads/test.jpg", book_id=book_id)
    session.add(img)
    await session.flush()
    job = ProcessingJob(
        book_image_id=img.id,
        library_id=library_id,
        status=ProcessingJobStatus.PENDING,
    )
    session.add(job)
    await session.commit()
    await session.refresh(img)
    await session.refresh(job)
    return job, img


# ── get_job_or_404 ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_job_or_404_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    job, _ = await _make_job(test_session, lib_id)

    result = await get_job_or_404(test_session, job.id, lib_id)

    assert result.id == job.id
    assert result.library_id == lib_id


@pytest.mark.asyncio
async def test_get_job_or_404_job_not_found(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)

    with pytest.raises(HTTPException) as exc:
        await get_job_or_404(test_session, uuid.uuid4(), lib_id)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_job_or_404_wrong_library(test_session: AsyncSession) -> None:
    """Job exists but belongs to a different library → 404 (tenant isolation)."""
    _, lib_id = await _make_library(test_session)
    job, _ = await _make_job(test_session, lib_id)

    _, other_lib_id = await _make_library(test_session)

    with pytest.raises(HTTPException) as exc:
        await get_job_or_404(test_session, job.id, other_lib_id)
    assert exc.value.status_code == 404


# ── get_job_book_id ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_job_book_id_returns_book_id_when_linked(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)

    # Create a book first so we have a real book_id
    book = Book(
        library_id=lib_id,
        title="Linked Book",
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.DONE,
    )
    test_session.add(book)
    await test_session.flush()

    job, _ = await _make_job(test_session, lib_id, book_id=book.id)

    result = await get_job_book_id(test_session, job)

    assert result == book.id


@pytest.mark.asyncio
async def test_get_job_book_id_returns_none_when_no_book(test_session: AsyncSession) -> None:
    """BookImage has no book_id → get_job_book_id returns None."""
    _, lib_id = await _make_library(test_session)
    job, _ = await _make_job(test_session, lib_id, book_id=None)

    result = await get_job_book_id(test_session, job)

    assert result is None


# ── create_upload_job validation ──────────────────────────────────────────────

class _FakeUpload:
    def __init__(self, content_type: str | None, chunks: list[bytes]) -> None:
        self.content_type = content_type
        self._chunks = chunks

    async def read(self, _size: int) -> bytes:
        if self._chunks:
            return self._chunks.pop(0)
        return b""


@pytest.mark.asyncio
async def test_create_upload_job_rejects_missing_content_type() -> None:
    upload = _FakeUpload(None, [b"image"])

    with pytest.raises(HTTPException) as exc:
        await create_upload_job(None, upload, uuid.uuid4())  # type: ignore[arg-type]

    assert exc.value.status_code == 422
    assert "content type" in str(exc.value.detail).lower()


@pytest.mark.asyncio
async def test_create_upload_job_rejects_unsupported_content_type() -> None:
    upload = _FakeUpload("image/gif", [b"image"])

    with pytest.raises(HTTPException) as exc:
        await create_upload_job(None, upload, uuid.uuid4())  # type: ignore[arg-type]

    assert exc.value.status_code == 422
    assert "jpeg/png" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_create_upload_job_rejects_too_large_file() -> None:
    upload = _FakeUpload("image/jpeg", [b"x" * (MAX_UPLOAD_SIZE_BYTES + 1)])

    with pytest.raises(HTTPException) as exc:
        await create_upload_job(None, upload, uuid.uuid4())  # type: ignore[arg-type]

    assert exc.value.status_code == 422
    assert "10MB" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_create_upload_job_success_png(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    upload = _FakeUpload("image/png", [b"png-bytes"])

    with patch("app.services.job.upload_image_bytes", return_value="uploads/test.png") as upload_mock:
        job, minio_path = await create_upload_job(test_session, upload, lib_id)  # type: ignore[arg-type]

    assert minio_path == "uploads/test.png"
    assert job.id is not None
    assert job.library_id == lib_id
    assert job.status == ProcessingJobStatus.PENDING
    upload_mock.assert_called_once()
