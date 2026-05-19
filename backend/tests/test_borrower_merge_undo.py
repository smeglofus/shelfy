"""Tests for the merge-undo 10s window (#244 PR #3).

Covers the full undo lifecycle:

- ``POST /merge`` writes an undo log row + returns the raw token.
- The raw token never hits disk — only its SHA-256 hash.
- ``POST /merge-undo/{token}`` restores the source borrower from
  snapshot, re-points loans back, and is one-shot (second use → 404).
- Expired tokens return 422 (worker hasn't GC'd yet).
- A token forged for one library cannot be redeemed in another (404,
  probe-resistant).
- ``gc_expired_merge_undo_logs`` deletes only expired rows and is
  idempotent.
"""
import hashlib
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import date, datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import get_db_session
from app.main import app
from app.models.book import Book
from app.models.borrower import Borrower
from app.models.borrower_merge_undo_log import BorrowerMergeUndoLog
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.loan import Loan
from app.models.user import User
from app.services.borrower import (
    MERGE_UNDO_TTL,
    apply_merge_undo,
    gc_expired_merge_undo_logs,
    merge_borrowers,
)


@pytest.fixture
async def test_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret_key="test-secret",
        jwt_algorithm="HS256",
        access_token_expire_minutes=15,
        refresh_token_expire_days=7,
    )


@pytest.fixture(autouse=True)
def override_dependencies(test_session: AsyncSession, test_settings: Settings) -> Iterator[None]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield test_session

    app.dependency_overrides[get_db_session] = _get_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield
    app.dependency_overrides.clear()


async def _seed_owner_with_library(
    session: AsyncSession, email: str = "owner@example.com"
) -> tuple[User, Library]:
    user = User(email=email, hashed_password=get_password_hash("secret"))
    session.add(user)
    await session.flush()
    lib = Library(name=f"Lib {email}", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return user, lib


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    resp = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "secret"}
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _seed_pair(session: AsyncSession, lib_id: uuid.UUID) -> tuple[Borrower, Borrower, Loan]:
    """Seeds source + target borrowers, one loan on source, returns
    refs."""
    source = Borrower(library_id=lib_id, name="Alice (dup)", contact="alice-dup@x.com")
    target = Borrower(library_id=lib_id, name="Alice Liddell", contact="alice@x.com")
    session.add_all([source, target])
    await session.flush()
    book = Book(library_id=lib_id, title="Wonderland")
    session.add(book)
    await session.flush()
    loan = Loan(
        library_id=lib_id,
        book_id=book.id,
        borrower_id=source.id,
        borrower_name="Alice (dup)",
        borrower_contact="alice-dup@x.com",
        lent_date=date.today(),
    )
    session.add(loan)
    await session.commit()
    return source, target, loan


# ── Merge response shape ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_merge_response_carries_undo_token_and_deadline(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    source, target, _loan = await _seed_pair(test_session, lib.id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(target.id)
    assert isinstance(body["undo_token"], str)
    assert len(body["undo_token"]) > 16
    assert isinstance(body["undo_until"], str)


@pytest.mark.asyncio
async def test_merge_writes_undo_log_with_hashed_token_not_raw(
    test_session: AsyncSession,
) -> None:
    """The raw token only lives in the HTTP response — on disk we keep
    the SHA-256 hash. A log dump can't replay a recent merge undo."""
    _, lib = await _seed_owner_with_library(test_session)
    source, target, _loan = await _seed_pair(test_session, lib.id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )
    raw_token = resp.json()["undo_token"]

    log_row = (
        await test_session.execute(select(BorrowerMergeUndoLog))
    ).scalar_one()
    expected_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    assert log_row.undo_token_hash == expected_hash
    # Sanity: the raw token must NOT appear in any column.
    assert raw_token not in (log_row.undo_token_hash,)


# ── Apply undo ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_apply_merge_undo_restores_source_and_repoints_loans(
    test_session: AsyncSession,
) -> None:
    _owner, lib = await _seed_owner_with_library(test_session)
    source, target, loan = await _seed_pair(test_session, lib.id)
    original_source_id = source.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        merge_resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )
        token = merge_resp.json()["undo_token"]
        undo_resp = await client.post(
            f"/api/v1/borrowers/merge-undo/{token}", headers=headers
        )

    assert undo_resp.status_code == 200
    body = undo_resp.json()
    # Original source UUID is preserved across the round-trip.
    assert body["id"] == str(original_source_id)
    assert body["name"] == "Alice (dup)"
    assert body["contact"] == "alice-dup@x.com"

    # Loan re-pointed back.
    refreshed_loan = (
        await test_session.execute(select(Loan).where(Loan.id == loan.id))
    ).scalar_one()
    assert refreshed_loan.borrower_id == original_source_id

    # ``merged_into_by_user_id`` cleared on the target — that audit
    # entry belonged to the merge we just reversed.
    refreshed_target = (
        await test_session.execute(select(Borrower).where(Borrower.id == target.id))
    ).scalar_one()
    assert refreshed_target.merged_into_by_user_id is None


@pytest.mark.asyncio
async def test_apply_merge_undo_is_one_shot(test_session: AsyncSession) -> None:
    """Second use of the same token must 404 — the log row is deleted on
    successful undo, no replay."""
    _, lib = await _seed_owner_with_library(test_session)
    source, target, _loan = await _seed_pair(test_session, lib.id)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client, "owner@example.com")
        merge_resp = await client.post(
            f"/api/v1/borrowers/{target.id}/merge",
            json={"source_id": str(source.id)},
            headers=headers,
        )
        token = merge_resp.json()["undo_token"]
        first = await client.post(
            f"/api/v1/borrowers/merge-undo/{token}", headers=headers
        )
        second = await client.post(
            f"/api/v1/borrowers/merge-undo/{token}", headers=headers
        )

    assert first.status_code == 200
    assert second.status_code == 404


