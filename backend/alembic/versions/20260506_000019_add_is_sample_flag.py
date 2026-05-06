"""add is_sample flag to books and locations

Revision ID: 20260506_000019
Revises: 20260424_000018
Create Date: 2026-05-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260506_000019"
down_revision = "20260424_000018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("books", sa.Column("is_sample", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("locations", sa.Column("is_sample", sa.Boolean(), nullable=False, server_default="false"))
    op.create_index("ix_books_is_sample", "books", ["library_id", "is_sample"])
    op.create_index("ix_locations_is_sample", "locations", ["library_id", "is_sample"])


def downgrade() -> None:
    op.drop_index("ix_locations_is_sample", table_name="locations")
    op.drop_index("ix_books_is_sample", table_name="books")
    op.drop_column("locations", "is_sample")
    op.drop_column("books", "is_sample")
