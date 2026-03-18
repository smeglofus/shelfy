from datetime import datetime
import uuid

from pydantic import BaseModel, ConfigDict

from app.models.processing_job import ProcessingJobStatus


class UploadResponse(BaseModel):
    job_id: uuid.UUID
    status: ProcessingJobStatus


class JobStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: ProcessingJobStatus
    book_id: uuid.UUID | None
    result_json: dict[str, object] | None
    error_message: str | None
    attempts: int
    created_at: datetime
    updated_at: datetime