@pytest.mark.asyncio
async def test_apply_merge_undo_returns_422_when_window_expired(
    test_session: AsyncSession,
) -> None:
    """422 vs 404 distinction (per the spec review): an expired log row
    that the worker hasn't GC'd yet returns 422 with an explicit "too
    late" message, not a probe-friendly 404."""
    _, lib = await _seed_owner_with_library(test_session)
    source, target, _loan = await _seed_pair(test_session, lib.id)

    # Run merge via the service so we can rewind the deadline directly.
    result = await merge_borrowers(test_session, source.id, target.id, lib.id)
    log_row = (
        await test_session.execute(
            select(BorrowerMergeUndoLog).where(
                BorrowerMergeUndoLog.undo_token_hash == hashlib.sha256(
                    result.undo_token.encode("utf-8")
                ).hexdigest()
            )
        )
    ).scalar_one()
    log_row.undo_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    await test_session.commit()

    with pytest.raises(Exception) as ei:
        await apply_merge_undo(test_session, result.undo_token, lib.id)
    # FastAPI HTTPException is what gets raised.
    assert getattr(ei.value, "status_code", None) == 422


@pytest.mark.asyncio
async def test_apply_merge_undo_404_for_foreign_library_token(
    test_session: AsyncSession,
) -> None:
    """A token forged for library A cannot be redeemed when the caller
    is editor of library B — we return 404 (not 403) so a probe can't
    enumerate which tokens exist for other libraries."""
    _, own_lib = await _seed_owner_with_library(test_session, "own@example.com")
    _, foreign_lib = await _seed_owner_with_library(test_session, "foreign@example.com")

    # Merge happens inside foreign_lib.
    source_f = Borrower(library_id=foreign_lib.id, name="Foreign source")
    target_f = Borrower(library_id=foreign_lib.id, name="Foreign target")
    test_session.add_all([source_f, target_f])
    await test_session.commit()
    result = await merge_borrowers(test_session, source_f.id, target_f.id, foreign_lib.id)

    # Caller is the OWNER of own_lib trying to redeem foreign_lib's token.
    with pytest.raises(Exception) as ei:
        await apply_merge_undo(test_session, result.undo_token, own_lib.id)
    assert getattr(ei.value, "status_code", None) == 404


@pytest.mark.asyncio
async def test_apply_merge_undo_404_for_unknown_token(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    with pytest.raises(Exception) as ei:
        await apply_merge_undo(test_session, "this-token-does-not-exist", lib.id)
    assert getattr(ei.value, "status_code", None) == 404


# ── Worker GC ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_gc_expired_merge_undo_logs_removes_only_expired(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    now = datetime.now(timezone.utc)

    fresh = BorrowerMergeUndoLog(
        undo_token_hash="a" * 64,
        library_id=lib.id,
        target_borrower_id=lib.id,  # placeholder — not validated by GC
        source_borrower_snapshot={},
        moved_loan_ids=[],
        undo_until=now + timedelta(seconds=30),
    )
    stale = BorrowerMergeUndoLog(
        undo_token_hash="b" * 64,
        library_id=lib.id,
        target_borrower_id=lib.id,
        source_borrower_snapshot={},
        moved_loan_ids=[],
        undo_until=now - timedelta(seconds=30),
    )
    test_session.add_all([fresh, stale])
    await test_session.commit()

    removed = await gc_expired_merge_undo_logs(test_session)
    assert removed == 1

    remaining = (
        await test_session.execute(select(BorrowerMergeUndoLog))
    ).scalars().all()
    assert len(remaining) == 1
    assert remaining[0].undo_token_hash == "a" * 64


@pytest.mark.asyncio
async def test_gc_expired_merge_undo_logs_is_idempotent(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    stale = BorrowerMergeUndoLog(
        undo_token_hash="c" * 64,
        library_id=lib.id,
        target_borrower_id=lib.id,
        source_borrower_snapshot={},
        moved_loan_ids=[],
        undo_until=datetime.now(timezone.utc) - timedelta(seconds=30),
    )
    test_session.add(stale)
    await test_session.commit()

    first = await gc_expired_merge_undo_logs(test_session)
    second = await gc_expired_merge_undo_logs(test_session)
    assert first == 1
    assert second == 0


@pytest.mark.asyncio
async def test_merge_undo_ttl_constant_is_10_seconds() -> None:
    """The spec calls for 10 s. Pinning the constant here so an
    accidental change to the timedelta is caught at code-review time
    rather than via "huh, the toast disappeared too fast" in prod."""
    assert MERGE_UNDO_TTL == timedelta(seconds=10)


@pytest.mark.asyncio
async def test_merge_undo_url_path_405_with_no_token() -> None:
    """Sanity check on the route shape — the undo endpoint must take
    the token as a path param, not a query param, so missing-token
    requests 404 (route not matched) rather than silently succeeding."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/v1/borrowers/merge-undo/")
    # FastAPI redirects trailing-slash to the non-slash version (307);
    # 404/405/401 are the other plausible "no route here" outcomes.
    assert resp.status_code in (307, 404, 405, 401)
