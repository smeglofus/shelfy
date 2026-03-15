import uuid

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.models.user import User
from app.schemas.book import BookCreateRequest, BookListResponse, BookResponse, BookUpdateRequest
from app.schemas.job import JobStatusResponse, UploadResponse
from app.services.book import create_book, delete_book, get_book_or_404, list_books, update_book
from app.services.job import create_processing_job, get_job_or_404, make_image_object_path, read_validated_image
from app.services.storage import get_storage_service
from app.services.tasks import get_celery_client

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


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_book_image(
    image: UploadFile = File(...),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    _current_user: User = Depends(get_current_user),
) -> UploadResponse:
    payload, content_type = await read_validated_image(image)
    object_path = make_image_object_path(image.filename)

    storage_service = get_storage_service(settings)
    await storage_service.upload_bytes(object_path, payload, content_type)

    job = await create_processing_job(session, minio_path=object_path)

    celery_client = get_celery_client(settings)
    celery_client.send_task("worker.process_image_job", args=[str(job.id)])

    return UploadResponse(job_id=job.id, status=job.status)


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


@router.get("/jobs/{job_id}", response_model=JobStatusResponse, tags=["jobs"])
async def get_job_status(
    job_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    _current_user: User = Depends(get_current_user),
) -> JobStatusResponse:
    job = await get_job_or_404(session, job_id)
    book_id = job.book_image.book_id if job.book_image is not None else None
    return JobStatusResponse(id=job.id, status=job.status, book_id=book_id)
