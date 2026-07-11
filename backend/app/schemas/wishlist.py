from datetime import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field


class WishlistItemCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    author: str | None = Field(default=None, min_length=1, max_length=500)
    isbn: str | None = Field(default=None, min_length=1, max_length=20)
    note: str | None = Field(default=None, min_length=1)
    cover_image_url: str | None = Field(default=None, max_length=500)
    publication_year: int | None = Field(default=None, ge=0, le=9999)


class WishlistItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    library_id: uuid.UUID
    created_by_user_id: uuid.UUID | None
    title: str
    author: str | None
    isbn: str | None
    note: str | None
    cover_image_url: str | None
    publication_year: int | None
    created_at: datetime
    updated_at: datetime


class WishlistListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[WishlistItemResponse]
