from datetime import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.book import BookProcessingStatus, ReadingStatus


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
    reading_status: ReadingStatus | None = ReadingStatus.UNREAD
    lent_to: str | None = Field(default=None, min_length=1, max_length=300)
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
    reading_status: ReadingStatus | None = None
    lent_to: str | None = Field(default=None, min_length=1, max_length=300)
    processing_status: BookProcessingStatus | None = None

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "BookUpdateRequest":
        nullable_fields = {"author", "isbn", "publisher", "language", "description", "publication_year", "cover_image_url", "location_id", "reading_status", "lent_to"}
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
    reading_status: ReadingStatus | None
    lent_to: str | None
    processing_status: BookProcessingStatus
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
