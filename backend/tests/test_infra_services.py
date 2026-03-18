from __future__ import annotations

from unittest.mock import Mock

from botocore.exceptions import ClientError
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.services import storage
from app.services.job_queue import get_celery_client
from app.services.user_seed import seed_admin_user


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code}}, "head_bucket")


def test_ensure_bucket_exists_creates_missing_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock()
    client.head_bucket.side_effect = _client_error("404")

    monkeypatch.setattr("app.services.storage._get_s3_client", lambda: client)

    storage.ensure_bucket_exists()

    client.create_bucket.assert_called_once()


def test_ensure_bucket_exists_ignores_already_owned_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock()
    client.head_bucket.side_effect = _client_error("NoSuchBucket")
    client.create_bucket.side_effect = _client_error("BucketAlreadyOwnedByYou")

    monkeypatch.setattr("app.services.storage._get_s3_client", lambda: client)

    storage.ensure_bucket_exists()

    client.create_bucket.assert_called_once()


def test_upload_and_delete_image_bytes_delegate_to_s3_client(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock()
    monkeypatch.setattr("app.services.storage._get_s3_client", lambda: client)

    object_name = storage.upload_image_bytes(
        object_name="uploads/test.jpg",
        payload=b"image-bytes",
        content_type="image/jpeg",
    )
    storage.delete_image_bytes("uploads/test.jpg")

    assert object_name == "uploads/test.jpg"
    client.upload_fileobj.assert_called_once()
    client.delete_object.assert_called_once()


def test_get_celery_client_uses_configured_broker_and_backend() -> None:
    client = get_celery_client()
    assert client.conf.broker_url is not None
    assert client.conf.result_backend is not None


@pytest.mark.asyncio
async def test_seed_admin_user_creates_and_skips_existing_user() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as session:
        created = await seed_admin_user(session, "admin@example.com", "secret")
        skipped = await seed_admin_user(session, "admin@example.com", "secret")

    await engine.dispose()

    assert created is True
    assert skipped is False
