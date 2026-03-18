from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import BOOK_PROCESSING_JOBS_TOTAL, render_metrics
from app.db.session import get_db_session
from app.models.book import Book, BookProcessingStatus

router = APIRouter(tags=["metrics"])


@router.get("/metrics", include_in_schema=False)
async def metrics(session: AsyncSession = Depends(get_db_session)) -> Response:
    statuses = [
        BookProcessingStatus.DONE.value,
        BookProcessingStatus.FAILED.value,
        BookProcessingStatus.PARTIAL.value,
    ]

    for status in statuses:
        result = await session.execute(select(func.count()).select_from(Book).where(Book.processing_status == status))
        count = int(result.scalar_one())
        BOOK_PROCESSING_JOBS_TOTAL.labels(status=status).set(count)

    payload, content_type = render_metrics()
    return Response(content=payload, media_type=content_type)
