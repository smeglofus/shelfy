from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr

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
    """Owner-only library settings (#309). Single field for now."""

    wishlist_enabled: bool
