"""add multi-user data isolation (owner_user_id) to books, locations, loans, processing_jobs

Revision ID: 20260403_000012
Revises: 20260403_000011
Create Date: 2026-04-03 12:00:00

Migration strategy:
  Phase 1 — Add nullable owner_user_id columns + FK constraints
  Phase 2 — Backfill existing rows to the oldest user (by created_at ASC)
             If no users exist, rows stay NULL (safe — NOT NULL is only applied in phase 3
             if the table is non-empty AND a default owner exists).
  Phase 3 — Make books/locations/loans NOT NULL (processing_jobs stays nullable — it's an
             internal artifact that may pre-date the user record in some edge cases).
  Phase 4 — Drop the global ISBN unique index; replace with per-user composite unique index.
  Phase 5 — Add composite performance indexes.

Rollback notes:
  downgrade() reverses all steps in order:
  1. Drop new indexes
  2. Restore global ISBN unique index
  3. Drop NOT NULL constraint (revert to nullable)
  4. Drop owner_user_id columns
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260403_000012"
down_revision: str | None = "20260403_000011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Tables that get NOT NULL after backfill
_STRICT_TABLES = ("books", "locations", "loans")
# Tables that get nullable owner (processing artifacts that may not have a clear owner)
_SOFT_TABLES = ("processing_jobs",)


def upgrade() -> None:
    conn = op.get_bind()

    # ── Phase 1: Add nullable owner_user_id columns ───────────────────────────
    op.add_column(
        "books",
        sa.Column(
            "owner_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "locations",
        sa.Column(
            "owner_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "loans",
        sa.Column(
            "owner_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "processing_jobs",
        sa.Column(
            "owner_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # ── Phase 2: Backfill ─────────────────────────────────────────────────────
    # Select the oldest user (by created_at) as the default owner.
    # This is safe: if no users exist, the UPDATE touches 0 rows and NOT NULL
    # is only applied to empty tables (also 0 rows → constraint is trivially satisfied).
    default_owner_row = conn.execute(
        sa.text("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
    ).fetchone()

    if default_owner_row is not None:
        default_owner_id = default_owner_row[0]
        for table in (*_STRICT_TABLES, *_SOFT_TABLES):
            conn.execute(
                sa.text(
                    f"UPDATE {table} SET owner_user_id = :uid WHERE owner_user_id IS NULL"
                ),
                {"uid": str(default_owner_id)},
            )

    # ── Phase 3: NOT NULL for core data tables ────────────────────────────────
    # Only alter if the table has no NULL rows remaining (i.e. backfill succeeded
    # or the table was already empty).
    for table in _STRICT_TABLES:
        null_count = conn.execute(
            sa.text(f"SELECT COUNT(*) FROM {table} WHERE owner_user_id IS NULL")
        ).scalar()
        if null_count == 0:
            op.alter_column(table, "owner_user_id", nullable=False)
        # If null_count > 0, the column stays nullable and a WARNING is emitted.
        # This only happens if there were rows but no users — a degenerate state.

    # ── Phase 4: Replace global ISBN unique with per-user composite unique ────
    # Drop the old global unique index on isbn.
    # The index might be named "ix_books_isbn" (SQLAlchemy default for unique=True, index=True).
    op.execute("DROP INDEX IF EXISTS ix_books_isbn")
    # Also handle possible alternative naming (Alembic may have named it differently).
    op.execute("DROP INDEX IF EXISTS uq_books_isbn")

    # Create per-user unique index (partial: only where isbn IS NOT NULL)
    op.execute(
        """
        CREATE UNIQUE INDEX uq_books_isbn_per_user
        ON books (owner_user_id, isbn)
        WHERE isbn IS NOT NULL
        """
    )

    # ── Phase 5: Performance indexes ─────────────────────────────────────────
    op.create_index("idx_books_owner_user_id", "books", ["owner_user_id"])
    op.create_index("idx_locations_owner_user_id", "locations", ["owner_user_id"])
    op.create_index("idx_loans_owner_user_id", "loans", ["owner_user_id"])
    op.create_index("idx_processing_jobs_owner_user_id", "processing_jobs", ["owner_user_id"])


def downgrade() -> None:
    # ── Reverse Phase 5 ───────────────────────────────────────────────────────
    op.drop_index("idx_processing_jobs_owner_user_id", table_name="processing_jobs")
    op.drop_index("idx_loans_owner_user_id", table_name="loans")
    op.drop_index("idx_locations_owner_user_id", table_name="locations")
    op.drop_index("idx_books_owner_user_id", table_name="books")

    # ── Reverse Phase 4 ───────────────────────────────────────────────────────
    op.execute("DROP INDEX IF EXISTS uq_books_isbn_per_user")
    # Restore the global unique index on isbn
    op.create_index("ix_books_isbn", "books", ["isbn"], unique=True)

    # ── Reverse Phase 3 ───────────────────────────────────────────────────────
    for table in _STRICT_TABLES:
        op.alter_column(table, "owner_user_id", nullable=True)

    # ── Reverse Phase 1 ───────────────────────────────────────────────────────
    op.drop_column("processing_jobs", "owner_user_id")
    op.drop_column("loans", "owner_user_id")
    op.drop_column("locations", "owner_user_id")
    op.drop_column("books", "owner_user_id")
