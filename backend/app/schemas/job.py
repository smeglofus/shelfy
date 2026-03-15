import uuid

from pydantic import BaseModel

from app.models.processing_job import ProcessingJobStatus


class UploadResponse(BaseModel):
    job_id: uuid.UUID
    status: ProcessingJobStatus


class JobStatusResponse(BaseModel):
    id: uuid.UUID
    status: ProcessingJobStatus
    book_id: uuid.UUID | None = None
