from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.db.session import get_db_session
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.user import User
from app.schemas.library import (
    AddLibraryMemberRequest,
    CreateLibraryRequest,
    LibraryMemberResponse,
    LibraryResponse,
    UpdateLibraryMemberRequest,
)
from app.services.library import (
    add_member,
    list_members,
    list_user_libraries,
    remove_member,
    require_library_role,
    update_member_role,
)

router = APIRouter(prefix="/api/v1/libraries", tags=["libraries"])


@router.get("", response_model=list[LibraryResponse])
async def libraries_me(
    session: AsyncSession = Depends(get_db_session), current_user: User = Depends(get_current_user)
) -> list[LibraryResponse]:
    data = await list_user_libraries(session, current_user.id)
    return [LibraryResponse(id=lib.id, name=lib.name, role=role) for lib, role in data]


@router.post("", response_model=LibraryResponse, status_code=201)
async def create_library(
    payload: CreateLibraryRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LibraryResponse:
    lib = Library(name=payload.name, created_by_user_id=current_user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=current_user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return LibraryResponse(id=lib.id, name=lib.name, role=LibraryRole.OWNER)


@router.get("/{library_id}/members", response_model=list[LibraryMemberResponse])
async def get_members(
    library_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[LibraryMemberResponse]:
    await require_library_role(session, current_user.id, library_id, LibraryRole.VIEWER)
    members = await list_members(session, library_id)
    return [LibraryMemberResponse(user_id=m.user_id, email=u.email, role=m.role) for m, u in members]


@router.post("/{library_id}/members", response_model=LibraryMemberResponse)
async def create_member(
    library_id: uuid.UUID,
    payload: AddLibraryMemberRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LibraryMemberResponse:
    await require_library_role(session, current_user.id, library_id, LibraryRole.OWNER)
    member = await add_member(session, library_id, str(payload.email), payload.role)
    user = await session.get(User, member.user_id)
    assert user is not None
    return LibraryMemberResponse(user_id=member.user_id, email=user.email, role=member.role)


@router.patch("/{library_id}/members/{user_id}", response_model=LibraryMemberResponse)
async def patch_member(
    library_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: UpdateLibraryMemberRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LibraryMemberResponse:
    await require_library_role(session, current_user.id, library_id, LibraryRole.OWNER)
    member = await update_member_role(session, library_id, user_id, payload.role)
    user = await session.get(User, member.user_id)
    assert user is not None
    return LibraryMemberResponse(user_id=member.user_id, email=user.email, role=member.role)


@router.delete("/{library_id}/members/{user_id}", status_code=204)
async def delete_member(
    library_id: uuid.UUID,
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    await require_library_role(session, current_user.id, library_id, LibraryRole.OWNER)
    await remove_member(session, library_id, user_id)
    return Response(status_code=204)
