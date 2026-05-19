"""Borrower anonymization: pending state lifecycle + retention sweep.

The default contract (#244) is a 30-day pending window — set
``pending_anonymization_until`` and stamp the actor, but keep PII
intact. A periodic worker (:func:`finalize_due_pending_anonymizations`)
wipes PII once the deadline passes. ``immediate=True`` is the DSAR
escape hatch that skips the window.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.borrower import Borrower
from app.models.loan import Loan
from app.services.borrower._common import ANONYMIZED_BORROWER_NAME
from app.services.borrower.query import get_borrower_or_404

logger = structlog.get_logger()

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
