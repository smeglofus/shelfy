"""Service-level tests for borrower CRUD (bypasses the HTTP layer)."""
from collections.abc import AsyncIterator
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
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


@pytest.mark.asyncio
async def test_create_and_list_borrowers(session: AsyncSession) -> None:
    lib_id = uuid.uuid4()
    b = await create_borrower(session, BorrowerCreate(name="Alice", contact="alice@x.com"), lib_id)
    assert b.name == "Alice"
    assert b.library_id == lib_id

    results = await list_borrowers(session, lib_id)
    assert len(results) == 1
    assert results[0].id == b.id


@pytest.mark.asyncio
async def test_list_borrowers_scoped_by_library(session: AsyncSession) -> None:
    lib_a = uuid.uuid4()
    lib_b = uuid.uuid4()
    await create_borrower(session, BorrowerCreate(name="In Library A"), lib_a)
    await create_borrower(session, BorrowerCreate(name="In Library B"), lib_b)

    assert len(await list_borrowers(session, lib_a)) == 1
    assert len(await list_borrowers(session, lib_b)) == 1


@pytest.mark.asyncio
async def test_get_borrower_or_404_success(session: AsyncSession) -> None:
    lib_id = uuid.uuid4()
    created = await create_borrower(session, BorrowerCreate(name="Bob"), lib_id)
    fetched = await get_borrower_or_404(session, created.id, lib_id)
    assert fetched.id == created.id


@pytest.mark.asyncio
async def test_get_borrower_or_404_wrong_library_raises(session: AsyncSession) -> None:
    from fastapi import HTTPException

    lib_id = uuid.uuid4()
    created = await create_borrower(session, BorrowerCreate(name="Carol"), lib_id)
    with pytest.raises(HTTPException) as exc_info:
        await get_borrower_or_404(session, created.id, uuid.uuid4())
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_update_borrower_fields(session: AsyncSession) -> None:
    lib_id = uuid.uuid4()
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
    lib_id = uuid.uuid4()
    for name in ["Zoe", "Ana", "Mia"]:
        await create_borrower(session, BorrowerCreate(name=name), lib_id)
    results = await list_borrowers(session, lib_id)
    names = [b.name for b in results]
    assert names == sorted(names)
