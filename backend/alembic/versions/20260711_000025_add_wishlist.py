"""add wishlist_items table and libraries.wishlist_enabled for #309

Revision ID: 20260711_000025
Revises: 20260519_000024
Create Date: 2026-07-11

Internal wishlist: books a library wants to acquire. Rows are
multi-tenant isolated via ``library_id`` (CASCADE, same pattern as
``books``/``borrowers``). ``created_by_user_id`` is SET NULL so deleting
a user account keeps the library's wishes.

``libraries.wishlist_enabled`` is the per-library feature toggle —
``server_default=true`` so every existing library has the wishlist on
after this migration (decision from the issue refinement), no backfill
needed.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260711_000025"
down_revision = "20260519_000024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "libraries",
        sa.Column(
            "wishlist_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.create_table(
        "wishlist_items",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "library_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("libraries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("author", sa.String(500), nullable=True),
        sa.Column("isbn", sa.String(20), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("cover_image_url", sa.String(500), nullable=True),
        sa.Column("publication_year", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_wishlist_items_library_id", "wishlist_items", ["library_id"])


def downgrade() -> None:
    op.drop_index("ix_wishlist_items_library_id", table_name="wishlist_items")
    op.drop_table("wishlist_items")
    op.drop_column("libraries", "wishlist_enabled")
