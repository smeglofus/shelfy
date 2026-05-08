"""Pin the contract that SQLite FK enforcement is on for the whole test suite.

If this fails, something has nuked the connect-event listener in
``conftest.py`` and the entire suite has silently lost its FK guarantees —
which means any new ``ondelete=CASCADE`` / ``ondelete=SET NULL`` on the
schema is no longer being exercised by tests, and dangling-FK inserts
(some tests construct them deliberately) stop being meaningful.
"""
from collections.abc import AsyncIterator
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.borrower import Borrower


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
async def test_pragma_foreign_keys_is_on(session: AsyncSession) -> None:
    """The PRAGMA itself is set to 1 on every connection the suite opens."""
    result = await session.execute(text("PRAGMA foreign_keys"))
    value = result.scalar_one()
    assert value == 1, (
        "SQLite FK enforcement is OFF — the global connect-event listener in "
        "conftest.py likely got removed. Tests that depend on cascade behavior "
        "are now silently passing whether or not the cascade actually works."
    )


@pytest.mark.asyncio
async def test_dangling_fk_insert_is_rejected(session: AsyncSession) -> None:
    """Functional proof: inserting a Borrower whose library_id points at no
    real Library row must raise IntegrityError. Without the PRAGMA this insert
    would silently succeed."""
    nonexistent_library_id = uuid.uuid4()
    session.add(Borrower(library_id=nonexistent_library_id, name="Ghost"))
    with pytest.raises(IntegrityError):
        await session.commit()
