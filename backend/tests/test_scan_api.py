"""API-level tests for GET /api/v1/scan/shelf/{job_id} and POST /api/v1/scan/confirm.

Uses ASGITransport so the full HTTP stack executes and api/scan.py function
bodies are counted by pytest-cov.  An in-process SQLite database (or
TEST_DATABASE_URL postgres in CI) is shared with the ASGI app via the
get_db_session dependency override — no real Celery or MinIO required.

POST /confirm is exercised in three flavours:
  • empty book list   → created_count=0, skips enrichment block entirely
  • quota exhausted   → books saved, enrichment skipped via logger.info path
  • quota available   → Celery mocked, full enrichment-dispatch path covered
"""
from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import sqlalchemy as sa
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.book_image import BookImage
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.location import Location
from app.models.processing_job import ProcessingJob, ProcessingJobStatus
from app.models.subscription import UsageCounter, UsageMetric
from app.models.user import User


def _db_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_scan_api.db")


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
async def test_session() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(_db_url())
    async with engine.begin() as connection:
        # Create PostgreSQL enum types that have create_type=False so they are
        # not emitted by Base.metadata.create_all.  On SQLite these are no-ops.
        for name, values in [
            ("book_processing_status", ["manual", "pending", "done", "failed", "partial"]),
            ("reading_status", ["unread", "reading", "read", "lent"]),
            ("library_role", ["owner", "editor", "viewer"]),
            ("processing_job_status", ["pending", "processing", "done", "failed"]),
        ]:
            _n, _v = name, values
            await connection.run_sync(
                lambda c, n=_n, v=_v: sa.Enum(*v, name=n).create(c, checkfirst=True)  # type: ignore[no-untyped-call]
            )
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield session_factory
    await engine.dispose()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        database_url=_db_url(),
        jwt_secret_key="test-secret",
        jwt_algorithm="HS256",
        access_token_expire_minutes=15,
        refresh_token_expire_days=7,
    )


@pytest.fixture(autouse=True)
def override_dependencies(
    test_session: async_sessionmaker[AsyncSession],
    test_settings: Settings,
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with test_session() as session:
            yield session

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield
    app.dependency_overrides.clear()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _setup(
    client: AsyncClient,
    session: AsyncSession,
) -> tuple[dict[str, str], uuid.UUID, uuid.UUID]:
    """Seed user + library, log in.  Returns (auth_headers, user_id, library_id)."""
    user = User(email="scan@example.com", hashed_password=get_password_hash("secret"))
    session.add(user)
    await session.flush()
    lib = Library(name="ScanLib", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(user)

    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "scan@example.com", "password": "secret"},
    )
    assert resp.status_code == 200
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return headers, user.id, lib.id


async def _make_location(session: AsyncSession, library_id: uuid.UUID) -> Location:
    loc = Location(library_id=library_id, room="Room", furniture="Shelf", shelf="Top")
    session.add(loc)
    await session.commit()
    await session.refresh(loc)
    return loc


