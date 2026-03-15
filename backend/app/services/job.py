from dataclasses import dataclass
from datetime import datetime, timezone
import uuid

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.book_image import BookImage
from app.models.processing_job import ProcessingJob, ProcessingJobStatus

MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024
UPLOAD_READ_CHUNK_SIZE_BYTES = 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xFF\xD8\xFF"


@dataclass
class ImageValidationError(Exception):
    message: str


class EmptyFileError(ImageValidationError):
    pass


class FileTooLargeError(ImageValidationError):
    pass


class InvalidImageTypeError(ImageValidationError):
    pass


class MismatchedImageTypeError(ImageValidationError):
    pass


class JobNotFoundError(Exception):
    pass


def detect_image_content_type(payload: bytes) -> str | None:
    if payload.startswith(PNG_SIGNATURE):
        return "image/png"
    if payload.startswith(JPEG_SIGNATURE):
        return "image/jpeg"
    return None


async def read_validated_image(file: UploadFile) -> tuple[bytes, str]:
    payload_buffer = bytearray()
    total_size = 0

    while True:
        chunk = await file.read(UPLOAD_READ_CHUNK_SIZE_BYTES)
        if not chunk:
            break

        total_size += len(chunk)
        if total_size > MAX_UPLOAD_SIZE_BYTES:
            raise FileTooLargeError("File too large (max 10MB)")

        payload_buffer.extend(chunk)

    if total_size == 0:
        raise EmptyFileError("Uploaded file is empty")

    payload = bytes(payload_buffer)
    detected_content_type = detect_image_content_type(payload)
    if detected_content_type not in ALLOWED_IMAGE_TYPES:
        raise InvalidImageTypeError("Only JPEG and PNG are allowed")

    if file.content_type and file.content_type != detected_content_type:
        raise MismatchedImageTypeError("Uploaded file type does not match file content")

    return payload, detected_content_type


async def create_processing_job(
    session: AsyncSession,
    *,
    minio_path: str,
    book_id: uuid.UUID | None = None,
) -> ProcessingJob:
    image = BookImage(book_id=book_id, minio_path=minio_path)
    job = ProcessingJob(book_image=image, status=ProcessingJobStatus.PENDING)
    session.add_all([image, job])
    await session.commit()
    await session.refresh(job)
    return job


async def mark_job_failed(session: AsyncSession, job: ProcessingJob, error_message: str) -> ProcessingJob:
    job.status = ProcessingJobStatus.FAILED
    job.error_message = error_message[:5000]
    job.attempts += 1
    await session.commit()
    await session.refresh(job)
    return job


async def get_job_or_404(session: AsyncSession, job_id: uuid.UUID) -> ProcessingJob:
    result = await session.execute(
        select(ProcessingJob).options(selectinload(ProcessingJob.book_image)).where(ProcessingJob.id == job_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise JobNotFoundError("Job not found")
    return job


def make_image_object_path(content_type: str) -> str:
    extension_map = {
        "image/jpeg": "jpg",
        "image/png": "png",
    }
    extension = extension_map.get(content_type)
    if extension is None:
        raise ValueError(f"Unsupported content type: {content_type}")

    today = datetime.now(timezone.utc).strftime("%Y/%m/%d")
    return f"uploads/{today}/{uuid.uuid4()}.{extension}"
