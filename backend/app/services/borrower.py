import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import structlog

from app.models.book import Book
from app.models.borrower import Borrower
from app.models.borrower_merge_undo_log import BorrowerMergeUndoLog
from app.models.loan import Loan
from app.schemas.borrower import BorrowerCreate, BorrowerUpdate

BorrowerStatusFilter = Literal["all", "active", "pending"]

# Window between merge execution and the toast button expiring (#244 PR
# #3). 10 s is the issue spec — long enough to catch an instant
# "oh no, wrong direction" but short enough that the worker GC and
# undo log churn are tiny. Backend GC frequency follows in
# ``borrower_merge_undo_log_gc_interval`` (worker module).
MERGE_UNDO_TTL = timedelta(seconds=10)


@dataclass(frozen=True)
class MergeResult:
    """Return value of :func:`merge_borrowers`.

    Carries the merged target row + the raw undo token. The token is
    deliberately ephemeral — it lives only in this in-memory return
    value and the HTTP response body. On disk we keep just the SHA-256
    hash so a leaked log row can't replay the undo.
    """

    target: Borrower
    undo_token: str
    undo_until: datetime


def _hash_undo_token(raw_token: str) -> str:
    """SHA-256 hex digest. Constant-time-safe comparison happens at the
    DB lookup level (``WHERE undo_token_hash = ...``)."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _snapshot_borrower(borrower: Borrower) -> dict[str, object | None]:
    """Capture a Borrower row as a JSON-safe dict for the undo log.

    Kept conservative: only the fields a restore must reproduce
    (identity + audit FKs + timestamps). Excludes ``id`` because the
    undo restore reuses the original id explicitly to keep external
    references intact.
    """
    return {
        "id": str(borrower.id),
        "library_id": str(borrower.library_id),
        "name": borrower.name,
        "contact": borrower.contact,
        "notes": borrower.notes,
        "anonymized_at": borrower.anonymized_at.isoformat() if borrower.anonymized_at else None,
        "pending_anonymization_until": (
            borrower.pending_anonymization_until.isoformat()
            if borrower.pending_anonymization_until
            else None
        ),
        "created_by_user_id": (
            str(borrower.created_by_user_id) if borrower.created_by_user_id else None
        ),
        "anonymized_by_user_id": (
            str(borrower.anonymized_by_user_id) if borrower.anonymized_by_user_id else None
        ),
        "merged_into_by_user_id": (
            str(borrower.merged_into_by_user_id) if borrower.merged_into_by_user_id else None
        ),
        "created_at": borrower.created_at.isoformat(),
        "updated_at": borrower.updated_at.isoformat(),
    }


def _restore_borrower_from_snapshot(snapshot: dict[str, object | None]) -> Borrower:
    """Inverse of :func:`_snapshot_borrower`. Re-instantiates the source
    row with the original UUID so anything referencing it externally
    (e.g. audit log entries in other tables) still resolves."""
    def _parse_dt(value: object | None) -> datetime | None:
        return datetime.fromisoformat(value) if isinstance(value, str) else None

    def _parse_uuid(value: object | None) -> uuid.UUID | None:
        return uuid.UUID(value) if isinstance(value, str) else None

    borrower = Borrower(
        id=uuid.UUID(str(snapshot["id"])),
        library_id=uuid.UUID(str(snapshot["library_id"])),
        name=str(snapshot["name"]),
        contact=snapshot["contact"] if isinstance(snapshot["contact"], str) else None,
        notes=snapshot["notes"] if isinstance(snapshot["notes"], str) else None,
        anonymized_at=_parse_dt(snapshot.get("anonymized_at")),
        pending_anonymization_until=_parse_dt(snapshot.get("pending_anonymization_until")),
        created_by_user_id=_parse_uuid(snapshot.get("created_by_user_id")),
        anonymized_by_user_id=_parse_uuid(snapshot.get("anonymized_by_user_id")),
        merged_into_by_user_id=_parse_uuid(snapshot.get("merged_into_by_user_id")),
    )
    return borrower

logger = structlog.get_logger()

# Sentinel name written to anonymized borrower rows AND to the denormalized
# ``loan.borrower_name`` column for any loan attached to that borrower. Frontend
# detects ``anonymized_at`` to render a localized label; the DB string is
# whatever is robust and never empty.
ANONYMIZED_BORROWER_NAME = "Deleted borrower"

# Default soft-delete TTL for borrower anonymization (#244). Anonymize requests
# default to *pending* — PII stays intact for ``ANONYMIZE_PENDING_TTL`` so the
# librarian can restore in case of a fat-finger. After the window, a periodic
# worker (``finalize_due_pending_anonymizations``) wipes PII and stamps
# ``anonymized_at`` (= the legacy immediate-anonymize contract).
#
# 30 days matches the retention story in #246 (inactive_since is expressed in
# months) and gives the "noticed a week later" use case enough room. The
# privacy/DSAR escape hatch is the ``immediate=True`` flag on the anonymize
# endpoint — that skips pending and finalizes synchronously.
ANONYMIZE_PENDING_TTL = timedelta(days=30)


@dataclass(frozen=True)
class BorrowerWithStats:
    borrower: Borrower
    active_loans: int
    total_loans: int
    last_activity_at: date | None


@dataclass(frozen=True)
class BorrowerStatsPage:
    items: list[BorrowerWithStats]
    total: int
    page: int
    page_size: int


@dataclass(frozen=True)
class BorrowerLoanRow:
    id: uuid.UUID
    book_id: uuid.UUID
    book_title: str
    book_author: str | None
    lent_date: date
    due_date: date | None
    returned_date: date | None
    return_condition: str | None
    notes: str | None


def _normalize_name(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(value.split())


def _normalize_contact(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = " ".join(value.split())
    return collapsed or None


async def list_borrowers(session: AsyncSession, library_id: uuid.UUID) -> list[Borrower]:
    result = await session.execute(
        select(Borrower)
        .where(Borrower.library_id == library_id)
        .order_by(Borrower.name)
    )
    return list(result.scalars().all())


async def list_borrowers_with_stats(
    session: AsyncSession,
    library_id: uuid.UUID,
    *,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
    status: BorrowerStatusFilter = "all",
) -> BorrowerStatsPage:
    """List a library's borrowers with aggregated lending stats, paginated.

    ``search`` is a case-insensitive substring match on the borrower name.
    The match runs on the *stored* name; for anonymized rows that means
    matching against the sentinel ("Deleted borrower"). Localized labels
    are a frontend concern (see ``displayBorrowerName``).

    ``status`` filters by lifecycle state (#244):

    - ``"all"`` (default): no filter — preserves the legacy contract.
    - ``"active"``: rows that are neither anonymized nor pending — the
      day-to-day working set.
    - ``"pending"``: rows scheduled for anonymization but still
      restorable. Powers the "Recently anonymized" discovery view in the
      UI; without it a librarian could only restore via a known URL.
    """
    active_count = func.count(Loan.id).filter(Loan.returned_date.is_(None))
    total_count = func.count(Loan.id)

    where_clauses = [Borrower.library_id == library_id]
    if search:
        # ``ilike`` keeps the search case-insensitive on Postgres; SQLite's
        # default LIKE is already case-insensitive for ASCII so this is fine
        # for tests too.
        where_clauses.append(Borrower.name.ilike(f"%{search}%"))
    if status == "active":
        where_clauses.append(Borrower.anonymized_at.is_(None))
        where_clauses.append(Borrower.pending_anonymization_until.is_(None))
    elif status == "pending":
        where_clauses.append(Borrower.anonymized_at.is_(None))
        where_clauses.append(Borrower.pending_anonymization_until.is_not(None))

    # Count BEFORE applying limit/offset so the paginator knows the true
    # total. Cheap because there are no joins on the count query.
    total_stmt = select(func.count()).select_from(Borrower).where(*where_clauses)
    total = int((await session.execute(total_stmt)).scalar_one())

    # The library-id check on Loan is defensive: in normal operation a loan's
    # library_id always matches its borrower's, but pinning it here prevents a
    # malformed cross-library row from being counted into stats.
    page_stmt = (
        select(
            Borrower,
            active_count.label("active_loans"),
            total_count.label("total_loans"),
            func.max(Loan.lent_date).label("last_activity_at"),
        )
        .outerjoin(
            Loan,
            and_(Loan.borrower_id == Borrower.id, Loan.library_id == library_id),
        )
        .where(*where_clauses)
        .group_by(Borrower.id)
        .order_by(Borrower.name)
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    result = await session.execute(page_stmt)
    items = [
        BorrowerWithStats(
            borrower=row[0],
            active_loans=int(row[1] or 0),
            total_loans=int(row[2] or 0),
            last_activity_at=row[3],
        )
        for row in result.all()
    ]
    return BorrowerStatsPage(items=items, total=total, page=page, page_size=page_size)


async def list_loans_for_borrower(
    session: AsyncSession, borrower_id: uuid.UUID, library_id: uuid.UUID
) -> list[BorrowerLoanRow]:
    """List a borrower's loans with denormalized book metadata.

    Active loans (no returned_date) come first, then returned loans by most
    recent return. Within each group, lent_date desc.
    """
    await get_borrower_or_404(session, borrower_id, library_id)

    stmt = (
        select(
            Loan.id,
            Loan.book_id,
            Book.title,
            Book.author,
            Loan.lent_date,
            Loan.due_date,
            Loan.returned_date,
            Loan.return_condition,
            Loan.notes,
        )
        .join(Book, Book.id == Loan.book_id)
        .where(Loan.borrower_id == borrower_id, Loan.library_id == library_id)
        .order_by(
            Loan.returned_date.is_(None).desc(),
            Loan.returned_date.desc().nullslast(),
            Loan.lent_date.desc(),
            Loan.id.desc(),
        )
    )
    result = await session.execute(stmt)
    return [
        BorrowerLoanRow(
            id=row[0],
            book_id=row[1],
            book_title=row[2],
            book_author=row[3],
            lent_date=row[4],
            due_date=row[5],
            returned_date=row[6],
            return_condition=row[7],
            notes=row[8],
        )
        for row in result.all()
    ]


async def create_borrower(
    session: AsyncSession,
    payload: BorrowerCreate,
    library_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None = None,
) -> Borrower:
    """Create a borrower in ``library_id``.

    ``actor_user_id`` is stamped onto ``created_by_user_id`` for the audit
    trail (#245). Kept keyword-only and optional so callers that don't have
    a user context (e.g. seed scripts, internal helpers) still work — those
    rows just stay un-attributed.
    """
    borrower = Borrower(
        library_id=library_id,
        name=payload.name,
        contact=payload.contact,
        notes=payload.notes,
        created_by_user_id=actor_user_id,
    )
    session.add(borrower)
    await session.commit()
    await session.refresh(borrower)
    logger.info(
        "borrower_created",
        borrower_id=str(borrower.id),
        library_id=str(library_id),
        actor_user_id=str(actor_user_id) if actor_user_id else None,
    )
    return borrower


async def get_borrower_or_404(
    session: AsyncSession, borrower_id: uuid.UUID, library_id: uuid.UUID
) -> Borrower:
    result = await session.execute(
        select(Borrower).where(Borrower.id == borrower_id, Borrower.library_id == library_id)
    )
    borrower = result.scalar_one_or_none()
    if borrower is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found")
    return borrower


async def get_borrower_detail_or_404(
    session: AsyncSession, borrower_id: uuid.UUID, library_id: uuid.UUID
) -> Borrower:
    """Fetch a borrower with audit-trail user relationships eager-loaded (#261).

    Same 404 semantics as :func:`get_borrower_or_404` but the returned row
    has ``.created_by``, ``.anonymized_by`` and ``.merged_into_by`` populated
    so the detail endpoint can render audit actor emails without a second
    round-trip. Three LEFT JOINs at read time — acceptable on a single-row
    fetch, deliberately not paid by the list endpoint.
    """
    result = await session.execute(
        select(Borrower)
        .where(Borrower.id == borrower_id, Borrower.library_id == library_id)
        .options(
            selectinload(Borrower.created_by),
            selectinload(Borrower.anonymized_by),
            selectinload(Borrower.merged_into_by),
        )
    )
    borrower = result.scalar_one_or_none()
    if borrower is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Borrower not found")
    return borrower


async def update_borrower(
    session: AsyncSession,
    borrower_id: uuid.UUID,
    payload: BorrowerUpdate,
    library_id: uuid.UUID,
) -> Borrower:
    borrower = await get_borrower_or_404(session, borrower_id, library_id)
    update_data = payload.model_dump(exclude_unset=True)
    for field_name, value in update_data.items():
        setattr(borrower, field_name, value)
    await session.commit()
    await session.refresh(borrower)
    logger.info("borrower_updated", borrower_id=str(borrower.id), fields=list(update_data.keys()))
    return borrower


async def link_loans_to_borrowers(session: AsyncSession, library_id: uuid.UUID) -> int:
    """Link a library's existing loans to Borrower records.

    Idempotent: loans that already have ``borrower_id`` set are skipped.
    Loans whose ``borrower_name`` is blank after whitespace normalization are
    also skipped. Within the library, loans matching the same normalized
    ``(name, contact)`` reuse a single Borrower; otherwise a new Borrower is
    created. Borrowers are never shared across libraries.

    Returns the number of loans linked in this call.
    """
    existing = (
        await session.execute(select(Borrower).where(Borrower.library_id == library_id))
    ).scalars().all()
    bucket: dict[tuple[str, str | None], Borrower] = {
        (_normalize_name(b.name), _normalize_contact(b.contact)): b for b in existing
    }

    loans = (
        await session.execute(
            select(Loan).where(Loan.library_id == library_id, Loan.borrower_id.is_(None))
        )
    ).scalars().all()

    linked = 0
    for loan in loans:
        normalized_name = _normalize_name(loan.borrower_name)
        if not normalized_name:
            continue
        normalized_contact = _normalize_contact(loan.borrower_contact)
        key = (normalized_name, normalized_contact)

        borrower = bucket.get(key)
        if borrower is None:
            borrower = Borrower(
                library_id=library_id,
                name=normalized_name,
                contact=normalized_contact,
            )
            session.add(borrower)
            await session.flush()
            bucket[key] = borrower

        loan.borrower_id = borrower.id
        linked += 1

    if linked:
        await session.commit()
        logger.info(
            "loans_linked_to_borrowers",
            library_id=str(library_id),
            linked=linked,
            borrowers_total=len(bucket),
        )
    return linked


async def merge_borrowers(
    session: AsyncSession,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
    library_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None = None,
) -> MergeResult:
    """Merge ``source`` into ``target`` and delete the source row.

    - Both rows must be in ``library_id`` (404 otherwise).
    - ``source_id == target_id`` is rejected (422).
    - Anonymized rows on either side are rejected (422). For source, an
      anonymized record carries no useful identity to consolidate; for
      target, see #234 — we don't attach fresh data to a record whose
      personal data was explicitly deleted.
    - All ``loans.borrower_id == source`` rows are re-pointed to
      ``target``. ADR 008's archival semantic applies: ``loan.borrower_name``
      and ``loan.borrower_contact`` are NOT updated — they're a snapshot of
      who the borrower was *at the time of lending*. Display code reads
      ``loan.borrower.name`` via the relationship, so the merged loans show
      the target's name automatically.
    - A snapshot of the source row + the moved loan ids are written to
      ``borrower_merge_undo_log`` with a 10 s ``undo_until`` deadline,
      and the source row is then deleted. The caller receives a raw
      ``undo_token`` to surface in the UI; if the user clicks Undo
      within the window, :func:`apply_merge_undo` restores the source
      row and re-points the loans back. After the window the worker GC
      removes the log row and the action is irreversible (#244 PR #3).

    Returns a :class:`MergeResult` with the target borrower and the
    one-shot undo token.
    """
    if source_id == target_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot merge a borrower into itself",
        )

    source = await get_borrower_or_404(session, source_id, library_id)
    target = await get_borrower_or_404(session, target_id, library_id)

    if source.anonymized_at is not None or target.anonymized_at is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot merge anonymized borrowers",
        )

    # Capture loan ids BEFORE re-pointing — once the UPDATE fires there's
    # no way to tell which loans used to belong to source.
    moved_loan_ids = [
        str(loan_id)
        for loan_id in (
            await session.execute(
                select(Loan.id).where(
                    Loan.borrower_id == source_id, Loan.library_id == library_id
                )
            )
        ).scalars().all()
    ]

    source_snapshot = _snapshot_borrower(source)

    await session.execute(
        update(Loan)
        .where(Loan.borrower_id == source_id, Loan.library_id == library_id)
        .values(borrower_id=target_id)
    )

    # Audit (#245): stamp the surviving target with who performed the merge.
    # The source row is about to be deleted, so we don't bother recording on
    # it — the action is "I absorbed another record into me".
    target.merged_into_by_user_id = actor_user_id

    # Generate the undo token + record. ``token_urlsafe(32)`` gives us
    # ~256 bits of entropy — well over the threshold for a 10 s window
    # against any reasonable adversary, and we hash before storage so a
    # later log dump can't replay.
    raw_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    undo_until = now + MERGE_UNDO_TTL
    log_row = BorrowerMergeUndoLog(
        undo_token_hash=_hash_undo_token(raw_token),
        library_id=library_id,
        target_borrower_id=target_id,
        source_borrower_snapshot=source_snapshot,
        moved_loan_ids=moved_loan_ids,
        undo_until=undo_until,
        executed_by_user_id=actor_user_id,
    )
    session.add(log_row)

    await session.delete(source)
    await session.commit()
    await session.refresh(target)
    logger.info(
        "borrowers_merged",
        source_id=str(source_id),
        target_id=str(target_id),
        library_id=str(library_id),
        actor_user_id=str(actor_user_id) if actor_user_id else None,
        moved_loans=len(moved_loan_ids),
    )
    return MergeResult(target=target, undo_token=raw_token, undo_until=undo_until)


async def apply_merge_undo(
    session: AsyncSession,
    raw_token: str,
    library_id: uuid.UUID,
) -> Borrower:
    """Reverse a recent merge using its one-shot undo token (#244 PR #3).

    Status semantics:

    - **200**: the source borrower is restored from snapshot, loans are
      re-pointed, and the log row is deleted (one-shot). Returns the
      restored source row.
    - **422**: the log row exists but ``undo_until`` is already past —
      the token is technically valid but the window has expired. The
      worker hasn't GC'd it yet. Raised here instead of 404 so the
      client can show a helpful "too late" message rather than "what
      token?".
    - **404**: no matching log row. Either the token never existed, the
      window closed *and* the worker has GC'd, or the token was already
      consumed by a prior undo call (one-shot semantics enforced by
      deleting on success).

    Library scoping: the caller's editor-of-library check is performed
    at the API layer via ``require_editor_library``. We additionally
    cross-check that the log row's ``library_id`` matches the resolved
    ``library_id`` from the auth dependency — a token forged for one
    library cannot be redeemed in another.
    """
    token_hash = _hash_undo_token(raw_token)
    log_row = (
        await session.execute(
            select(BorrowerMergeUndoLog).where(
                BorrowerMergeUndoLog.undo_token_hash == token_hash
            )
        )
    ).scalar_one_or_none()

    if log_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Undo token not found",
        )

    if log_row.library_id != library_id:
        # Don't leak whether the token exists for some other library —
        # surface as a generic 404 so a probe can't enumerate cross-
        # library token validity.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Undo token not found",
        )

    now = datetime.now(timezone.utc)
    # Some test DBs strip tzinfo on round-trip; normalize before comparing.
    undo_until = log_row.undo_until
    if undo_until.tzinfo is None:
        undo_until = undo_until.replace(tzinfo=timezone.utc)
    if undo_until < now:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Undo window has expired",
        )

    snapshot = log_row.source_borrower_snapshot
    moved_loan_ids = [uuid.UUID(s) for s in log_row.moved_loan_ids]

    # Recreate the source row with the original UUID intact.
    restored = _restore_borrower_from_snapshot(snapshot)
    session.add(restored)

    # Re-point the loans back.
    if moved_loan_ids:
        await session.execute(
            update(Loan)
            .where(Loan.id.in_(moved_loan_ids))
            .values(borrower_id=restored.id)
        )

    # Clear the merged_into stamp on the target — that audit-trail entry
    # belonged to the merge we just reversed.
    target = await session.get(Borrower, log_row.target_borrower_id)
    if target is not None:
        target.merged_into_by_user_id = None

    # One-shot: delete the log row so the token can't be replayed.
    await session.delete(log_row)
    await session.commit()
    await session.refresh(restored)
    logger.info(
        "borrower_merge_undone",
        source_id=str(restored.id),
        target_id=str(log_row.target_borrower_id),
        library_id=str(library_id),
        loans_restored=len(moved_loan_ids),
    )
    return restored


async def gc_expired_merge_undo_logs(session: AsyncSession) -> int:
    """Delete merge undo log rows whose window has expired (#244 PR #3).

    Worker entry point. Returns the count of removed rows. Idempotent —
    after the first run there's nothing left to delete until another
    merge happens and ages out. Cheap because ``undo_until`` is
    indexed and the table is tiny (one row per merge in the last 10 s
    + worker tick interval).
    """
    now = datetime.now(timezone.utc)
    result = await session.execute(
        delete(BorrowerMergeUndoLog).where(BorrowerMergeUndoLog.undo_until < now)
    )
    await session.commit()
    removed = result.rowcount or 0
    if removed:
        logger.info("borrower_merge_undo_logs_gc", removed=removed)
    return removed


def _hard_anonymize_in_memory(
    borrower: Borrower, *, actor_user_id: uuid.UUID | None
) -> None:
    """Apply the PII-wipe in memory — caller flushes the cascade on Loan
    rows + commits the session.

    Shared by:
    - ``anonymize_borrower(..., immediate=True)`` — DSAR / bypass path
    - ``bulk_anonymize_borrowers(..., immediate=True)`` — bulk DSAR
    - ``finalize_due_pending_anonymizations(session)`` — worker that runs
      after the 30-day pending window expires

    Idempotent: the caller is responsible for skipping rows whose
    ``anonymized_at`` is already set. The actor is only stamped on
    ``anonymized_by_user_id`` when it isn't already set — preserves
    "who scheduled the anonymization" stamped at the pending step, so
    a worker run (with no user context) doesn't overwrite that.
    """
    borrower.name = ANONYMIZED_BORROWER_NAME
    borrower.contact = None
    borrower.notes = None
    borrower.anonymized_at = datetime.now(timezone.utc)
    borrower.pending_anonymization_until = None
    if borrower.anonymized_by_user_id is None:
        borrower.anonymized_by_user_id = actor_user_id


async def anonymize_borrower(
    session: AsyncSession,
    borrower_id: uuid.UUID,
    library_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None = None,
    immediate: bool = False,
) -> Borrower:
    """Anonymize a borrower (#244).

    Default contract: set ``pending_anonymization_until = now() + 30d``
    and stamp ``anonymized_by_user_id`` — PII stays intact, a periodic
    worker finalizes the row once the window expires. Restore is a single
    call away during the window.

    ``immediate=True`` (DSAR / bypass) skips pending and performs the
    legacy immediate wipe synchronously.

    Idempotency rules:
    - Already-finalized borrower (``anonymized_at`` set) → no-op, returns
      the row as is. Cross-library access raises 404 via
      ``get_borrower_or_404``.
    - Already-pending borrower + ``immediate=False`` → no-op, returns the
      row with its original deadline untouched (so a second click doesn't
      extend the window).
    - Already-pending borrower + ``immediate=True`` → upgrades to
      finalized synchronously.

    Loan rows are updated alongside the borrower (during finalization)
    because ``Loan.borrower_name`` / ``Loan.borrower_contact`` carry a
    denormalized copy of the borrower text. While pending, the loan rows
    are NOT touched — the user might restore.
    """
    borrower = await get_borrower_or_404(session, borrower_id, library_id)

    if borrower.anonymized_at is not None:
        return borrower

    if immediate:
        _hard_anonymize_in_memory(borrower, actor_user_id=actor_user_id)
        await session.execute(
            update(Loan)
            .where(Loan.borrower_id == borrower_id, Loan.library_id == library_id)
            .values(borrower_name=ANONYMIZED_BORROWER_NAME, borrower_contact=None)
        )
        await session.commit()
        await session.refresh(borrower)
        logger.info(
            "borrower_anonymized",
            borrower_id=str(borrower.id),
            library_id=str(library_id),
            actor_user_id=str(actor_user_id) if actor_user_id else None,
            mode="immediate",
        )
        return borrower

    if borrower.pending_anonymization_until is not None:
        # Already scheduled — keep the existing deadline, don't extend.
        return borrower

    borrower.pending_anonymization_until = datetime.now(timezone.utc) + ANONYMIZE_PENDING_TTL
    borrower.anonymized_by_user_id = actor_user_id
    await session.commit()
    await session.refresh(borrower)
    logger.info(
        "borrower_anonymization_scheduled",
        borrower_id=str(borrower.id),
        library_id=str(library_id),
        actor_user_id=str(actor_user_id) if actor_user_id else None,
        pending_until=borrower.pending_anonymization_until.isoformat(),
    )
    return borrower


async def restore_borrower(
    session: AsyncSession,
    borrower_id: uuid.UUID,
    library_id: uuid.UUID,
) -> Borrower:
    """Cancel a pending anonymization (#244).

    Nulls ``pending_anonymization_until`` and clears the
    ``anonymized_by_user_id`` stamp (so the next anonymize call records
    the right actor). Raises:

    - 404 if the borrower doesn't exist in ``library_id``.
    - 422 if the borrower is already finalized (PII gone — can't restore).
    - 422 if the borrower is in the active state (nothing to restore).
    """
    borrower = await get_borrower_or_404(session, borrower_id, library_id)
    if borrower.anonymized_at is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Borrower is already anonymized — cannot restore",
        )
    if borrower.pending_anonymization_until is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Borrower is not in pending state",
        )
    borrower.pending_anonymization_until = None
    borrower.anonymized_by_user_id = None
    await session.commit()
    await session.refresh(borrower)
    logger.info(
        "borrower_anonymization_restored",
        borrower_id=str(borrower.id),
        library_id=str(library_id),
    )
    return borrower


async def finalize_due_pending_anonymizations(
    session: AsyncSession, *, batch_size: int = 100
) -> int:
    """Worker entry point — finalize every borrower whose
    ``pending_anonymization_until`` is in the past (#244).

    Returns the number of newly-finalized rows. Idempotent and safe to
    call concurrently: each row is upgraded with a single atomic
    in-transaction commit, and the query filter ensures
    already-finalized rows are skipped on the next iteration. The
    ``batch_size`` cap stops a backlog from running the worker forever.

    Cascades to Loan rows (clears borrower_name / borrower_contact) per
    the standard anonymize contract.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        select(Borrower)
        .where(
            Borrower.pending_anonymization_until.is_not(None),
            Borrower.pending_anonymization_until <= now,
            Borrower.anonymized_at.is_(None),
        )
        .limit(batch_size)
    )
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return 0

    finalized_ids: list[uuid.UUID] = []
    for borrower in rows:
        _hard_anonymize_in_memory(borrower, actor_user_id=None)
        finalized_ids.append(borrower.id)

    # One cascade UPDATE for the whole batch — cheaper than per-row.
    await session.execute(
        update(Loan)
        .where(Loan.borrower_id.in_(finalized_ids))
        .values(borrower_name=ANONYMIZED_BORROWER_NAME, borrower_contact=None)
    )
    await session.commit()
    logger.info(
        "borrower_anonymizations_finalized",
        count=len(finalized_ids),
    )
    return len(finalized_ids)


async def bulk_anonymize_borrowers(
    session: AsyncSession,
    borrower_ids: list[uuid.UUID],
    library_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None = None,
    immediate: bool = False,
) -> int:
    """Anonymize many borrowers in one request (#226, with #244 pending state).

    Default contract (``immediate=False``): each not-yet-anonymized and
    not-yet-pending row is moved to pending state with the 30-day TTL.
    Already-pending rows are left at their existing deadline. The
    ``affected`` count includes both newly-scheduled and newly-finalized
    rows (whichever path the call took).

    Strict ownership semantics: every id must exist in ``library_id``.
    """
    if not borrower_ids:
        return 0

    rows = (
        await session.execute(
            select(Borrower).where(Borrower.id.in_(borrower_ids), Borrower.library_id == library_id)
        )
    ).scalars().all()
    if len(rows) != len(set(borrower_ids)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Borrower not found",
        )

    now = datetime.now(timezone.utc)
    affected = 0
    finalized_ids: list[uuid.UUID] = []
    for borrower in rows:
        if borrower.anonymized_at is not None:
            continue
        if immediate:
            _hard_anonymize_in_memory(borrower, actor_user_id=actor_user_id)
            finalized_ids.append(borrower.id)
            affected += 1
            continue
        if borrower.pending_anonymization_until is not None:
            # Already scheduled — count as "no new change" so the response
            # reflects only the work that actually happened.
            continue
        borrower.pending_anonymization_until = now + ANONYMIZE_PENDING_TTL
        borrower.anonymized_by_user_id = actor_user_id
        affected += 1

    if finalized_ids:
        # Cascade clears only the finalized rows — pending rows keep their
        # original loan denormalization until the worker finalizes them.
        await session.execute(
            update(Loan)
            .where(Loan.borrower_id.in_(finalized_ids), Loan.library_id == library_id)
            .values(borrower_name=ANONYMIZED_BORROWER_NAME, borrower_contact=None)
        )

    await session.commit()
    logger.info(
        "borrowers_bulk_anonymized",
        borrower_ids_count=len(borrower_ids),
        affected=affected,
        library_id=str(library_id),
        mode="immediate" if immediate else "pending",
    )
    return affected


async def select_borrowers_for_retention_anonymize(
    session: AsyncSession, library_id: uuid.UUID, inactive_since: date
) -> list[uuid.UUID]:
    """Return ids of borrowers in ``library_id`` eligible for retention-driven
    anonymization given ``inactive_since`` as the cutoff date.

    A borrower is eligible when **all** of the following hold:

    - They are not already anonymized.
    - They have no active loans (any loan with ``returned_date IS NULL``).
    - Their most recent ``lent_date`` is strictly before ``inactive_since``,
      OR they have no loans at all. (Borrowers added through the API but
      never lent to are also retention candidates — their record carries
      personal data without serving any active purpose.)

    Loan rows are scoped to the same library on both sides of every check
    (defense in depth, mirroring the pattern in
    ``list_borrowers_with_stats``).
    """
    has_active_loan = select(Loan.id).where(
        Loan.borrower_id == Borrower.id,
        Loan.library_id == library_id,
        Loan.returned_date.is_(None),
    )
    has_recent_loan = select(Loan.id).where(
        Loan.borrower_id == Borrower.id,
        Loan.library_id == library_id,
        Loan.lent_date >= inactive_since,
    )

    stmt = (
        select(Borrower.id)
        .where(
            Borrower.library_id == library_id,
            Borrower.anonymized_at.is_(None),
            # #244: skip rows already in pending state — re-scheduling them
            # is a no-op and clutters the dry-run preview count.
            Borrower.pending_anonymization_until.is_(None),
            ~has_active_loan.exists(),
            ~has_recent_loan.exists(),
        )
    )
    result = await session.execute(stmt)
    return [row[0] for row in result.all()]


async def bulk_anonymize_borrowers_by_inactivity(
    session: AsyncSession,
    library_id: uuid.UUID,
    inactive_since: date,
    *,
    dry_run: bool = False,
    actor_user_id: uuid.UUID | None = None,
    immediate: bool = False,
) -> int:
    """Retention-driven bulk anonymize for a library.

    Wraps ``select_borrowers_for_retention_anonymize`` plus
    ``bulk_anonymize_borrowers`` — issue #246. When ``dry_run`` is True,
    returns the count that *would* be anonymized without mutating any row.

    Default mode (``immediate=False``) schedules each candidate for
    anonymization in the 30-day pending window (#244) — librarian can
    review the report and restore any false positives. ``immediate=True``
    is for the privacy-driven retention sweep where there is no need for
    a review window.
    """
    candidate_ids = await select_borrowers_for_retention_anonymize(
        session, library_id, inactive_since
    )
    if dry_run or not candidate_ids:
        return len(candidate_ids)
    return await bulk_anonymize_borrowers(
        session,
        candidate_ids,
        library_id,
        actor_user_id=actor_user_id,
        immediate=immediate,
    )
