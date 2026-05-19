"""Tests for the pending-anonymization soft-delete state (#244).

Covers:

- Default ``POST /borrowers/{id}/anonymize`` sets the pending TTL — does
  NOT wipe PII, does NOT touch loan rows.
- ``immediate=true`` (DSAR / privacy bypass) skips pending and applies
  the legacy immediate wipe synchronously.
- ``POST /borrowers/{id}/restore`` cancels the pending window.
- ``finalize_due_pending_anonymizations`` worker entry point wipes PII
  on rows whose deadline has passed and is idempotent.
- Edge cases: restore on already-finalized / never-scheduled, double
  schedule doesn't extend the window, retention bulk respects pending
  state and skips already-pending rows.
"""
from collections.abc import AsyncIterator, Iterator
from datetime import date, datetime, timedelta, timezone
import uuid

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
from app.models.library import Library, LibraryMember, LibraryRole
from app.models.loan import Loan
from app.models.user import User
from app.services.borrower import (
    ANONYMIZE_PENDING_TTL,
    anonymize_borrower,
    bulk_anonymize_borrowers,
    finalize_due_pending_anonymizations,
    restore_borrower,
)
from fastapi import HTTPException


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


async def _seed_owner_with_library(session: AsyncSession) -> tuple[User, Library]:
    user = User(email="owner@example.com", hashed_password=get_password_hash("secret"))
    session.add(user)
    await session.flush()
    lib = Library(name="Lib", created_by_user_id=user.id)
    session.add(lib)
    await session.flush()
    session.add(LibraryMember(library_id=lib.id, user_id=user.id, role=LibraryRole.OWNER))
    await session.commit()
    await session.refresh(lib)
    return user, lib


async def _login(client: AsyncClient) -> dict[str, str]:
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "owner@example.com", "password": "secret"}
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _seeded_borrower(lib_id: uuid.UUID) -> Borrower:
    return Borrower(library_id=lib_id, name="Alice Liddell", contact="alice@x.com", notes="VIP")


# ── Default pending-state behaviour ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_default_anonymize_sets_pending_window_keeps_pii(
    test_session: AsyncSession,
) -> None:
    """Default ``POST /anonymize`` (no ``immediate=true``) MUST NOT wipe PII —
    just schedules the deletion for ``now + 30d``."""
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    before = datetime.now(timezone.utc)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        resp = await client.post(
            f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers
        )

    assert resp.status_code == 200
    body = resp.json()
    # PII preserved during the window.
    assert body["name"] == "Alice Liddell"
    assert body["contact"] == "alice@x.com"
    assert body["notes"] == "VIP"
    # Not yet finalized.
    assert body["anonymized_at"] is None
    # Pending deadline ≈ now + 30 days. The SQLite test backend drops the
    # timezone on round-trip — strip both sides before comparing so the
    # test is portable across SQLite (naive) and Postgres (aware).
    pending = datetime.fromisoformat(body["pending_anonymization_until"]).replace(tzinfo=None)
    before_naive = before.replace(tzinfo=None)
    expected_lo = before_naive + ANONYMIZE_PENDING_TTL - timedelta(minutes=1)
    expected_hi = before_naive + ANONYMIZE_PENDING_TTL + timedelta(minutes=1)
    assert expected_lo <= pending <= expected_hi


@pytest.mark.asyncio
async def test_default_anonymize_does_not_touch_loans(
    test_session: AsyncSession,
) -> None:
    """Loan denormalization stays intact during the pending window — the
    librarian might restore, in which case loan PII must reappear."""
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.flush()
    book = Book(library_id=lib.id, title="Book")
    test_session.add(book)
    await test_session.flush()
    loan = Loan(
        library_id=lib.id,
        book_id=book.id,
        borrower_id=borrower.id,
        borrower_name="Alice Liddell",
        borrower_contact="alice@x.com",
        lent_date=date.today(),
    )
    test_session.add(loan)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        await client.post(f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers)

    refreshed = (await test_session.execute(select(Loan).where(Loan.id == loan.id))).scalar_one()
    assert refreshed.borrower_name == "Alice Liddell"
    assert refreshed.borrower_contact == "alice@x.com"


