from datetime import datetime, timezone
import uuid

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book_image import BookImage
from app.models.processing_job import ProcessingJob, ProcessingJobStatus

MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}


async def read_validated_image(file: UploadFile) -> tuple[bytes, str]:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only JPEG and PNG are allowed")

    payload = await file.read()
    if len(payload) == 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Uploaded file is empty")
    if len(payload) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="File too large (max 10MB)")

    return payload, file.content_type


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


async def get_job_or_404(session: AsyncSession, job_id: uuid.UUID) -> ProcessingJob:
    result = await session.execute(
        select(ProcessingJob).options(selectinload(ProcessingJob.book_image)).where(ProcessingJob.id == job_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


def make_image_object_path(filename: str | None) -> str:
    suffix = "bin"
    if filename and "." in filename:
        suffix = filename.rsplit(".", maxsplit=1)[1].lower()
    today = datetime.now(timezone.utc).strftime("%Y/%m/%d")
    return f"uploads/{today}/{uuid.uuid4()}.{suffix}"
