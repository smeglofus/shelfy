from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.library import Library, LibraryMember, LibraryRole
from app.models.user import User

_ROLE_ORDER = {LibraryRole.VIEWER: 0, LibraryRole.EDITOR: 1, LibraryRole.OWNER: 2}


async def create_personal_library(session: AsyncSession, user: User) -> Library:
    lib = Library(name=f"{user.email.split('@')[0]} library", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    return lib


async def list_user_libraries(session: AsyncSession, user_id: uuid.UUID) -> list[tuple[Library, LibraryRole]]:
    res = await session.execute(
        select(Library, LibraryMember.role)
        .join(LibraryMember, LibraryMember.library_id == Library.id)
        .where(LibraryMember.user_id == user_id)
    )
    return [(r[0], r[1]) for r in res.all()]


async def get_default_user_library_id(session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    row = (
        await session.execute(
            select(LibraryMember.library_id)
            .where(LibraryMember.user_id == user_id)
            .order_by(LibraryMember.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No library membership")
    return row


async def require_library_role(
    session: AsyncSession,
    user_id: uuid.UUID,
    library_id: uuid.UUID,
    required: LibraryRole = LibraryRole.VIEWER,
) -> LibraryMember:
    member = (
        await session.execute(
            select(LibraryMember).where(
                and_(LibraryMember.user_id == user_id, LibraryMember.library_id == library_id)
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Library access denied")
    if _ROLE_ORDER[member.role] < _ROLE_ORDER[required]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient library role")
    return member


async def list_members(session: AsyncSession, library_id: uuid.UUID) -> list[tuple[LibraryMember, User]]:
    res = await session.execute(
        select(LibraryMember, User)
        .join(User, User.id == LibraryMember.user_id)
        .where(LibraryMember.library_id == library_id)
    )
    return res.all()


async def add_member(session: AsyncSession, library_id: uuid.UUID, email: str, role: LibraryRole) -> LibraryMember:
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User with this email does not exist")
    member = (
        await session.execute(
            select(LibraryMember).where(
                and_(LibraryMember.library_id == library_id, LibraryMember.user_id == user.id)
            )
        )
    ).scalar_one_or_none()
    if member is None:
        member = LibraryMember(library_id=library_id, user_id=user.id, role=role)
        session.add(member)
    else:
        member.role = role
    await session.commit()
    await session.refresh(member)
    return member


async def _owner_count(session: AsyncSession, library_id: uuid.UUID) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(LibraryMember)
                .where(and_(LibraryMember.library_id == library_id, LibraryMember.role == LibraryRole.OWNER))
            )
        ).scalar_one()
    )


async def update_member_role(
    session: AsyncSession, library_id: uuid.UUID, user_id: uuid.UUID, role: LibraryRole
) -> LibraryMember:
    member = (
        await session.execute(
            select(LibraryMember).where(
                and_(LibraryMember.library_id == library_id, LibraryMember.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == LibraryRole.OWNER and role != LibraryRole.OWNER and await _owner_count(session, library_id) <= 1:
        raise HTTPException(status_code=400, detail="Cannot remove last owner")
    member.role = role
    await session.commit()
    await session.refresh(member)
    return member


async def remove_member(session: AsyncSession, library_id: uuid.UUID, user_id: uuid.UUID) -> None:
    member = (
        await session.execute(
            select(LibraryMember).where(
                and_(LibraryMember.library_id == library_id, LibraryMember.user_id == user_id)
            )
        )
    ).scalar_one_or_none()
    if member is None:
        return
    if member.role == LibraryRole.OWNER and await _owner_count(session, library_id) <= 1:
        raise HTTPException(status_code=400, detail="Cannot remove last owner")
    await session.delete(member)
    await session.commit()