@pytest.mark.asyncio
async def test_double_schedule_keeps_original_deadline(test_session: AsyncSession) -> None:
    """Clicking Anonymize on an already-pending row is a no-op — the
    countdown must NOT reset."""
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        first = await client.post(
            f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers
        )
        second = await client.post(
            f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers
        )

    assert first.json()["pending_anonymization_until"] == second.json()["pending_anonymization_until"]


# ── Immediate / DSAR bypass ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_immediate_bypass_wipes_pii_synchronously(test_session: AsyncSession) -> None:
    """``?immediate=true`` skips pending and applies the legacy wipe — the
    DSAR / "data subject requested erasure" path."""
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        resp = await client.post(
            f"/api/v1/borrowers/{borrower.id}/anonymize?immediate=true", headers=headers
        )

    body = resp.json()
    assert body["name"] == "Deleted borrower"
    assert body["contact"] is None
    assert body["notes"] is None
    assert body["anonymized_at"] is not None
    assert body["pending_anonymization_until"] is None


@pytest.mark.asyncio
async def test_immediate_upgrades_pending_to_finalized(test_session: AsyncSession) -> None:
    """A row that was previously scheduled and then needs immediate wipe
    (e.g., DSAR request received mid-window) upgrades cleanly without
    leaving the pending timestamp orphaned."""
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        await client.post(f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers)
        resp = await client.post(
            f"/api/v1/borrowers/{borrower.id}/anonymize?immediate=true", headers=headers
        )

    body = resp.json()
    assert body["anonymized_at"] is not None
    assert body["pending_anonymization_until"] is None
    assert body["name"] == "Deleted borrower"


