from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.api.dependencies.library import require_editor_library
from app.db.session import get_db_session
from app.models.subscription import UsageMetric
from app.models.user import User
from app.schemas.enrich import EnrichBookResponse, EnrichResponse
from app.services import entitlements
from app.services.book import get_book_or_404, list_book_ids
from app.services.job_queue import get_celery_client
from app.services.location import get_location_or_404

router = APIRouter(prefix="/api/v1/enrich", tags=["enrich"])


async def _queue_enrichment(book_ids: list[str], force: bool = False) -> None:
    """Send book IDs to the batch enrichment Celery task."""
    celery_client = get_celery_client()
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        None,
        lambda: celery_client.send_task(
            "worker.celery_app.enrich_books_batch",
            args=[book_ids, force],
        ),
    )


@router.post("/book/{book_id}", response_model=EnrichBookResponse, status_code=status.HTTP_202_ACCEPTED)
async def enrich_single_book(
    book_id: uuid.UUID,
    force: bool = Query(default=False, description="Re-enrich even if already enriched"),
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
) -> EnrichBookResponse:
    """Queue metadata enrichment for a single book."""
    await get_book_or_404(session, book_id, library_id)

    # Gate: raises HTTP 402 if monthly enrichment quota is exhausted
    await entitlements.assert_can_use(session, current_user.id, UsageMetric.enrichments)

    try:
        await _queue_enrichment([str(book_id)], force=force)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Enrichment queue is unavailable",
        ) from exc

    # Consume 1 enrichment credit after successful enqueue
    await entitlements.consume(session, current_user.id, UsageMetric.enrichments)
    await session.commit()

    return EnrichBookResponse(book_id=book_id, status="queued")


@router.post("/location/{location_id}", response_model=EnrichResponse, status_code=status.HTTP_202_ACCEPTED)
async def enrich_by_location(
    location_id: uuid.UUID,
    force: bool = Query(default=False, description="Re-enrich even if already enriched"),
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
) -> EnrichResponse:
    """Queue metadata enrichment for all books in a location."""
    await get_location_or_404(session, location_id, library_id)

    ids = await list_book_ids(session, library_id, location_id=location_id)
    book_ids = [str(book_id) for book_id in ids]

    if not book_ids:
        return EnrichResponse(status="queued", book_count=0, message="No books in this location")

    # Gate: raises HTTP 402 if remaining quota < number of books to enrich
    await entitlements.assert_can_use_n(
        session, current_user.id, UsageMetric.enrichments, len(book_ids)
    )

    try:
        await _queue_enrichment(book_ids, force=force)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Enrichment queue is unavailable",
        ) from exc

    # Consume N enrichment credits after successful enqueue (idempotent: same location
    # in the same billing period can only be charged once, even on retries / double-clicks)
    period_start = entitlements.current_period_start()
    await entitlements.consume_n(
        session,
        current_user.id,
        UsageMetric.enrichments,
        len(book_ids),
        idempotency_key=f"enrich_loc_{location_id}_{period_start}",
    )
    await session.commit()

    return EnrichResponse(
        status="queued",
        book_count=len(book_ids),
        message=f"Enrichment queued for {len(book_ids)} books",
    )


@router.post("/all", response_model=EnrichResponse, status_code=status.HTTP_202_ACCEPTED)
async def enrich_all_books(
    force: bool = Query(default=False, description="Re-enrich even if already enriched"),
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
    current_user: User = Depends(get_current_user),
) -> EnrichResponse:
    """Queue metadata enrichment for all books in the active library."""
    book_ids = [str(book_id) for book_id in await list_book_ids(session, library_id)]

    if not book_ids:
        return EnrichResponse(status="queued", book_count=0, message="No books in library")

    # Gate: raises HTTP 402 if remaining quota < total number of books
    await entitlements.assert_can_use_n(
        session, current_user.id, UsageMetric.enrichments, len(book_ids)
    )

    # Split into batches of 50 to avoid very long tasks
    batch_size = 50
    try:
        for i in range(0, len(book_ids), batch_size):
            batch = book_ids[i : i + batch_size]
            await _queue_enrichment(batch, force=force)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Enrichment queue is unavailable",
        ) from exc

    # Consume N enrichment credits after all batches are successfully enqueued
    # (idempotent: a second "enrich all" in the same billing period is a no-op on the counter)
    period_start = entitlements.current_period_start()
    await entitlements.consume_n(
        session,
        current_user.id,
        UsageMetric.enrichments,
        len(book_ids),
        idempotency_key=f"enrich_all_{library_id}_{period_start}",
    )
    await session.commit()

    return EnrichResponse(
        status="queued",
        book_count=len(book_ids),
        message=f"Enrichment queued for {len(book_ids)} books",
    )
