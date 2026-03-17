import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.db.session import get_db_session
from app.models.user import User
from app.schemas.job import JobStatusResponse
from app.services.job import get_job_book_id, get_job_or_404

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobStatusResponse)
async def read_job_status(
    job_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> JobStatusResponse:
    job = await get_job_or_404(session, job_id)
    return JobStatusResponse(
        id=job.id,
        status=job.status,
        book_id=await get_job_book_id(session, job),
        result_json=job.result_json,
        error_message=job.error_message,
        attempts=job.attempts,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )
