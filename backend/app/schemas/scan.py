from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class ScannedBookItem(BaseModel):
    """A single book extracted by vision from a shelf photo."""
    position: int = Field(ge=0)
    title: str | None = None
    author: str | None = None
    isbn: str | None = None
    observed_text: str | None = None
    confidence: str = "auto"  # "auto" | "needs_review"


class ShelfScanResponse(BaseModel):
    """Returned after uploading a shelf photo – contains extracted books for confirmation."""
    job_id: uuid.UUID
    status: str  # pending | processing | done | failed


class ShelfScanResultResponse(BaseModel):
    job_id: uuid.UUID
    status: str
    location_id: uuid.UUID | None = None
    books: list[ScannedBookItem] = []
    error_message: str | None = None


class ConfirmBookItem(BaseModel):
    """A single book confirmed (or corrected) by the user."""
    position: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=500)
    author: str | None = Field(default=None, max_length=500)
    isbn: str | None = Field(default=None, max_length=20)


class ShelfScanConfirmRequest(BaseModel):
    """User confirms the scanned books for a given location."""
    location_id: uuid.UUID
    books: list[ConfirmBookItem] = Field(min_length=1)


class ShelfScanConfirmResponse(BaseModel):
    created_count: int
    book_ids: list[uuid.UUID]