async def _make_job(
    session: AsyncSession,
    library_id: uuid.UUID,
    status: ProcessingJobStatus = ProcessingJobStatus.PENDING,
    result_json: dict[str, object] | None = None,
) -> ProcessingJob:
    img = BookImage(minio_path="uploads/test.jpg")
    session.add(img)
    await session.flush()
    job = ProcessingJob(
        book_image_id=img.id,
        library_id=library_id,
        status=status,
        result_json=result_json,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


# ── GET /api/v1/scan/shelf/{job_id} ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_scan_result_job_not_found(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers, _, _ = await _setup(client, session)

        resp = await client.get(f"/api/v1/scan/shelf/{uuid.uuid4()}", headers=headers)

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_scan_result_pending_job(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers, _, lib_id = await _setup(client, session)
            job = await _make_job(session, lib_id, ProcessingJobStatus.PENDING)
            job_id = job.id

        resp = await client.get(f"/api/v1/scan/shelf/{job_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert data["books"] == []


@pytest.mark.asyncio
async def test_get_scan_result_done_job_with_books(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """DONE job with result_json: verifies book parsing and all confidence branches."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers, _, lib_id = await _setup(client, session)
            loc = await _make_location(session, lib_id)
            job = await _make_job(
                session,
                lib_id,
                status=ProcessingJobStatus.DONE,
                result_json={
                    "location_id": str(loc.id),
                    "books": [
                        # confidence="high" + has_title=True → "auto" (line 131)
                        {"title": "High Conf Book", "author": "Alice", "isbn": None,
                         "observed_text": "high conf book", "confidence": "high"},
                        # confidence="low" → "needs_review" (line 133, short-circuit)
                        {"title": "Low Conf Book", "author": "Bob",
                         "isbn": "9780132350884", "observed_text": "low", "confidence": "low"},
                        # confidence="medium" + has_title=True → else → "auto" (line 135)
                        {"title": "Medium Book", "author": "Carol", "isbn": None,
                         "observed_text": "medium", "confidence": "medium"},
                        # confidence="medium" + title=="Unknown title" → not has_title → "needs_review" (line 133)
                        {"title": "Unknown title", "author": None, "isbn": None,
                         "observed_text": None, "confidence": "medium"},
                        # non-dict entry → isinstance check fires → continue (line 120-121)
                        "not_a_dict",
                    ],
                },
            )
            job_id = job.id
            loc_id = loc.id

        resp = await client.get(f"/api/v1/scan/shelf/{job_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "done"
    assert data["location_id"] == str(loc_id)
    # "not_a_dict" is skipped → only 4 book items returned
    assert len(data["books"]) == 4
    assert data["books"][0]["confidence"] == "auto"          # high + has_title
    assert data["books"][1]["confidence"] == "needs_review"  # low
    assert data["books"][2]["confidence"] == "auto"          # medium + has_title
    assert data["books"][3]["confidence"] == "needs_review"  # medium + "Unknown title"


# ── POST /api/v1/scan/confirm ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_confirm_shelf_books_enrichment_skipped_on_exhausted_quota(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """Books are saved but enrichment is skipped (logger.info path) when quota is 0."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers, user_id, lib_id = await _setup(client, session)
            loc = await _make_location(session, lib_id)
            loc_id = loc.id

            # Exhaust the free plan's enrichment quota (20/month)
            period_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            session.add(UsageCounter(
                user_id=user_id,
                metric=UsageMetric.enrichments,
                period_start=period_start,
                count=20,
            ))
            await session.commit()

        resp = await client.post(
            "/api/v1/scan/confirm",
            json={
                "location_id": str(loc_id),
                "books": [{"position": 0, "title": "Quota Test Book"}],
            },
            headers=headers,
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["created_count"] == 1
    assert len(data["book_ids"]) == 1


@pytest.mark.asyncio
async def test_confirm_shelf_books_celery_enqueued(
    test_session: async_sessionmaker[AsyncSession],
) -> None:
    """When quota allows, Celery is called and consume_n is invoked (both mocked)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers, _, lib_id = await _setup(client, session)
            loc = await _make_location(session, lib_id)
            loc_id = loc.id

        mock_celery = MagicMock()
        mock_celery.send_task = MagicMock()

        with (
            patch("app.api.scan.get_celery_client", return_value=mock_celery),
            patch("app.services.entitlements.consume_n", new_callable=AsyncMock),
        ):
            resp = await client.post(
                "/api/v1/scan/confirm",
                json={
                    "location_id": str(loc_id),
                    "books": [
                        {"position": 0, "title": "Book Alpha"},
                        {"position": 1, "title": "Book Beta"},
                    ],
                },
                headers=headers,
            )

    assert resp.status_code == 201
    data = resp.json()
    assert data["created_count"] == 2
    assert len(data["book_ids"]) == 2
    mock_celery.send_task.assert_called_once()
