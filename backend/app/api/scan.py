from __future__ import annotations

import asyncio
import uuid

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()

from app.api.dependencies.auth import get_current_user
from app.api.dependencies.library import get_library_id, require_editor_library
from app.db.session import get_db_session
from app.models.processing_job import ProcessingJob, ProcessingJobStatus
from app.models.subscription import UsageMetric
from app.models.user import User
from app.schemas.scan import (
    ScannedBookItem,
    ShelfScanConfirmRequest,
    ShelfScanConfirmResponse,
    ShelfScanResponse,
    ShelfScanResultResponse,
)
from app.services import entitlements
from app.services.job import create_upload_job
from app.services.job_queue import get_celery_client
from app.services.scan import confirm_shelf_scan
from app.services.storage import delete_image_bytes

router = APIRouter(prefix="/api/v1/scan", tags=["scan"])


@router.post("/shelf", response_model=ShelfScanResponse, status_code=status.HTTP_202_ACCEPTED)
async def scan_shelf(
    image: UploadFile = File(...),
    location_id: str | None = Form(default=None),
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
) -> ShelfScanResponse:
    """Upload a photo of a shelf. Starts async processing to extract all book spines."""
    # Snapshot scalar id before commits to avoid async lazy-load on expired ORM object.
    user_id = current_user.id

    # Gate: raises HTTP 402 if monthly scan quota is exhausted
    await entitlements.assert_can_use(session, user_id, UsageMetric.scans)

    job, minio_path = await create_upload_job(session, image, library_id=library_id)
    job_id = job.id
    job_status = job.status.value

    parsed_location_id: uuid.UUID | None = None
    if location_id:
        try:
            parsed_location_id = uuid.UUID(location_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid location_id")

    try:
        await session.commit()
        celery_client = get_celery_client()
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: celery_client.send_task(
                "worker.celery_app.process_shelf_scan",
                args=[str(job_id), str(parsed_location_id) if parsed_location_id else None],
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

    # Consume 1 scan credit after the job has been successfully enqueued.
    # Using job_id as idempotency key so retried requests don't double-count.
    await entitlements.consume(
        session, user_id, UsageMetric.scans, idempotency_key=str(job_id)
    )
    await session.commit()

    return ShelfScanResponse(job_id=job_id, status=job_status)


@router.get("/shelf/{job_id}", response_model=ShelfScanResultResponse)
async def get_shelf_scan_result(
    job_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(get_library_id),
) -> ShelfScanResultResponse:
    """Poll for shelf scan results. Returns extracted books once processing is done."""
    from app.services.job import get_job_or_404

    job = await get_job_or_404(session, job_id, library_id=library_id)
    books: list[ScannedBookItem] = []

    if job.status == ProcessingJobStatus.DONE and job.result_json:
        raw_books_obj = job.result_json.get("books", [])
        raw_books: list[object] = raw_books_obj if isinstance(raw_books_obj, list) else []
        location_id_str = job.result_json.get("location_id")
        location_id = uuid.UUID(str(location_id_str)) if location_id_str else None

        for idx, raw in enumerate(raw_books):
            if not isinstance(raw, dict):
                continue
            title = raw.get("title") if isinstance(raw.get("title"), str) else None
            author = raw.get("author") if isinstance(raw.get("author"), str) else None
            isbn = raw.get("isbn") if isinstance(raw.get("isbn"), str) else None
            observed_text = raw.get("observed_text") if isinstance(raw.get("observed_text"), str) else None

            raw_confidence = raw.get("confidence") if isinstance(raw.get("confidence"), str) else None
            has_title = bool(title and title != "Unknown title")
            # Map worker confidence (high/medium/low) to UI confidence (auto/needs_review)
            if raw_confidence == "high" and has_title:
                confidence = "auto"
            elif raw_confidence == "low" or not has_title:
                confidence = "needs_review"
            else:
                confidence = "auto" if has_title else "needs_review"

            books.append(ScannedBookItem(
                position=idx,
                title=title,
                author=author,
                isbn=isbn,
                observed_text=observed_text,
                confidence=confidence,
            ))

        return ShelfScanResultResponse(
            job_id=job.id,
            status=job.status.value,
            location_id=location_id,
            books=books,
        )

    return ShelfScanResultResponse(
        job_id=job.id,
        status=job.status.value,
        error_message=job.error_message,
    )


@router.post("/confirm", response_model=ShelfScanConfirmResponse, status_code=status.HTTP_201_CREATED)
async def confirm_shelf_books(
    payload: ShelfScanConfirmRequest,
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
) -> ShelfScanConfirmResponse:
    """Confirm scanned books and save them to the library with positions.
    Automatically queues background enrichment for all confirmed books if quota allows."""
    book_ids = await confirm_shelf_scan(session, payload, library_id)

    # Auto-trigger background enrichment — only if the user has enough enrichment quota.
    # Books are always saved; enrichment is best-effort and skipped on quota exhaustion.
    if book_ids:
        n = len(book_ids)
        has_quota = await entitlements.can_use_metric_n(
            session, current_user.id, UsageMetric.enrichments, n
        )
        if has_quota:
            try:
                celery_client = get_celery_client()
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    lambda: celery_client.send_task(
                        "worker.celery_app.enrich_books_batch",
                        args=[[str(bid) for bid in book_ids], False],
                    ),
                )
                await entitlements.consume_n(
                    session, current_user.id, UsageMetric.enrichments, n
                )
                await session.commit()
            except Exception:
                # Enrichment is best-effort — a failed queue or quota commit must not
                # roll back the already-saved books. Log so we can diagnose issues.
                logger.warning(
                    "confirm_auto_enrichment_failed",
                    user_id=str(current_user.id),
                    book_count=n,
                    exc_info=True,
                )
        else:
            logger.info(
                "confirm_auto_enrichment_skipped_quota",
                user_id=str(current_user.id),
                book_count=n,
            )

    return ShelfScanConfirmResponse(created_count=len(book_ids), book_ids=book_ids)
