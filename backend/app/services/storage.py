import asyncio
import io

from minio import Minio
from minio.error import S3Error

from app.core.config import Settings


class StorageService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )

    async def ensure_bucket(self) -> None:
        await asyncio.to_thread(self._ensure_bucket_sync)

    def _ensure_bucket_sync(self) -> None:
        try:
            self._client.make_bucket(self._settings.minio_bucket_name)
        except S3Error as exc:
            if exc.code == "BucketAlreadyOwnedByYou":
                return
            raise

    async def upload_bytes(self, object_path: str, data: bytes, content_type: str) -> str:
        await asyncio.to_thread(self._upload_bytes_sync, object_path, data, content_type)
        return object_path

    def _upload_bytes_sync(self, object_path: str, data: bytes, content_type: str) -> None:
        stream = io.BytesIO(data)
        self._client.put_object(
            self._settings.minio_bucket_name,
            object_path,
            data=stream,
            length=len(data),
            content_type=content_type,
        )


def get_storage_service(settings: Settings) -> StorageService:
    return StorageService(settings)


def is_retriable_storage_error(exc: Exception) -> bool:
    if not isinstance(exc, S3Error):
        return False

    retriable_codes = {
        "RequestTimeout",
        "Throttling",
        "InternalError",
        "SlowDown",
        "ServiceUnavailable",
    }
    return exc.code in retriable_codes
