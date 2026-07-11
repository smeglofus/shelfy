from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.api.dependencies.locale import email_locale_from_request
from app.db.session import get_db_session
from app.models.library import Library, LibraryRole
from app.models.user import User
from app.services import email as email_svc
from app.schemas.library import (
    AddLibraryMemberRequest,
    CreateLibraryRequest,
    LibraryMemberResponse,
    LibraryResponse,
    UpdateLibraryMemberRequest,
    UpdateLibraryRequest,
)
from app.services import entitlements
from app.services.wishlist import set_wishlist_enabled
from app.services.library import (
    add_member,
    create_library as create_library_service,
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
    return [
        LibraryResponse(
            id=lib.id, name=lib.name, role=role, wishlist_enabled=lib.wishlist_enabled
        )
        for lib, role in data
    ]


@router.post("", response_model=LibraryResponse, status_code=201)
async def create_library(
    payload: CreateLibraryRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LibraryResponse:
    # Gate: raises HTTP 403 if the user has reached their plan's library limit.
    # ``lock=True`` takes a FOR UPDATE row lock on the user's Subscription row,
    # serializing concurrent library creations so two parallel requests cannot
    # both observe "under limit" and both insert (issue #119). The lock is
    # released when the transaction commits below.
    await entitlements.assert_can_create_library(session, current_user.id, lock=True)

    lib = await create_library_service(session, current_user.id, payload.name)
    await session.commit()
    await session.refresh(lib)
    return LibraryResponse(
        id=lib.id, name=lib.name, role=LibraryRole.OWNER, wishlist_enabled=lib.wishlist_enabled
    )


@router.patch("/{library_id}", response_model=LibraryResponse)
async def update_library(
    library_id: uuid.UUID,
    payload: UpdateLibraryRequest,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LibraryResponse:
    """Owner-only library settings — currently just the wishlist toggle (#309)."""
    member = await require_library_role(session, current_user.id, library_id, LibraryRole.OWNER)
    library = await set_wishlist_enabled(session, library_id, payload.wishlist_enabled)
    return LibraryResponse(
        id=library.id,
        name=library.name,
        role=member.role,
        wishlist_enabled=library.wishlist_enabled,
    )


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
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LibraryMemberResponse:
    await require_library_role(session, current_user.id, library_id, LibraryRole.OWNER)
    # Gate: raises HTTP 403 if the library has reached its plan's member limit.
    # ``lock=True`` takes a FOR UPDATE row lock on the parent Library row so
    # concurrent add-member requests serialize behind each other and cannot
    # both observe "under limit" before inserting (issue #119). The lock lives
    # until this endpoint commits below; ``add_member`` no longer commits
    # internally for that reason.
    await entitlements.assert_can_add_member(session, current_user.id, library_id, lock=True)
    member, created = await add_member(session, library_id, str(payload.email), payload.role)
    await session.commit()
    user = await session.get(User, member.user_id)
    assert user is not None
    # Notify the added user — fire-and-forget after the commit, mirroring the
    # welcome email in ``register`` (#312). Only on the first add: role
    # upserts stay silent, and owners adding themselves don't get mail.
    if created and member.user_id != current_user.id:
        library = await session.get(Library, library_id)
        assert library is not None
        background_tasks.add_task(
            email_svc.send_added_to_library,
            user.email,
            library.name,
            member.role.value,
            current_user.email,
            locale=email_locale_from_request(request),
        )
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
