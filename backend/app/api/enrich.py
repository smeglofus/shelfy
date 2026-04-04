from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.library import require_editor_library
from app.db.session import get_db_session
from app.models.book import Book
from app.models.location import Location
from app.schemas.enrich import EnrichBookResponse, EnrichResponse
from app.services.job_queue import get_celery_client

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
) -> EnrichBookResponse:
    """Queue metadata enrichment for a single book."""
    book = (await session.execute(
        select(Book).where(Book.id == book_id, Book.library_id == library_id)
    )).scalar_one_or_none()
    if book is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    try:
        await _queue_enrichment([str(book_id)], force=force)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Enrichment queue is unavailable",
        ) from exc

    return EnrichBookResponse(book_id=book_id, status="queued")


@router.post("/location/{location_id}", response_model=EnrichResponse, status_code=status.HTTP_202_ACCEPTED)
async def enrich_by_location(
    location_id: uuid.UUID,
    force: bool = Query(default=False, description="Re-enrich even if already enriched"),
    session: AsyncSession = Depends(get_db_session),
    library_id: uuid.UUID = Depends(require_editor_library),
) -> EnrichResponse:
    """Queue metadata enrichment for all books in a location."""
    loc = (await session.execute(
        select(Location).where(Location.id == location_id, Location.library_id == library_id)
    )).scalar_one_or_none()
    if loc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")

    result = await session.execute(
        select(Book.id).where(Book.location_id == location_id, Book.library_id == library_id)
    )
    book_ids = [str(row[0]) for row in result.all()]

    if not book_ids:
        return EnrichResponse(status="queued", book_count=0, message="No books in this location")

    try:
        await _queue_enrichment(book_ids, force=force)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Enrichment queue is unavailable",
        ) from exc

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
) -> EnrichResponse:
    """Queue metadata enrichment for all books in the active library."""
    result = await session.execute(
        select(Book.id).where(Book.library_id == library_id)
    )
    book_ids = [str(row[0]) for row in result.all()]

    if not book_ids:
        return EnrichResponse(status="queued", book_count=0, message="No books in library")

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

    return EnrichResponse(
        status="queued",
        book_count=len(book_ids),
        message=f"Enrichment queued for {len(book_ids)} books",
    )
