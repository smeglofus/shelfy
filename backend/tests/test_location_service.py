"""Service-level tests for app/services/location.py."""
import uuid
from collections.abc import AsyncIterator

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.book import Book, BookProcessingStatus, ReadingStatus
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.user import User
from app.schemas.location import LocationCreateRequest, LocationUpdateRequest
from app.services.location import (
    create_location,
    delete_location,
    get_location_or_404,
    list_locations,
    update_location,
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

async def _make_library(session: AsyncSession) -> tuple[Library, uuid.UUID]:
    user = User(email=f"u{uuid.uuid4().hex[:6]}@x.com", hashed_password="h")
    session.add(user)
    await session.flush()
    lib = Library(name="L", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return lib, lib.id


# ── list_locations ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_locations_empty(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    locs = await list_locations(test_session, lib_id)
    assert locs == []


@pytest.mark.asyncio
async def test_list_locations_returns_all(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload1 = LocationCreateRequest(room="R", furniture="F", shelf="S1")
    payload2 = LocationCreateRequest(room="R", furniture="F", shelf="S2")
    await create_location(test_session, payload1, lib_id)
    await create_location(test_session, payload2, lib_id)
    locs = await list_locations(test_session, lib_id)
    assert len(locs) == 2


# ── create_location ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_location_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload = LocationCreateRequest(room="Office", furniture="Shelf", shelf="Top")
    loc = await create_location(test_session, payload, lib_id)
    assert loc.id is not None
    assert loc.room == "Office"
    assert loc.furniture == "Shelf"
    assert loc.shelf == "Top"
    assert loc.library_id == lib_id


@pytest.mark.asyncio
async def test_create_location_auto_display_order(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload1 = LocationCreateRequest(room="R", furniture="F", shelf="S1")
    payload2 = LocationCreateRequest(room="R", furniture="F", shelf="S2")
    loc1 = await create_location(test_session, payload1, lib_id)
    loc2 = await create_location(test_session, payload2, lib_id)
    assert loc1.display_order == 0
    assert loc2.display_order == 1


@pytest.mark.asyncio
async def test_create_location_explicit_display_order(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload = LocationCreateRequest(room="R", furniture="F", shelf="S", display_order=5)
    loc = await create_location(test_session, payload, lib_id)
    assert loc.display_order == 5


# ── get_location_or_404 ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_location_or_404_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    payload = LocationCreateRequest(room="R", furniture="F", shelf="S")
    loc = await create_location(test_session, payload, lib_id)
    result = await get_location_or_404(test_session, loc.id, lib_id)
    assert result.id == loc.id


@pytest.mark.asyncio
async def test_get_location_or_404_raises(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    with pytest.raises(HTTPException) as exc:
        await get_location_or_404(test_session, uuid.uuid4(), lib_id)
    assert exc.value.status_code == 404


# ── update_location ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_location_shelf(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await create_location(test_session, LocationCreateRequest(room="R", furniture="F", shelf="Old"), lib_id)
    payload = LocationUpdateRequest(shelf="New")
    updated = await update_location(test_session, loc.id, payload, lib_id)
    assert updated.shelf == "New"


@pytest.mark.asyncio
async def test_update_location_not_found_raises(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    with pytest.raises(HTTPException) as exc:
        await update_location(test_session, uuid.uuid4(), LocationUpdateRequest(shelf="X"), lib_id)
    assert exc.value.status_code == 404


# ── delete_location ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_location_success(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await create_location(test_session, LocationCreateRequest(room="R", furniture="F", shelf="S"), lib_id)
    await delete_location(test_session, loc.id, lib_id)
    with pytest.raises(HTTPException) as exc:
        await get_location_or_404(test_session, loc.id, lib_id)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_location_not_found_raises(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    with pytest.raises(HTTPException) as exc:
        await delete_location(test_session, uuid.uuid4(), lib_id)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_location_with_books_raises_409(test_session: AsyncSession) -> None:
    _, lib_id = await _make_library(test_session)
    loc = await create_location(test_session, LocationCreateRequest(room="R", furniture="F", shelf="S"), lib_id)
    test_session.add(Book(
        library_id=lib_id,
        title="Blocking Book",
        location_id=loc.id,
        shelf_position=0,
        reading_status=ReadingStatus.UNREAD,
        processing_status=BookProcessingStatus.MANUAL,
    ))
    await test_session.commit()
    with pytest.raises(HTTPException) as exc:
        await delete_location(test_session, loc.id, lib_id)
    assert exc.value.status_code == 409
