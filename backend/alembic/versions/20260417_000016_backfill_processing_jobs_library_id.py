"""Backfill processing_jobs.library_id and enforce NOT NULL.

Closes the schema-level gap left by ``20260403_000013_add_shared_library``
where ``processing_jobs.library_id`` was intentionally left nullable. The
subsequent audit hardening in ``app/services/job.py`` already denies access
to any null-library job from a library-scoped caller, but the rows remain —
which is both operational debt and a recurring IDOR hazard for any future
refactor.

Upgrade path
------------
1. UPDATE backfill: derive ``library_id`` from
   ``book_images.id → books.library_id``. Every book image tied to a book
   belongs to exactly one library.
2. DELETE orphans: any job whose book image has no book (book deleted /
   image uploaded but never associated) is unreachable and safe to purge —
   the MinIO lifecycle policy already cleans orphan bytes.
3. ALTER: drop the old FK, set NOT NULL, recreate the FK with
   ``ON DELETE CASCADE`` to match the other tenant-scoped tables
   (previously ``SET NULL``, which would silently re-introduce null rows
   on library deletion — defeating the whole point of this migration).

The migration is idempotent: re-running it on an already-migrated database
is a no-op on the data steps (``WHERE library_id IS NULL`` matches no
rows) and the ALTER is wrapped in a conditional.

Downgrade relaxes NOT NULL back to nullable and restores the previous
SET NULL FK semantics so the prior revision's invariant holds.

Revision ID: 20260417_000016
Revises: 20260410_000015
Create Date: 2026-04-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260417_000016"
down_revision = "20260410_000015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Backfill library_id from the book → book_image join path.
    #    Correct path: processing_jobs.book_image_id -> book_images.id,
    #                  book_images.book_id -> books.id,
    #                  books.library_id.
    bind.execute(
        sa.text(
            """
            UPDATE processing_jobs AS pj
            SET library_id = b.library_id
            FROM book_images AS bi
            JOIN books AS b ON b.id = bi.book_id
            WHERE pj.book_image_id = bi.id
              AND pj.library_id IS NULL
            """
        )
    )

    # 2) Delete orphans that can never be backfilled.
    #    These are jobs whose book_image has no associated book (book deleted
    #    or image never bound). They are dereferenced by all UI paths and
    #    hold no recoverable data.
    deleted = bind.execute(
        sa.text(
            """
            DELETE FROM processing_jobs
            WHERE library_id IS NULL
            """
        )
    )
    # Announce the delete count for the operator running the migration.
    # rowcount may be -1 on some drivers; only log when meaningful.
    if getattr(deleted, "rowcount", -1) and deleted.rowcount > 0:
        print(
            f"[20260417_000016] Deleted {deleted.rowcount} orphan processing_jobs rows "
            f"with library_id IS NULL (no recoverable book link)."
        )

    # 3) Tighten the schema.
    #    - SET NOT NULL: no more silent nulls.
    #    - Replace SET NULL FK with CASCADE so library deletion cleans up
    #      its processing jobs atomically instead of resurrecting null rows.
    op.alter_column(
        "processing_jobs",
        "library_id",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=False,
    )

    # Drop + recreate FK to change ondelete semantics.
    # The constraint name follows Alembic's default naming from the prior
    # migration; inspect via information_schema to stay robust across envs.
    inspector = sa.inspect(bind)
    fks = inspector.get_foreign_keys("processing_jobs")
    library_fk_name: str | None = None
    for fk in fks:
        if fk.get("referred_table") == "libraries" and fk.get("constrained_columns") == ["library_id"]:
            library_fk_name = fk.get("name")
            break

    if library_fk_name:
        op.drop_constraint(library_fk_name, "processing_jobs", type_="foreignkey")

    op.create_foreign_key(
        "fk_processing_jobs_library_id_libraries",
        "processing_jobs",
        "libraries",
        ["library_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    bind = op.get_bind()

    # Reverse the FK semantics change first.
    inspector = sa.inspect(bind)
    fks = inspector.get_foreign_keys("processing_jobs")
    library_fk_name: str | None = None
    for fk in fks:
        if fk.get("referred_table") == "libraries" and fk.get("constrained_columns") == ["library_id"]:
            library_fk_name = fk.get("name")
            break

    if library_fk_name:
        op.drop_constraint(library_fk_name, "processing_jobs", type_="foreignkey")

    op.create_foreign_key(
        "fk_processing_jobs_library_id_libraries",
        "processing_jobs",
        "libraries",
        ["library_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.alter_column(
        "processing_jobs",
        "library_id",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=True,
    )
