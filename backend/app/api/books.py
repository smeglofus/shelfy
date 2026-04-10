import asyncio
import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.api.dependencies.library import get_library_id, require_editor_library
from app.api.dependencies.redis import get_redis
from app.db.session import get_db_session
from app.models.subscription import UsageMetric
from app.models.user import User
from app.services import entitlements
from app.models.processing_job import ProcessingJob, ProcessingJobStatus
from app.schemas.book import (
    BookCreateRequest, BookListResponse, BookResponse, BookUpdateRequest,
    BulkDeleteRequest, BulkMoveRequest, BulkOperationResponse, BulkReorderRequest, BulkStatusRequest,
    CsvImportConfirmRequest, CsvImportConfirmResponse, CsvImportPreviewResponse,
    RetryEnrichmentResponse,
)
from app.schemas.job import UploadResponse
from app.services.book import (
    bulk_delete_books, bulk_move_books, bulk_reorder_books, bulk_update_status,
    create_book, delete_book, get_book_or_404, list_books, update_book,
)
from app.services.csv_import import build_books_export_csv, confirm_csv_import, preview_csv_import
from app.services.job import create_upload_job
from app.services.job_queue import get_celery_client
from app.services.storage import delete_image_bytes

router = APIRouter(prefix="/api/v1/books", tags=["books"])


@router.get("", response_model=BookListResponse)
async def read_books(
    search: str | None = Query(default=None, min_length=1),
    location_id: uuid.UUID | None = None,
    unassigned_only: bool = Query(default=False),
    reading_status: str | None = None,
    language: str | None = Query(default=None, min_length=1),
    publisher: str | None = Query(default=None, min_length=1),
    year_from: int | None = Query(default=None, ge=1000, le=9999),
    year_to: int | None = Query(default=None, ge=1000, le=9999),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> BookListResponse:
    books, total = await list_books(
        session,
        library_id=library_id,
        search=search,
        location_id=location_id,
        unassigned_only=unassigned_only,
        reading_status=reading_status,
        language=language,
        publisher=publisher,
        year_from=year_from,
        year_to=year_to,
        page=page,
        page_size=page_size,
    )
    return BookListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[BookResponse.model_validate(book) for book in books],
    )


@router.get("/export")
async def export_books_csv(
    location_id: uuid.UUID | None = Query(default=None),
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> StreamingResponse:
    content = await build_books_export_csv(session, library_id, location_id=location_id)
    response = StreamingResponse(iter([content]), media_type="text/csv; charset=utf-8")
    response.headers["Content-Disposition"] = 'attachment; filename="shelfy-export.csv"'
    return response


@router.post(
    "/import/preview",
    response_model=CsvImportPreviewResponse,
    status_code=status.HTTP_200_OK,
)
async def import_books_csv_preview(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    redis_client: aioredis.Redis = Depends(get_redis),
) -> CsvImportPreviewResponse:
    """Step 1 — parse and validate a CSV upload; returns a preview + import token."""
    file_bytes = await file.read()
    return await preview_csv_import(file_bytes, library_id, session, redis_client)


@router.post(
    "/import/confirm",
    response_model=CsvImportConfirmResponse,
    status_code=status.HTTP_200_OK,
)
async def import_books_csv_confirm(
    payload: CsvImportConfirmRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    redis_client: aioredis.Redis = Depends(get_redis),
) -> CsvImportConfirmResponse:
    """Step 2 — apply a previewed import.  The token is consumed atomically."""
    return await confirm_csv_import(
        payload.import_token, library_id, session, redis_client, payload
    )


@router.post("", response_model=BookResponse, status_code=status.HTTP_201_CREATED)
async def create_book_endpoint(
    payload: BookCreateRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BookResponse:
    book = await create_book(session, payload, library_id)
    return BookResponse.model_validate(book)


@router.get("/{book_id}", response_model=BookResponse)
async def read_book(
    book_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> BookResponse:
    book = await get_book_or_404(session, book_id, library_id)
    return BookResponse.model_validate(book)


@router.patch("/{book_id}", response_model=BookResponse)
async def update_book_endpoint(
    book_id: uuid.UUID,
    payload: BookUpdateRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BookResponse:
    book = await update_book(session, book_id, payload, library_id)
    return BookResponse.model_validate(book)


@router.delete("/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_book_endpoint(
    book_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> Response:
    await delete_book(session, book_id, library_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/bulk/delete", response_model=BulkOperationResponse)
async def bulk_delete(
    payload: BulkDeleteRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BulkOperationResponse:
    affected = await bulk_delete_books(session, payload.ids, library_id)
    return BulkOperationResponse(affected=affected, operation="delete")


@router.post("/bulk/move", response_model=BulkOperationResponse)
async def bulk_move(
    payload: BulkMoveRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BulkOperationResponse:
    affected = await bulk_move_books(
        session, payload.ids, payload.location_id, payload.insert_position, library_id
    )
    return BulkOperationResponse(affected=affected, operation="move")




@router.post("/bulk/reorder", response_model=BulkOperationResponse)
async def bulk_reorder(
    payload: BulkReorderRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BulkOperationResponse:
    affected = await bulk_reorder_books(
        session,
        items=[(item.id, item.location_id, item.shelf_position) for item in payload.items],
        library_id=library_id,
    )
    return BulkOperationResponse(affected=affected, operation="reorder")


@router.post("/bulk/status", response_model=BulkOperationResponse)
async def bulk_status(
    payload: BulkStatusRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> BulkOperationResponse:
    affected = await bulk_update_status(session, payload.ids, payload.reading_status, library_id)
    return BulkOperationResponse(affected=affected, operation="status")


@router.patch("/{book_id}/retry-enrichment", response_model=RetryEnrichmentResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_book_enrichment(
    book_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
) -> RetryEnrichmentResponse:
    # Verify membership before queuing
    await get_book_or_404(session, book_id, library_id)

    # Gate: raises HTTP 402 if monthly enrichment quota is exhausted
    await entitlements.assert_can_use(session, current_user.id, UsageMetric.enrichments)

    try:
        celery_client = get_celery_client()
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: celery_client.send_task(
                "worker.celery_app.retry_book_enrichment",
                args=[str(book_id)],
            ),
        )
    except Exception as publish_exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Enrichment queue is unavailable",
        ) from publish_exc

    # Consume 1 enrichment credit; idempotency key prevents double-charging if the
    # client retries the same failed book within the same billing period.
    await entitlements.consume(
        session,
        current_user.id,
        UsageMetric.enrichments,
        idempotency_key=f"retry_{book_id}",
    )
    await session.commit()

    return RetryEnrichmentResponse(book_id=book_id, status="queued")


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_book_image(
    image: UploadFile = File(...),
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> UploadResponse:
    job, minio_path = await create_upload_job(session, image, library_id=library_id)
    job_id = job.id
    job_status = job.status

    try:
        await session.commit()
        celery_client = get_celery_client()
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: celery_client.send_task(
                "worker.celery_app.process_book_image",
                args=[str(job_id)],
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
                orphaned_job = await cleanup_session.get(ProcessingJob, job_id)
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

    return UploadResponse(job_id=job_id, status=job_status)
