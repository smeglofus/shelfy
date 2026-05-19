"""Borrower merge with 10s undo window (#244 PR #3).

Captures the source row + moved loan ids in
``borrower_merge_undo_log`` before deletion so the operation can be
reversed via ``apply_merge_undo`` within the TTL. After expiry the
worker GC drops the log row and the merge is permanent.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.borrower import Borrower
from app.models.borrower_merge_undo_log import BorrowerMergeUndoLog
from app.models.loan import Loan
from app.services.borrower.query import get_borrower_or_404

logger = structlog.get_logger()

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
