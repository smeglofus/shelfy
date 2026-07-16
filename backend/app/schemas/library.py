from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.library import LibraryRole


class LibraryResponse(BaseModel):
    id: uuid.UUID
    name: str
    role: LibraryRole
    # Per-library wishlist toggle (#309); drives the nav item + /wishlist route.
    wishlist_enabled: bool = True


class CreateLibraryRequest(BaseModel):
    name: str


class LibraryMemberResponse(BaseModel):
    user_id: uuid.UUID
    email: EmailStr
    role: LibraryRole


class AddLibraryMemberRequest(BaseModel):
    email: EmailStr
    role: LibraryRole


class UpdateLibraryMemberRequest(BaseModel):
    role: LibraryRole


class UpdateLibraryRequest(BaseModel):
    """Owner-only library settings: wishlist toggle (#309) and rename.
    Both fields optional — at least one must be provided."""

    name: str | None = Field(default=None, max_length=200)
    wishlist_enabled: bool | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Library name must not be empty")
        return stripped
