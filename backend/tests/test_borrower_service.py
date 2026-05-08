"""Service-level tests for borrower CRUD (bypasses the HTTP layer)."""
from collections.abc import AsyncIterator
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import get_password_hash
from app.db.base import Base
from app.models.library import Library
from app.models.user import User
from app.schemas.borrower import BorrowerCreate, BorrowerUpdate
from app.services.borrower import (
    create_borrower,
    get_borrower_or_404,
    list_borrowers,
    update_borrower,
)


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


_SEED_USER_COUNTER = 0


async def _seed_library(session: AsyncSession) -> uuid.UUID:
    """Seed a real Library row and return its id.

    SQLite FK enforcement (see ``conftest.py``) requires every borrower's
    ``library_id`` to point at a real row, so service-level tests can no
    longer pass a bare ``uuid.uuid4()`` as the library id.
    """
    global _SEED_USER_COUNTER
    _SEED_USER_COUNTER += 1
    user = User(
        email=f"svc-borrower-{_SEED_USER_COUNTER}@example.com",
        hashed_password=get_password_hash("x"),
    )
    session.add(user)
    await session.flush()
    lib = Library(name=f"Svc lib {_SEED_USER_COUNTER}", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    return lib.id


@pytest.mark.asyncio
async def test_create_and_list_borrowers(session: AsyncSession) -> None:
    lib_id = await _seed_library(session)
    b = await create_borrower(session, BorrowerCreate(name="Alice", contact="alice@x.com"), lib_id)
    assert b.name == "Alice"
    assert b.library_id == lib_id

    results = await list_borrowers(session, lib_id)
    assert len(results) == 1
    assert results[0].id == b.id


@pytest.mark.asyncio
async def test_list_borrowers_scoped_by_library(session: AsyncSession) -> None:
    lib_a = await _seed_library(session)
    lib_b = await _seed_library(session)
    await create_borrower(session, BorrowerCreate(name="In Library A"), lib_a)
    await create_borrower(session, BorrowerCreate(name="In Library B"), lib_b)

    assert len(await list_borrowers(session, lib_a)) == 1
    assert len(await list_borrowers(session, lib_b)) == 1


@pytest.mark.asyncio
async def test_get_borrower_or_404_success(session: AsyncSession) -> None:
    lib_id = await _seed_library(session)
    created = await create_borrower(session, BorrowerCreate(name="Bob"), lib_id)
    fetched = await get_borrower_or_404(session, created.id, lib_id)
    assert fetched.id == created.id


@pytest.mark.asyncio
async def test_get_borrower_or_404_wrong_library_raises(session: AsyncSession) -> None:
    from fastapi import HTTPException

    lib_id = await _seed_library(session)
    other_lib_id = await _seed_library(session)
    created = await create_borrower(session, BorrowerCreate(name="Carol"), lib_id)
    with pytest.raises(HTTPException) as exc_info:
        await get_borrower_or_404(session, created.id, other_lib_id)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_update_borrower_fields(session: AsyncSession) -> None:
    lib_id = await _seed_library(session)
    created = await create_borrower(
        session, BorrowerCreate(name="Dan", contact="dan@x.com", notes="VIP"), lib_id
    )
    updated = await update_borrower(
        session, created.id, BorrowerUpdate(name="Daniel", contact=None), lib_id
    )
    assert updated.name == "Daniel"
    assert updated.contact is None
    assert updated.notes == "VIP"


@pytest.mark.asyncio
async def test_list_borrowers_sorted_alphabetically(session: AsyncSession) -> None:
    lib_id = await _seed_library(session)
    for name in ["Zoe", "Ana", "Mia"]:
        await create_borrower(session, BorrowerCreate(name=name), lib_id)
    results = await list_borrowers(session, lib_id)
    names = [b.name for b in results]
    assert names == sorted(names)
