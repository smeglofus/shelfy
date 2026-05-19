"""Scheduled borrower maintenance tasks (#244).

Tasks registered with Celery beat via celery_beat.py:

  borrowers.finalize_pending_anonymizations  every 30 min  — wipe PII on
    borrowers whose ``pending_anonymization_until`` deadline has passed
    and stamp ``anonymized_at`` (=  legacy immediate-anonymize contract).

Why a worker, not opportunistic check-on-read: a read-path check would add
DB round-trips to every borrower fetch and create concurrent-finalize
race conditions when two requests arrive within ms of each other. A
periodic worker is the standard pattern for TTL-style soft delete.

Implementation notes:

* Uses psycopg2 directly (matching ``email_tasks.py`` / ``backup_tasks.py``
  conventions) so it does NOT need the backend's async SQLAlchemy stack.
* ``FOR UPDATE SKIP LOCKED`` makes overlapping worker runs safe — two
  beat fires won't double-process the same row.
* Batched (default 100 rows per run) so a backlog won't run the worker
  forever. Re-runs every 30 min — at the typical 30-day TTL a backlog
  is extremely unlikely.
* Cascade-clears denormalized borrower text on the loan rows to match
  the backend's ``_hard_anonymize_in_memory`` contract.
"""
from __future__ import annotations

import logging
import os

import psycopg2
import psycopg2.extras
from celery.schedules import crontab

from celery_app import celery_app

log = logging.getLogger(__name__)


# Sentinel text — must match ``app.services.borrower.ANONYMIZED_BORROWER_NAME``
# (kept duplicated here so the worker can run without importing the backend
# package — same trade-off as the other worker tasks).
_ANONYMIZED_NAME = "Deleted borrower"

_DATABASE_URL = (
    os.environ.get("DATABASE_URL", "postgresql://shelfy:shelfy@postgres:5432/shelfy")
    .replace("postgresql+asyncpg://", "postgresql://")
    .replace("+asyncpg", "")
)


def _db_conn():
    return psycopg2.connect(_DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


@celery_app.task(name="borrowers.finalize_pending_anonymizations", bind=True, max_retries=2)
def finalize_pending_anonymizations(self, batch_size: int = 100) -> dict[str, int]:
    """Hard-anonymize borrowers whose 30-day pending window has expired (#244).

    Returns a small stats dict — beat picks this up for the run log so
    operators can sanity-check that finalizations are progressing.

    Transactional: SELECT … FOR UPDATE SKIP LOCKED claims a batch in one
    statement, the UPDATE writes happen in the same transaction. A
    crashing worker mid-transaction leaves the rows untouched and the
    next beat fire re-claims them.
    """
    conn = _db_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                # 1) Claim a batch atomically. SKIP LOCKED stops a concurrent
                #    worker run from grabbing the same rows.
                cur.execute(
                    """
                    SELECT id
                    FROM borrowers
                    WHERE pending_anonymization_until IS NOT NULL
                      AND pending_anonymization_until <= NOW()
                      AND anonymized_at IS NULL
                    ORDER BY pending_anonymization_until
                    LIMIT %s
                    FOR UPDATE SKIP LOCKED
                    """,
                    (batch_size,),
                )
                rows = cur.fetchall()
                if not rows:
                    log.info("finalize_pending_anonymizations.no_rows")
                    return {"finalized": 0}

                ids = [r["id"] for r in rows]

                # 2) Hard-anonymize: wipe PII, set anonymized_at, clear pending.
                #    anonymized_by_user_id is preserved (stamped at the schedule
                #    step) so the audit footer keeps "scheduled by X" attribution.
                cur.execute(
                    """
                    UPDATE borrowers
                    SET name = %s,
                        contact = NULL,
                        notes = NULL,
                        anonymized_at = NOW(),
                        pending_anonymization_until = NULL
                    WHERE id = ANY(%s)
                    """,
                    (_ANONYMIZED_NAME, ids),
                )

                # 3) Cascade clear denormalized borrower text on the loan rows.
                cur.execute(
                    """
                    UPDATE loans
                    SET borrower_name = %s,
                        borrower_contact = NULL
                    WHERE borrower_id = ANY(%s)
                    """,
                    (_ANONYMIZED_NAME, ids),
                )

        log.info(
            "finalize_pending_anonymizations.completed",
            extra={"finalized": len(ids)},
        )
        return {"finalized": len(ids)}
    finally:
        conn.close()


@celery_app.task(name="borrowers.gc_merge_undo_logs", bind=True, max_retries=2)
def gc_merge_undo_logs(self) -> dict[str, int]:
    """Drop expired merge undo log rows (#244 PR #3).

    Cheap maintenance: the undo TTL is 10 s, so rows age out fast.
    The undo endpoint already short-circuits with 422 when ``undo_until``
    has passed — this task is purely housekeeping to keep the table
    small (think tens of rows max in any normal load).

    Idempotent: the DELETE is bounded by ``undo_until < NOW()``; after
    the first run there's nothing else to delete until the next merge
    expires.
    """
    conn = _db_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM borrower_merge_undo_log WHERE undo_until < NOW()"
                )
                removed = cur.rowcount
        if removed:
            log.info("gc_merge_undo_logs.completed", extra={"removed": removed})
        return {"removed": removed or 0}
    finally:
        conn.close()


# ── Beat schedule ──────────────────────────────────────────────────────────────
#
# Use ``update`` (not ``=``) so the existing backup_tasks / email_tasks
# schedule entries are preserved — assignment would overwrite them.
celery_app.conf.beat_schedule.update({
    "borrowers-finalize-pending-anonymizations": {
        "task": "borrowers.finalize_pending_anonymizations",
        # Every 30 minutes. The TTL itself is 30 days, so the lag from
        # "deadline reached" to "PII actually wiped" is bounded by this
        # interval — well under any reasonable expectation.
        "schedule": crontab(minute="*/30"),
    },
    "borrowers-gc-merge-undo-logs": {
        "task": "borrowers.gc_merge_undo_logs",
        # Every 5 minutes. The merge-undo TTL is 10 s, so worst-case
        # log row lifetime is ~5 min — fine for a tiny table. Anything
        # tighter (e.g. every 30 s) burns beat CPU for no real benefit
        # since the undo endpoint already returns 422 for expired rows.
        "schedule": crontab(minute="*/5"),
    },
})
