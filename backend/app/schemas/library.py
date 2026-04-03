from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr

from app.models.library import LibraryRole


class LibraryResponse(BaseModel):
    id: uuid.UUID
    name: str
    role: LibraryRole


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
