from collections.abc import AsyncIterator, Iterator
import io
import os
from unittest.mock import patch
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.book_image import BookImage
from app.models.processing_job import ProcessingJob, ProcessingJobStatus
from app.models.user import User


def _require_test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_jobs.db")


@pytest.fixture
async def test_session() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(_require_test_database_url())
    async with engine.begin() as connection:
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "manual",
                "pending",
                "done",
                "failed",
                "partial",
                name="book_processing_status",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(
            lambda sync_conn: sa.Enum(
                "pending",
                "processing",
                "done",
                "failed",
                name="processing_job_status",
            ).create(sync_conn, checkfirst=True)  # type: ignore[no-untyped-call]
        )
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield session_factory

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


@pytest.fixture(autouse=True)
def override_dependencies(
    test_session: async_sessionmaker[AsyncSession], test_settings: Settings
) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with test_session() as session:
            yield session

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield
    app.dependency_overrides.clear()


async def _seed_user(session: AsyncSession) -> None:
    session.add(User(email="admin@example.com", hashed_password=get_password_hash("secret")))
    await session.commit()


async def _auth_headers(client: AsyncClient, session: AsyncSession) -> dict[str, str]:
    await _seed_user(session)
    login_response = await client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "secret"})
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_upload_endpoint_returns_202_with_job_id(test_session: async_sessionmaker[AsyncSession]) -> None:
    with (
        patch("app.services.job.upload_image_bytes", return_value="uploads/file.jpg"),
        patch("app.api.books.get_celery_client") as celery_client,
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async with test_session() as session:
                headers = await _auth_headers(client, session)

            response = await client.post(
                "/api/v1/books/upload",
                files={"image": ("cover.jpg", io.BytesIO(b"image"), "image/jpeg")},
                headers=headers,
            )

    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "pending"
    assert uuid.UUID(payload["job_id"])
    celery_client.return_value.send_task.assert_called_once()


@pytest.mark.asyncio
async def test_upload_invalid_file_type_returns_422(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.post(
            "/api/v1/books/upload",
            files={"image": ("notes.txt", io.BytesIO(b"text"), "text/plain")},
            headers=headers,
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_upload_exceeds_10mb_returns_422(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.post(
            "/api/v1/books/upload",
            files={"image": ("large.png", io.BytesIO(b"A" * (10 * 1024 * 1024 + 1)), "image/png")},
            headers=headers,
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_job_status_endpoint_returns_correct_status(test_session: async_sessionmaker[AsyncSession]) -> None:
    async with test_session() as session:
        image = BookImage(minio_path="uploads/file.jpg")
        session.add(image)
        await session.flush()
        job = ProcessingJob(book_image_id=image.id, status=ProcessingJobStatus.DONE, attempts=1)
        session.add(job)
        await session.commit()
        await session.refresh(job)
        job_id = job.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with test_session() as session:
            headers = await _auth_headers(client, session)

        response = await client.get(f"/api/v1/jobs/{job_id}", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(job_id)
    assert payload["status"] == "done"
    assert payload["attempts"] == 1
