import uuid

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.db.session import get_db_session
from app.models.user import User
from app.schemas.book import BookCreateRequest, BookListResponse, BookResponse, BookUpdateRequest
from app.schemas.job import UploadResponse
from app.services.book import create_book, delete_book, get_book_or_404, list_books, update_book
from app.services.job import create_upload_job

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
    job = await create_upload_job(session, image)
    return UploadResponse(job_id=job.id, status=job.status)
