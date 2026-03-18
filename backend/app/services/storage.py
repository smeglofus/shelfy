from io import BytesIO

import boto3
from botocore.client import BaseClient
from botocore.exceptions import ClientError
import structlog

from app.core.config import get_settings

logger = structlog.get_logger()


def _get_s3_client() -> BaseClient:
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.minio_endpoint,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        region_name=settings.minio_region,
    )


def ensure_bucket_exists() -> None:
    settings = get_settings()
    client = _get_s3_client()
    try:
        client.head_bucket(Bucket=settings.minio_bucket)
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code")
        if error_code not in {"404", "NoSuchBucket"}:
            raise

        try:
            client.create_bucket(Bucket=settings.minio_bucket)
            logger.info("minio_bucket_created", bucket=settings.minio_bucket)
        except ClientError as create_exc:
            create_code = create_exc.response.get("Error", {}).get("Code")
            if create_code not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
                raise


def upload_image_bytes(*, object_name: str, payload: bytes, content_type: str) -> str:
    settings = get_settings()
    client = _get_s3_client()
    client.upload_fileobj(
        Fileobj=BytesIO(payload),
        Bucket=settings.minio_bucket,
        Key=object_name,
        ExtraArgs={"ContentType": content_type},
    )
    return object_name


def delete_image_bytes(object_name: str) -> None:
    settings = get_settings()
    client = _get_s3_client()
    client.delete_object(Bucket=settings.minio_bucket, Key=object_name)
