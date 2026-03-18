import asyncio
import uuid

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book_image import BookImage
from app.models.processing_job import ProcessingJob, ProcessingJobStatus
from app.services.storage import delete_image_bytes, upload_image_bytes

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024


async def create_upload_job(session: AsyncSession, upload_file: UploadFile) -> tuple[ProcessingJob, str]:
    content_type = upload_file.content_type
    if content_type is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Missing content type")

    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only jpeg/png files are supported")

    chunks: list[bytes] = []
    total_bytes = 0
    chunk_size = 1024 * 1024
    while True:
        chunk = await upload_file.read(chunk_size)
        if not chunk:
            break

        total_bytes += len(chunk)
        if total_bytes > MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="File size exceeds 10MB")

        chunks.append(chunk)

    payload = b"".join(chunks)

    extension = "jpg" if content_type == "image/jpeg" else "png"
    object_name = f"uploads/{uuid.uuid4()}.{extension}"
    loop = asyncio.get_running_loop()
    try:
        minio_path = await loop.run_in_executor(
            None,
            lambda: upload_image_bytes(object_name=object_name, payload=payload, content_type=content_type),
        )
    except Exception as storage_exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image storage is temporarily unavailable",
        ) from storage_exc

    try:
        book_image = BookImage(minio_path=minio_path)
        session.add(book_image)
        await session.flush()

        job = ProcessingJob(book_image_id=book_image.id, status=ProcessingJobStatus.PENDING)
        session.add(job)
        await session.flush()

        return job, minio_path
    except Exception:
        await loop.run_in_executor(None, lambda: delete_image_bytes(object_name))
        raise


async def get_job_or_404(session: AsyncSession, job_id: uuid.UUID) -> ProcessingJob:
    result = await session.execute(select(ProcessingJob).where(ProcessingJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


async def get_job_book_id(session: AsyncSession, job: ProcessingJob) -> uuid.UUID | None:
    image = await session.get(BookImage, job.book_image_id)
    if image is None:
        return None
    return image.book_id
