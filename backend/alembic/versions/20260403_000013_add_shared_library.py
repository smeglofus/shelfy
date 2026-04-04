"""Add shared library model (libraries + library_members) and migrate domain tables
from per-user (owner_user_id) to per-library (library_id) scoping.

Revision ID: 20260403_000013
Revises: 20260403_000012
Create Date: 2026-04-03 14:00:00

Migration strategy:
  Phase 1 — Create library_role ENUM type
  Phase 2 — Create libraries table
  Phase 3 — Create library_members table
  Phase 4 — Add nullable library_id columns to domain tables (books/locations/loans/processing_jobs)
  Phase 5 — Backfill: for each user that has owner_user_id rows, create a default library
             + owner membership, then set library_id on their rows.
  Phase 6 — Enforce NOT NULL on books/locations/loans (processing_jobs stays nullable)
  Phase 7 — Drop old per-user ISBN unique index; create per-library unique index
  Phase 8 — Drop owner_user_id columns from domain tables
  Phase 9 — Add performance indexes

Rollback:
  downgrade() reverses all phases in reverse order.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "20260403_000013"
down_revision: str | None = "20260403_000012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STRICT_TABLES = ("books", "locations", "loans")


def upgrade() -> None:
    conn = op.get_bind()

    # ── Phase 1: Create library_role ENUM ────────────────────────────────────
    op.execute("""
    DO $$
    BEGIN
        CREATE TYPE library_role AS ENUM ('owner', 'editor', 'viewer');
    EXCEPTION
        WHEN duplicate_object THEN NULL;
    END$$;
    """)

    # ── Phase 2: Create libraries table ──────────────────────────────────────
    op.create_table(
        "libraries",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(255), nullable=True, unique=True),
        sa.Column(
            "created_by_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("idx_libraries_created_by", "libraries", ["created_by_user_id"])

    # ── Phase 3: Create library_members table ─────────────────────────────────
    op.create_table(
        "library_members",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "library_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("libraries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "role",
            postgresql.ENUM("owner", "editor", "viewer", name="library_role", create_type=False),
            nullable=False,
            server_default="viewer",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("library_id", "user_id", name="uq_library_member"),
    )
    op.create_index("idx_library_members_library_id", "library_members", ["library_id"])
    op.create_index("idx_library_members_user_id", "library_members", ["user_id"])

    # ── Phase 4: Add nullable library_id to domain tables ────────────────────
    for table in (*_STRICT_TABLES, "processing_jobs"):
        op.add_column(
            table,
            sa.Column(
                "library_id",
                sa.Uuid(as_uuid=True),
                sa.ForeignKey("libraries.id", ondelete="CASCADE" if table != "processing_jobs" else "SET NULL"),
                nullable=True,
            ),
        )

    # ── Phase 5: Backfill – one default library per user ─────────────────────
    # For each distinct owner_user_id that appears in the domain tables,
    # create a "My Library" library + owner membership, then update rows.
    users_with_data = conn.execute(
        sa.text("""
            SELECT DISTINCT u.id, u.email
            FROM users u
            WHERE u.id IN (
                SELECT owner_user_id FROM books WHERE owner_user_id IS NOT NULL
                UNION
                SELECT owner_user_id FROM locations WHERE owner_user_id IS NOT NULL
                UNION
                SELECT owner_user_id FROM loans WHERE owner_user_id IS NOT NULL
            )
        """)
    ).fetchall()

    for user_id, email in users_with_data:
        username = email.split("@")[0] if email else str(user_id)[:8]
        lib_id = conn.execute(
            sa.text(
                "INSERT INTO libraries (id, name, created_by_user_id, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :name, :uid, now(), now()) RETURNING id"
            ),
            {"name": f"{username}'s Library", "uid": str(user_id)},
        ).scalar_one()

        conn.execute(
            sa.text(
                "INSERT INTO library_members (id, library_id, user_id, role, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :lid, :uid, 'owner', now(), now())"
            ),
            {"lid": str(lib_id), "uid": str(user_id)},
        )

        # Assign this user's rows to their new library
        for table in (*_STRICT_TABLES, "processing_jobs"):
            conn.execute(
                sa.text(
                    f"UPDATE {table} SET library_id = :lid WHERE owner_user_id = :uid AND library_id IS NULL"
                ),
                {"lid": str(lib_id), "uid": str(user_id)},
            )

    # Also handle any users who exist but have no data (create a library anyway
    # so they can log in without 403 on first access)
    users_without_library = conn.execute(
        sa.text("""
            SELECT u.id, u.email
            FROM users u
            WHERE u.id NOT IN (SELECT DISTINCT user_id FROM library_members)
        """)
    ).fetchall()

    for user_id, email in users_without_library:
        username = email.split("@")[0] if email else str(user_id)[:8]
        lib_id = conn.execute(
            sa.text(
                "INSERT INTO libraries (id, name, created_by_user_id, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :name, :uid, now(), now()) RETURNING id"
            ),
            {"name": f"{username}'s Library", "uid": str(user_id)},
        ).scalar_one()

        conn.execute(
            sa.text(
                "INSERT INTO library_members (id, library_id, user_id, role, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :lid, :uid, 'owner', now(), now())"
            ),
            {"lid": str(lib_id), "uid": str(user_id)},
        )

    # ── Phase 6: Enforce NOT NULL on core tables ──────────────────────────────
    for table in _STRICT_TABLES:
        null_count = conn.execute(
            sa.text(f"SELECT COUNT(*) FROM {table} WHERE library_id IS NULL")
        ).scalar()
        if null_count == 0:
            op.alter_column(table, "library_id", nullable=False)

    # ── Phase 7: Replace ISBN unique index ────────────────────────────────────
    # Drop the old per-user unique index from migration 000012 (if it exists)
    op.execute("DROP INDEX IF EXISTS uq_books_isbn_per_user")
    op.execute("DROP INDEX IF EXISTS ix_books_isbn")
    op.execute("DROP INDEX IF EXISTS uq_books_isbn")

    # Create per-library unique index (partial: only where isbn IS NOT NULL)
    op.execute(
        """
        CREATE UNIQUE INDEX uq_books_isbn_per_library
        ON books (library_id, isbn)
        WHERE isbn IS NOT NULL
        """
    )

    # ── Phase 8: Drop owner_user_id columns from domain tables ────────────────
    # First drop the indexes created in migration 000012
    op.execute("DROP INDEX IF EXISTS idx_books_owner_user_id")
    op.execute("DROP INDEX IF EXISTS idx_locations_owner_user_id")
    op.execute("DROP INDEX IF EXISTS idx_loans_owner_user_id")
    op.execute("DROP INDEX IF EXISTS idx_processing_jobs_owner_user_id")

    for table in (*_STRICT_TABLES, "processing_jobs"):
        op.drop_column(table, "owner_user_id")

    # ── Phase 9: Performance indexes on library_id ────────────────────────────
    op.create_index("idx_books_library_id", "books", ["library_id"])
    op.create_index("idx_locations_library_id", "locations", ["library_id"])
    op.create_index("idx_loans_library_id", "loans", ["library_id"])
    op.create_index("idx_processing_jobs_library_id", "processing_jobs", ["library_id"])


def downgrade() -> None:
    conn = op.get_bind()

    # ── Reverse Phase 9: Drop new performance indexes ─────────────────────────
    op.execute("DROP INDEX IF EXISTS idx_processing_jobs_library_id")
    op.execute("DROP INDEX IF EXISTS idx_loans_library_id")
    op.execute("DROP INDEX IF EXISTS idx_locations_library_id")
    op.execute("DROP INDEX IF EXISTS idx_books_library_id")

    # ── Reverse Phase 8: Re-add owner_user_id columns ─────────────────────────
    op.add_column(
        "books",
        sa.Column("owner_user_id", sa.Uuid(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
    )
    op.add_column(
        "locations",
        sa.Column("owner_user_id", sa.Uuid(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
    )
    op.add_column(
        "loans",
        sa.Column("owner_user_id", sa.Uuid(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
    )
    op.add_column(
        "processing_jobs",
        sa.Column("owner_user_id", sa.Uuid(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )

    # Backfill owner_user_id from library membership
    for table in ("books", "locations", "loans", "processing_jobs"):
        conn.execute(sa.text(f"""
            UPDATE {table} t
            SET owner_user_id = lm.user_id
            FROM library_members lm
            WHERE lm.library_id = t.library_id
              AND lm.role = 'owner'
        """))

    # Restore per-user unique index
    op.execute("DROP INDEX IF EXISTS uq_books_isbn_per_library")
    op.execute("""
        CREATE UNIQUE INDEX uq_books_isbn_per_user
        ON books (owner_user_id, isbn)
        WHERE isbn IS NOT NULL
    """)

    # ── Reverse Phase 6: Revert NOT NULL ──────────────────────────────────────
    for table in _STRICT_TABLES:
        op.alter_column(table, "library_id", nullable=True)

    # ── Reverse Phase 4: Drop library_id columns ──────────────────────────────
    for table in (*_STRICT_TABLES, "processing_jobs"):
        op.drop_column(table, "library_id")

    # ── Reverse Phases 2-3: Drop library tables ───────────────────────────────
    op.drop_table("library_members")
    op.drop_table("libraries")

    # ── Reverse Phase 1: Drop ENUM ────────────────────────────────────────────
    op.execute("DROP TYPE IF EXISTS library_role")
