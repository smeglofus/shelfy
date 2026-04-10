from datetime import datetime

from pydantic import BaseModel, Field


class PurgeLibraryRequest(BaseModel):
    password: str = Field(default="", max_length=255)


class PurgeLibraryResponse(BaseModel):
    deleted_books: int
    deleted_locations: int
    deleted_loans: int


class OnboardingStatusResponse(BaseModel):
    should_show: bool
    completed_at: datetime | None = None
    skipped_at: datetime | None = None
