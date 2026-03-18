import asyncio
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.db.session import get_db_session
from app.models.processing_job import ProcessingJob, ProcessingJobStatus
from app.models.user import User
from app.schemas.book import BookCreateRequest, BookListResponse, BookResponse, BookUpdateRequest
from app.schemas.job import UploadResponse
from app.services.book import create_book, delete_book, get_book_or_404, list_books, update_book
from app.services.job import create_upload_job
from app.services.job_queue import get_celery_client
from app.services.storage import delete_image_bytes

router = APIRouter(prefix="/api/v1/books", tags=["books"])


@router.get("", response_model=BookListResponse)
async def read_books(
    search: str | None = Query(default=None, min_length=1),
    location_id: uuid.UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> BookListResponse:
    books, total = await list_books(
        session, search=search, location_id=location_id, page=page, page_size=page_size
    )
    return BookListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[BookResponse.model_validate(book) for book in books],
    )


@router.post("", response_model=BookResponse, status_code=status.HTTP_201_CREATED)
async def create_book_endpoint(
    payload: BookCreateRequest,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> BookResponse:
    book = await create_book(session, payload)
    return BookResponse.model_validate(book)


@router.get("/{book_id}", response_model=BookResponse)
async def read_book(
    book_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> BookResponse:
    book = await get_book_or_404(session, book_id)
    return BookResponse.model_validate(book)


@router.patch("/{book_id}", response_model=BookResponse)
async def update_book_endpoint(
    book_id: uuid.UUID,
    payload: BookUpdateRequest,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> BookResponse:
    book = await update_book(session, book_id, payload)
    return BookResponse.model_validate(book)


@router.delete("/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_book_endpoint(
    book_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> Response:
    await delete_book(session, book_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_book_image(
    image: UploadFile = File(...),
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> UploadResponse:
    job, minio_path = await create_upload_job(session, image)

    try:
        await session.commit()
        celery_client = get_celery_client()
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: celery_client.send_task(
                "worker.celery_app.process_book_image",
                args=[str(job.id)],
            ),
        )
    except Exception as publish_exc:
        try:
            cleanup_loop = asyncio.get_running_loop()
            await cleanup_loop.run_in_executor(None, lambda: delete_image_bytes(minio_path))
        except Exception:
            pass
        try:
            async with AsyncSession(session.bind) as cleanup_session:
                orphaned_job = await cleanup_session.get(ProcessingJob, job.id)
                if orphaned_job is not None:
                    orphaned_job.status = ProcessingJobStatus.FAILED
                    orphaned_job.error_message = "Queue unavailable"
                    await cleanup_session.commit()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image processing queue is unavailable",
        ) from publish_exc

    return UploadResponse(job_id=job.id, status=job.status)