# ── Restore ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_restore_cancels_pending_window(test_session: AsyncSession) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        await client.post(f"/api/v1/borrowers/{borrower.id}/anonymize", headers=headers)
        resp = await client.post(
            f"/api/v1/borrowers/{borrower.id}/restore", headers=headers
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["pending_anonymization_until"] is None
    assert body["anonymized_at"] is None
    assert body["name"] == "Alice Liddell"  # PII still here
    # Audit stamp also cleared — next anonymize starts fresh.
    assert body["anonymized_by_user_id"] is None


@pytest.mark.asyncio
async def test_restore_on_finalized_borrower_is_422(test_session: AsyncSession) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        await client.post(
            f"/api/v1/borrowers/{borrower.id}/anonymize?immediate=true", headers=headers
        )
        resp = await client.post(
            f"/api/v1/borrowers/{borrower.id}/restore", headers=headers
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_restore_on_active_borrower_is_422(test_session: AsyncSession) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        resp = await client.post(
            f"/api/v1/borrowers/{borrower.id}/restore", headers=headers
        )
    assert resp.status_code == 422


# ── Worker finalize ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_worker_finalizes_only_rows_past_their_deadline(
    test_session: AsyncSession,
) -> None:
    """Service-level worker entry point: only rows past their deadline get
    finalized, mid-window rows are untouched, active rows are untouched."""
    _, lib = await _seed_owner_with_library(test_session)
    now = datetime.now(timezone.utc)

    due = Borrower(
        library_id=lib.id,
        name="Due",
        pending_anonymization_until=now - timedelta(hours=1),
    )
    fresh = Borrower(
        library_id=lib.id,
        name="Fresh pending",
        pending_anonymization_until=now + timedelta(days=29),
    )
    active = Borrower(library_id=lib.id, name="Active")
    test_session.add_all([due, fresh, active])
    await test_session.commit()

    count = await finalize_due_pending_anonymizations(test_session)
    assert count == 1

    refreshed = {
        row.id: row
        for row in (await test_session.execute(select(Borrower))).scalars().all()
    }
    assert refreshed[due.id].name == "Deleted borrower"
    assert refreshed[due.id].anonymized_at is not None
    assert refreshed[due.id].pending_anonymization_until is None
    assert refreshed[fresh.id].name == "Fresh pending"
    assert refreshed[fresh.id].anonymized_at is None
    assert refreshed[active.id].name == "Active"
    assert refreshed[active.id].anonymized_at is None


@pytest.mark.asyncio
async def test_worker_cascades_pii_clear_to_loan_rows(test_session: AsyncSession) -> None:
    """When the worker finalizes, denormalized loan PII must be cleared
    too — otherwise the legacy borrower_name field leaks the wiped name."""
    _, lib = await _seed_owner_with_library(test_session)
    borrower = Borrower(
        library_id=lib.id,
        name="Alice",
        contact="alice@x.com",
        pending_anonymization_until=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    test_session.add(borrower)
    await test_session.flush()
    book = Book(library_id=lib.id, title="Book")
    test_session.add(book)
    await test_session.flush()
    loan = Loan(
        library_id=lib.id,
        book_id=book.id,
        borrower_id=borrower.id,
        borrower_name="Alice",
        borrower_contact="alice@x.com",
        lent_date=date.today(),
    )
    test_session.add(loan)
    await test_session.commit()

    await finalize_due_pending_anonymizations(test_session)

    refreshed = (await test_session.execute(select(Loan).where(Loan.id == loan.id))).scalar_one()
    assert refreshed.borrower_name == "Deleted borrower"
    assert refreshed.borrower_contact is None
    # Loan link is preserved — only PII fields are scrubbed.
    assert refreshed.borrower_id == borrower.id


@pytest.mark.asyncio
async def test_worker_is_idempotent(test_session: AsyncSession) -> None:
    """Running the worker twice over the same backlog returns 0 the second
    time — already-finalized rows are filtered out by the query."""
    _, lib = await _seed_owner_with_library(test_session)
    borrower = Borrower(
        library_id=lib.id,
        name="Due",
        pending_anonymization_until=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    test_session.add(borrower)
    await test_session.commit()

    first = await finalize_due_pending_anonymizations(test_session)
    second = await finalize_due_pending_anonymizations(test_session)
    assert first == 1
    assert second == 0


# ── Retention bulk respects pending state ─────────────────────────────────────


@pytest.mark.asyncio
async def test_service_anonymize_borrower_pending_mode_direct(
    test_session: AsyncSession,
) -> None:
    """Direct call to ``anonymize_borrower(immediate=False)`` — bypasses the
    API layer so coverage instrumentation traces the service body even
    when the ASGI test transport does odd things with async frames."""
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    returned = await anonymize_borrower(test_session, borrower.id, lib.id)
    assert returned.anonymized_at is None
    assert returned.pending_anonymization_until is not None
    assert returned.name == "Alice Liddell"


@pytest.mark.asyncio
async def test_service_anonymize_borrower_immediate_mode_direct(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    returned = await anonymize_borrower(
        test_session, borrower.id, lib.id, immediate=True
    )
    assert returned.anonymized_at is not None
    assert returned.pending_anonymization_until is None
    assert returned.name == "Deleted borrower"


@pytest.mark.asyncio
async def test_service_anonymize_already_finalized_is_noop_direct(
    test_session: AsyncSession,
) -> None:
    """Re-anonymizing an already-finalized row is a clean no-op — returns
    the existing row, no state mutation, no exception."""
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.flush()
    await anonymize_borrower(test_session, borrower.id, lib.id, immediate=True)

    returned = await anonymize_borrower(test_session, borrower.id, lib.id)
    assert returned.anonymized_at is not None


@pytest.mark.asyncio
async def test_service_restore_borrower_direct(test_session: AsyncSession) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.flush()
    await anonymize_borrower(test_session, borrower.id, lib.id)

    restored = await restore_borrower(test_session, borrower.id, lib.id)
    assert restored.pending_anonymization_until is None
    assert restored.anonymized_by_user_id is None


@pytest.mark.asyncio
async def test_service_restore_finalized_raises_422_direct(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.flush()
    await anonymize_borrower(test_session, borrower.id, lib.id, immediate=True)

    with pytest.raises(HTTPException) as ei:
        await restore_borrower(test_session, borrower.id, lib.id)
    assert ei.value.status_code == 422


@pytest.mark.asyncio
async def test_service_restore_active_raises_422_direct(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    borrower = _seeded_borrower(lib.id)
    test_session.add(borrower)
    await test_session.commit()

    with pytest.raises(HTTPException) as ei:
        await restore_borrower(test_session, borrower.id, lib.id)
    assert ei.value.status_code == 422


@pytest.mark.asyncio
async def test_service_bulk_anonymize_pending_default_direct(
    test_session: AsyncSession,
) -> None:
    """Direct service-level bulk anonymize in pending mode — each row gets
    a deadline, none are immediately wiped, the cascade UPDATE on Loan
    rows is skipped (no rows finalized, no work to cascade)."""
    _, lib = await _seed_owner_with_library(test_session)
    b1 = Borrower(library_id=lib.id, name="Alice")
    b2 = Borrower(library_id=lib.id, name="Bob")
    test_session.add_all([b1, b2])
    await test_session.commit()

    affected = await bulk_anonymize_borrowers(test_session, [b1.id, b2.id], lib.id)
    assert affected == 2
    refreshed = (await test_session.execute(select(Borrower))).scalars().all()
    assert all(r.pending_anonymization_until is not None for r in refreshed)
    assert all(r.anonymized_at is None for r in refreshed)


@pytest.mark.asyncio
async def test_service_bulk_anonymize_immediate_direct(
    test_session: AsyncSession,
) -> None:
    _, lib = await _seed_owner_with_library(test_session)
    b1 = Borrower(library_id=lib.id, name="Alice")
    b2 = Borrower(library_id=lib.id, name="Bob")
    test_session.add_all([b1, b2])
    await test_session.commit()

    affected = await bulk_anonymize_borrowers(
        test_session, [b1.id, b2.id], lib.id, immediate=True
    )
    assert affected == 2
    refreshed = (await test_session.execute(select(Borrower))).scalars().all()
    assert all(r.anonymized_at is not None for r in refreshed)
    assert all(r.pending_anonymization_until is None for r in refreshed)


@pytest.mark.asyncio
async def test_service_bulk_anonymize_skips_already_pending_rows_direct(
    test_session: AsyncSession,
) -> None:
    """A row already in the pending state is not double-counted and its
    deadline is preserved (idempotent)."""
    _, lib = await _seed_owner_with_library(test_session)
    pending = Borrower(
        library_id=lib.id,
        name="Pending Alice",
        pending_anonymization_until=datetime.now(timezone.utc) + timedelta(days=10),
    )
    fresh = Borrower(library_id=lib.id, name="Active Bob")
    test_session.add_all([pending, fresh])
    await test_session.commit()
    original_deadline = pending.pending_anonymization_until

    affected = await bulk_anonymize_borrowers(
        test_session, [pending.id, fresh.id], lib.id
    )
    # Only the fresh one was newly scheduled; the pending one was skipped.
    assert affected == 1
    refreshed = {
        row.id: row
        for row in (await test_session.execute(select(Borrower))).scalars().all()
    }
    assert refreshed[pending.id].pending_anonymization_until == original_deadline
    assert refreshed[fresh.id].pending_anonymization_until is not None


# ── List endpoint status filter (#244 PR #2) ──────────────────────────────────


@pytest.mark.asyncio
async def test_list_borrowers_status_filter_active_excludes_pending_and_anonymized(
    test_session: AsyncSession,
) -> None:
    """``GET /borrowers?status=active`` is the day-to-day working set —
    hides both pending and finalized rows so the librarian doesn't see
    yellow / italic clutter when they don't care about lifecycle state."""
    _, lib = await _seed_owner_with_library(test_session)
    active = Borrower(library_id=lib.id, name="Active Alice")
    pending = Borrower(
        library_id=lib.id,
        name="Pending Bob",
        pending_anonymization_until=datetime.now(timezone.utc) + timedelta(days=20),
    )
    anonymized = Borrower(
        library_id=lib.id,
        name="Deleted borrower",
        anonymized_at=datetime.now(timezone.utc),
    )
    test_session.add_all([active, pending, anonymized])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        resp = await client.get("/api/v1/borrowers?status=active", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == str(active.id)


@pytest.mark.asyncio
async def test_list_borrowers_status_filter_pending_shows_only_scheduled(
    test_session: AsyncSession,
) -> None:
    """``GET /borrowers?status=pending`` is the recovery view — librarian
    finds rows that are scheduled for deletion but still restorable."""
    _, lib = await _seed_owner_with_library(test_session)
    active = Borrower(library_id=lib.id, name="Active Alice")
    pending_a = Borrower(
        library_id=lib.id,
        name="Pending Alice",
        pending_anonymization_until=datetime.now(timezone.utc) + timedelta(days=20),
    )
    pending_b = Borrower(
        library_id=lib.id,
        name="Pending Bob",
        pending_anonymization_until=datetime.now(timezone.utc) + timedelta(days=5),
    )
    anonymized = Borrower(
        library_id=lib.id,
        name="Deleted borrower",
        anonymized_at=datetime.now(timezone.utc),
    )
    test_session.add_all([active, pending_a, pending_b, anonymized])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        resp = await client.get("/api/v1/borrowers?status=pending", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    ids = {item["id"] for item in body["items"]}
    assert ids == {str(pending_a.id), str(pending_b.id)}


@pytest.mark.asyncio
async def test_list_borrowers_status_all_preserves_legacy_contract(
    test_session: AsyncSession,
) -> None:
    """No status param (or ``status=all``) returns every row — preserves the
    pre-#244 list contract so existing clients don't break."""
    _, lib = await _seed_owner_with_library(test_session)
    test_session.add_all([
        Borrower(library_id=lib.id, name="Active"),
        Borrower(
            library_id=lib.id,
            name="Pending",
            pending_anonymization_until=datetime.now(timezone.utc) + timedelta(days=10),
        ),
        Borrower(
            library_id=lib.id,
            name="Deleted borrower",
            anonymized_at=datetime.now(timezone.utc),
        ),
    ])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        no_param = await client.get("/api/v1/borrowers", headers=headers)
        all_param = await client.get("/api/v1/borrowers?status=all", headers=headers)

    assert no_param.json()["total"] == 3
    assert all_param.json()["total"] == 3


@pytest.mark.asyncio
async def test_retention_dry_run_skips_already_pending_rows(
    test_session: AsyncSession,
) -> None:
    """``select_borrowers_for_retention_anonymize`` (used by the dry-run
    preview) must not count rows already in the pending state — they're
    already scheduled, listing them again is misleading."""
    _, lib = await _seed_owner_with_library(test_session)
    cutoff = date.today() - timedelta(days=365)

    active_eligible = Borrower(library_id=lib.id, name="Active eligible")
    already_pending = Borrower(
        library_id=lib.id,
        name="Already pending",
        pending_anonymization_until=datetime.now(timezone.utc) + timedelta(days=20),
    )
    test_session.add_all([active_eligible, already_pending])
    await test_session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = await _login(client)
        resp = await client.post(
            "/api/v1/borrowers/bulk-anonymize-by-date",
            json={"inactive_since": cutoff.isoformat(), "dry_run": True},
            headers=headers,
        )

    assert resp.status_code == 200
    assert resp.json() == {"affected": 1}
