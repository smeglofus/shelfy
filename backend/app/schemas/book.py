from datetime import datetime
from typing import Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.book import BookProcessingStatus, ReadingStatus
from app.schemas.loan import LoanResponse


# ── CSV Import / Export schemas ────────────────────────────────────────────────

class CsvImportError(BaseModel):
    row: int
    error: str


class CsvPreviewRow(BaseModel):
    title: str
    author: str | None
    isbn: str | None
    publisher: str | None
    language: str | None
    publication_year: int | None
    description: str | None
    reading_status: str | None
    room: str | None
    furniture: str | None
    shelf: str | None
    shelf_position: int | None


class CsvImportSummary(BaseModel):
    total_rows: int
    valid_rows: int
    invalid_rows: int
    would_create: int
    would_update: int
    would_skip: int


class CsvImportPreviewResponse(BaseModel):
    import_token: str
    expires_in: int
    summary: CsvImportSummary
    errors: list[CsvImportError]
    preview_rows: list[CsvPreviewRow]


class CsvImportConfirmRequest(BaseModel):
    import_token: str
    mode: Literal["upsert", "create_only"] = "upsert"
    on_conflict: Literal["update", "skip"] = "update"
    create_missing_locations: bool = False


class CsvImportConfirmResponse(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: int
    warnings: list[str]


class BookBaseRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    author: str | None = Field(default=None, min_length=1, max_length=500)
    isbn: str | None = Field(default=None, min_length=1, max_length=20)
    publisher: str | None = Field(default=None, min_length=1, max_length=300)
    language: str | None = Field(default=None, min_length=2, max_length=10)
    description: str | None = Field(default=None, min_length=1)
    publication_year: int | None = Field(default=None, ge=0, le=9999)
    cover_image_url: str | None = Field(default=None, max_length=500)
    location_id: uuid.UUID | None = None
    shelf_position: int | None = None
    reading_status: ReadingStatus | None = ReadingStatus.UNREAD
    processing_status: BookProcessingStatus = BookProcessingStatus.MANUAL


class BookCreateRequest(BookBaseRequest):
    pass


class BookUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    author: str | None = Field(default=None, min_length=1, max_length=500)
    isbn: str | None = Field(default=None, min_length=1, max_length=20)
    publisher: str | None = Field(default=None, min_length=1, max_length=300)
    language: str | None = Field(default=None, min_length=2, max_length=10)
    description: str | None = Field(default=None, min_length=1)
    publication_year: int | None = Field(default=None, ge=0, le=9999)
    cover_image_url: str | None = Field(default=None, max_length=500)
    location_id: uuid.UUID | None = None
    shelf_position: int | None = None
    reading_status: ReadingStatus | None = None
    processing_status: BookProcessingStatus | None = None

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "BookUpdateRequest":
        nullable_fields = {
            "author",
            "isbn",
            "publisher",
            "language",
            "description",
            "publication_year",
            "cover_image_url",
            "location_id",
            "shelf_position",
            "reading_status",
        }
        for field_name in self.model_fields_set:
            if field_name not in nullable_fields and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class BookResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    author: str | None
    isbn: str | None
    publisher: str | None
    language: str | None
    description: str | None
    publication_year: int | None
    cover_image_url: str | None
    location_id: uuid.UUID | None
    shelf_position: int | None
    reading_status: ReadingStatus | None
    processing_status: BookProcessingStatus
    is_currently_lent: bool
    active_loan: LoanResponse | None
    created_at: datetime
    updated_at: datetime


class BookListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[BookResponse]


class RetryEnrichmentResponse(BaseModel):
    book_id: uuid.UUID
    status: str


# ── Bulk operations ────────────────────────────────────────────────────────────

class BulkDeleteRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class BulkMoveRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    location_id: uuid.UUID | None = None  # None = unassign
    insert_position: int | None = Field(default=None, ge=0)


class BulkStatusRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    reading_status: ReadingStatus


class BulkReorderItem(BaseModel):
    id: uuid.UUID
    location_id: uuid.UUID
    shelf_position: int = Field(ge=0)


class BulkReorderRequest(BaseModel):
    items: list[BulkReorderItem] = Field(min_length=1, max_length=500)


class BulkOperationResponse(BaseModel):
    affected: int
    operation: Literal["delete", "move", "status", "reorder"]
