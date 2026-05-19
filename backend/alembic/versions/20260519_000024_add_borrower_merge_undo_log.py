"""add borrower_merge_undo_log table for #244 PR #3

Revision ID: 20260519_000024
Revises: 20260518_000023
Create Date: 2026-05-19

A merge operation deletes the source borrower row synchronously — once
the loans have moved to the target, there's no "source" to restore from.
This table captures the snapshot the moment merge runs:

- ``source_borrower_snapshot``: JSON dict of the source row's identity
  fields at the time of merge (name, contact, notes, anonymized_at,
  ``*_user_id`` audit FKs, timestamps).
- ``moved_loan_ids``: JSON list of UUID strings — the loan rows the
  merge re-pointed from source to target.

Restore (POST /merge-undo/{token}) recreates a Borrower row from the
snapshot and re-points the loans back. The original source's UUID is
preserved across the round-trip so anything referencing it (e.g. an
audit row in another table) still resolves correctly after undo.

Schema design choices reflecting the spec review:

- ``undo_token_hash``: SHA-256 hex of a raw token returned to the
  client. The raw token is never stored. Matches the password-reset
  token pattern in this repo.
- ``moved_loan_ids`` as JSON list (not Postgres UUID[]): keeps the
  SQLite test backend usable without dialect-specific shims.
- ``library_id``: indexed for the GC worker scan and used by the
  /merge-undo endpoint for authorization (token alone is not enough —
  the calling user must have editor access to that library).
- ``undo_until``: indexed; the GC worker (every 30 s) does
  ``DELETE WHERE undo_until < now()``.
- ``executed_by_user_id``: nullable, ondelete=SET NULL — preserves the
  log row even if the actor's user account is later deleted.
- ``target_borrower_id`` is *not* an FK because the merge target could
  be deleted before the GC removes the log row; we don't want the
  cascade to drop our breadcrumb. Application-level scoping handles
  validity.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260519_000024"
down_revision = "20260518_000023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "borrower_merge_undo_log",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "undo_token_hash",
            sa.String(length=64),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "library_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("libraries.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("target_borrower_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("source_borrower_snapshot", sa.JSON(), nullable=False),
        sa.Column("moved_loan_ids", sa.JSON(), nullable=False),
        sa.Column(
            "executed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "undo_until",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "executed_by_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_borrower_merge_undo_log_undo_until",
        "borrower_merge_undo_log",
        ["undo_until"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_borrower_merge_undo_log_undo_until",
        table_name="borrower_merge_undo_log",
    )
    op.drop_table("borrower_merge_undo_log")
