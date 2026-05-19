"""Undo-log row for borrower merges (#244 PR #3).

The merge operation deletes the source borrower synchronously — the
loans move to the target and the source row is gone. Without an undo
log, recovering from a fat-finger would require restoring the database
from a backup. The log captures a snapshot at merge time and the IDs
of the loans that were re-pointed; ``apply_merge_undo`` reconstitutes
the source row and reverses the loan moves.

Schema rationale lives in the migration ``20260519_000024_*.py``.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BorrowerMergeUndoLog(Base):
    __tablename__ = "borrower_merge_undo_log"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # SHA-256 hex of the raw token returned to the client. Same shape as
    # the password-reset token store — raw tokens never hit disk.
    undo_token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True
    )
    library_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("libraries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Not an FK on purpose: the target borrower could be later deleted /
    # anonymized; we don't want the cascade to drop our breadcrumb. The
    # undo endpoint checks the borrower exists at restore time.
    target_borrower_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), nullable=False
    )
    # Identity snapshot of the source row at merge time (name, contact,
    # notes, anonymized_at, *_user_id audit FKs, timestamps). Stored as
    # JSON so the schema is forward-compatible if Borrower grows new
    # columns — undo will just preserve whatever was in the snapshot
    # without needing a schema migration here.
    source_borrower_snapshot: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False
    )
    # List of UUID strings — the loan rows the merge re-pointed from
    # source to target. JSON instead of Postgres UUID[] for SQLite test
    # backend compatibility.
    moved_loan_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    executed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    undo_until: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    executed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
