"""Service-level tests for app/services/library.py."""
import uuid
from collections.abc import AsyncIterator

import pytest
from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.user import User
from app.services.library import (
    add_member,
    create_personal_library,
    get_default_user_library_id,
    list_members,
    list_user_libraries,
    remove_member,
    require_library_role,
    update_member_role,
)


@pytest.fixture
async def test_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _make_user(session: AsyncSession, email: str | None = None) -> User:
    user = User(email=email or f"u{uuid.uuid4().hex[:6]}@x.com", hashed_password="h")
    session.add(user)
    await session.flush()
    return user


async def _make_library_with_owner(session: AsyncSession, user: User) -> Library:
    lib = Library(name="L", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return lib


# ── create_personal_library ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_personal_library_name_and_membership(test_session: AsyncSession) -> None:
    user = await _make_user(test_session, "alice@example.com")
    lib = await create_personal_library(test_session, user)
    await test_session.commit()
    await test_session.refresh(lib)

    assert "alice" in lib.name.lower()
    assert lib.created_by_user_id == user.id

    member = (await test_session.execute(
        select(LibraryMember).where(
            and_(LibraryMember.library_id == lib.id, LibraryMember.user_id == user.id)
        )
    )).scalar_one_or_none()
    assert member is not None
    assert member.role == LibraryRole.OWNER


# ── list_user_libraries ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_user_libraries_returns_owned(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)

    result = await list_user_libraries(test_session, user.id)
    assert len(result) == 1
    assert result[0][0].id == lib.id
    assert result[0][1] == LibraryRole.OWNER


@pytest.mark.asyncio
async def test_list_user_libraries_empty(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await test_session.commit()

    result = await list_user_libraries(test_session, user.id)
    assert result == []


# ── get_default_user_library_id ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_default_library_id_returns_id(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)

    result = await get_default_user_library_id(test_session, user.id)
    assert result == lib.id


@pytest.mark.asyncio
async def test_get_default_library_id_403_no_membership(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    await test_session.commit()

    with pytest.raises(HTTPException) as exc:
        await get_default_user_library_id(test_session, user.id)
    assert exc.value.status_code == 403


# ── require_library_role ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_require_library_role_owner_succeeds(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)

    member = await require_library_role(test_session, user.id, lib.id, LibraryRole.OWNER)
    assert member.user_id == user.id


@pytest.mark.asyncio
async def test_require_library_role_403_not_member(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    stranger = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)

    with pytest.raises(HTTPException) as exc:
        await require_library_role(test_session, stranger.id, lib.id, LibraryRole.VIEWER)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_require_library_role_403_insufficient_role(test_session: AsyncSession) -> None:
    owner = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, owner)
    viewer = await _make_user(test_session)
    test_session.add(LibraryMember(library_id=lib.id, user_id=viewer.id, role=LibraryRole.VIEWER))
    await test_session.commit()

    with pytest.raises(HTTPException) as exc:
        await require_library_role(test_session, viewer.id, lib.id, LibraryRole.EDITOR)
    assert exc.value.status_code == 403


# ── list_members ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_members_returns_owner(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)

    members = await list_members(test_session, lib.id)
    assert len(members) == 1
    assert members[0][0].user_id == user.id
    assert members[0][1].id == user.id


@pytest.mark.asyncio
async def test_list_members_multiple(test_session: AsyncSession) -> None:
    owner = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, owner)
    viewer = await _make_user(test_session)
    test_session.add(LibraryMember(library_id=lib.id, user_id=viewer.id, role=LibraryRole.VIEWER))
    await test_session.commit()

    members = await list_members(test_session, lib.id)
    assert len(members) == 2


# ── add_member ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_member_404_user_not_found(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)

    with pytest.raises(HTTPException) as exc:
        await add_member(test_session, lib.id, "ghost@example.com", LibraryRole.VIEWER)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_add_member_creates_new_membership(test_session: AsyncSession) -> None:
    owner = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, owner)
    new_user = await _make_user(test_session, "new@example.com")
    await test_session.commit()

    member = await add_member(test_session, lib.id, "new@example.com", LibraryRole.VIEWER)
    await test_session.commit()

    assert member.user_id == new_user.id
    assert member.role == LibraryRole.VIEWER


@pytest.mark.asyncio
async def test_add_member_updates_existing_role(test_session: AsyncSession) -> None:
    owner = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, owner)
    existing = await _make_user(test_session, "existing@example.com")
    test_session.add(LibraryMember(library_id=lib.id, user_id=existing.id, role=LibraryRole.VIEWER))
    await test_session.commit()

    member = await add_member(test_session, lib.id, "existing@example.com", LibraryRole.EDITOR)
    await test_session.commit()

    assert member.role == LibraryRole.EDITOR


# ── update_member_role ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_member_role_success(test_session: AsyncSession) -> None:
    owner = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, owner)
    viewer = await _make_user(test_session)
    test_session.add(LibraryMember(library_id=lib.id, user_id=viewer.id, role=LibraryRole.VIEWER))
    await test_session.commit()

    updated = await update_member_role(test_session, lib.id, viewer.id, LibraryRole.EDITOR)
    assert updated.role == LibraryRole.EDITOR


@pytest.mark.asyncio
async def test_update_member_role_404_not_found(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)

    with pytest.raises(HTTPException) as exc:
        await update_member_role(test_session, lib.id, uuid.uuid4(), LibraryRole.VIEWER)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_member_role_400_last_owner(test_session: AsyncSession) -> None:
    owner = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, owner)

    with pytest.raises(HTTPException) as exc:
        await update_member_role(test_session, lib.id, owner.id, LibraryRole.VIEWER)
    assert exc.value.status_code == 400


# ── remove_member ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_remove_member_success(test_session: AsyncSession) -> None:
    owner = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, owner)
    viewer = await _make_user(test_session)
    test_session.add(LibraryMember(library_id=lib.id, user_id=viewer.id, role=LibraryRole.VIEWER))
    await test_session.commit()

    await remove_member(test_session, lib.id, viewer.id)
    members = await list_members(test_session, lib.id)
    assert len(members) == 1


@pytest.mark.asyncio
async def test_remove_member_noop_if_not_found(test_session: AsyncSession) -> None:
    user = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, user)

    await remove_member(test_session, lib.id, uuid.uuid4())


@pytest.mark.asyncio
async def test_remove_member_400_last_owner(test_session: AsyncSession) -> None:
    owner = await _make_user(test_session)
    lib = await _make_library_with_owner(test_session, owner)

    with pytest.raises(HTTPException) as exc:
        await remove_member(test_session, lib.id, owner.id)
    assert exc.value.status_code == 400
