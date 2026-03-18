from __future__ import annotations

from datetime import datetime
from enum import Enum
from functools import lru_cache
import os
import re
import uuid

import boto3
import cv2
import numpy as np
import pytesseract
try:
    from pyzbar.pyzbar import decode as decode_barcodes
except ImportError:
    decode_barcodes = None
from celery import Celery
from celery.exceptions import Retry
from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, Uuid, create_engine, exc, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


class Base(DeclarativeBase):
    pass


class ProcessingJobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class BookImage(Base):
    __tablename__ = "book_images"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    minio_path: Mapped[str] = mapped_column(String(1024), nullable=False)


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"
    # Keep this schema aligned with backend/app/models/processing_job.py.

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    status: Mapped[ProcessingJobStatus] = mapped_column(
        SAEnum(
            ProcessingJobStatus,
            values_callable=lambda e: [member.value for member in e],
            validate_strings=True,
            name="processing_job_status",
            create_type=False,
        ),
        nullable=False,
        default=ProcessingJobStatus.PENDING,
    )
    book_image_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("book_images.id", ondelete="CASCADE"), nullable=False, index=True
    )
    result_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


def get_celery_app() -> Celery:
    broker_url = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
    backend_url = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/1")

    app = Celery("shelfy_worker", broker=broker_url, backend=backend_url)
    app.conf.update(task_default_queue="default")
    return app


celery_app = get_celery_app()


@lru_cache(maxsize=1)
def _get_engine():
    database_url = os.getenv("DATABASE_URL", "postgresql+asyncpg://shelfy:shelfy@postgres:5432/shelfy")
    sync_database_url = database_url.replace("+asyncpg", "+psycopg2")
    return create_engine(sync_database_url, pool_pre_ping=True)


def _get_minio_client():
    endpoint = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
    access_key = os.getenv("MINIO_ACCESS_KEY")
    secret_key = os.getenv("MINIO_SECRET_KEY")
    if not access_key or not secret_key:
        raise RuntimeError("MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set")
    region = os.getenv("MINIO_REGION", "us-east-1")
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
    )


def _download_image_bytes(minio_path: str) -> bytes:
    client = _get_minio_client()
    bucket = os.getenv("MINIO_BUCKET", "shelfy-images")
    response = client.get_object(Bucket=bucket, Key=minio_path)
    body = response["Body"]
    try:
        return body.read()
    finally:
        body.close()


def _decode_image_bytes(image_bytes: bytes) -> np.ndarray:
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode image bytes")
    return image


def normalize_isbn(raw_value: str) -> str | None:
    cleaned = re.sub(r"[^0-9Xx]", "", raw_value).upper()
    if len(cleaned) == 10 and _is_valid_isbn10(cleaned):
        return cleaned
    if len(cleaned) == 13 and _is_valid_isbn13(cleaned):
        return cleaned
    return None


def _is_valid_isbn10(isbn10: str) -> bool:
    if not re.fullmatch(r"\d{9}[\dX]", isbn10):
        return False

    total = 0
    for index, char in enumerate(isbn10):
        value = 10 if char == "X" else int(char)
        total += value * (10 - index)
    return total % 11 == 0


def _is_valid_isbn13(isbn13: str) -> bool:
    if not re.fullmatch(r"\d{13}", isbn13):
        return False

    checksum = 0
    for index, char in enumerate(isbn13[:-1]):
        checksum += int(char) * (1 if index % 2 == 0 else 3)
    check_digit = (10 - (checksum % 10)) % 10
    return check_digit == int(isbn13[-1])


def _extract_isbn_from_text(text: str) -> str | None:
    matches = re.finditer(r"(?:97[89][\d\s-]{10,}|[\dXx][\d\s-]{8,}[\dXx])", text)
    for match in matches:
        normalized = normalize_isbn(match.group(0))
        if normalized is not None:
            return normalized
    return None


def _extract_title_author_from_text(text: str) -> tuple[str | None, str | None]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return None, None

    title = lines[0]
    author: str | None = None

    for line in lines[1:4]:
        lowered = line.lower()
        if lowered.startswith("by "):
            author = line[3:].strip() or None
            break

    if author is None and len(lines) >= 2:
        author = lines[1]

    return title, author


def _detect_isbn_from_barcode(image: np.ndarray) -> str | None:
    if decode_barcodes is None:
        return None

    decoded = decode_barcodes(image)
    for item in decoded:
        normalized = normalize_isbn(item.data.decode("utf-8", errors="ignore"))
        if normalized is not None:
            return normalized
    return None


def _extract_text_with_ocr(image: np.ndarray) -> str:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    _, thresholded = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return pytesseract.image_to_string(thresholded)


def _extract_metadata(image_bytes: bytes) -> tuple[dict[str, object], ProcessingJobStatus, str | None]:
    image = _decode_image_bytes(image_bytes)

    barcode_isbn = _detect_isbn_from_barcode(image)
    if barcode_isbn is not None:
        return (
            {
                "isbn": barcode_isbn,
                "title": None,
                "author": None,
                "source": "barcode",
            },
            ProcessingJobStatus.DONE,
            None,
        )

    ocr_text = _extract_text_with_ocr(image)
    isbn_from_ocr = _extract_isbn_from_text(ocr_text)
    title, author = _extract_title_author_from_text(ocr_text)

    if ocr_text.strip():
        return (
            {
                "isbn": isbn_from_ocr,
                "title": title,
                "author": author,
                "source": "ocr",
            },
            ProcessingJobStatus.DONE,
            None,
        )

    return (
        {
            "isbn": None,
            "title": None,
            "author": None,
            "source": "none",
        },
        ProcessingJobStatus.FAILED,
        "No barcode or readable OCR text found",
    )


def _mark_failed(job_id: str, message: str) -> None:
    with Session(_get_engine()) as session:
        job = session.get(ProcessingJob, uuid.UUID(job_id))
        if job is not None:
            job.status = ProcessingJobStatus.FAILED
            job.result_json = None
            job.error_message = message[:1000]
            session.commit()


@celery_app.task(
    name="worker.celery_app.process_book_image",
    bind=True,
    acks_late=True,
    autoretry_for=(exc.OperationalError, exc.InterfaceError),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
)
def process_book_image(self, job_id: str) -> None:
    try:
        with Session(_get_engine()) as session:
            job = session.get(ProcessingJob, uuid.UUID(job_id))
            if job is None:
                raise self.retry(exc=RuntimeError(f"ProcessingJob {job_id} not found — may not be committed yet"), countdown=2)

            image = session.get(BookImage, job.book_image_id)
            if image is None:
                raise self.retry(exc=RuntimeError(f"BookImage for job {job_id} not found"), countdown=2)

            job.status = ProcessingJobStatus.PROCESSING
            job.attempts += 1
            session.commit()

            image_bytes = _download_image_bytes(image.minio_path)
            result_json, final_status, error_message = _extract_metadata(image_bytes)

            job.status = final_status
            job.result_json = result_json
            job.error_message = error_message
            session.commit()
    except Retry:
        raise
    except (exc.OperationalError, exc.InterfaceError):
        raise
    except Exception as error:
        _mark_failed(job_id, str(error))
        raise
