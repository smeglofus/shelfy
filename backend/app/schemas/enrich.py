from __future__ import annotations

import uuid

from pydantic import BaseModel


class EnrichResponse(BaseModel):
    """Response after queueing enrichment."""
    status: str  # "queued"
    book_count: int
    message: str


class EnrichBookResponse(BaseModel):
    book_id: uuid.UUID
    status: str  # "queued"
