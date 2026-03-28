"""add shelf_position to books

Revision ID: 20260928_000007
Revises: 20260920_000006
Create Date: 2026-09-28 00:00:07
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260928_000007"
down_revision: str | None = "20260920_000006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("books", sa.Column("shelf_position", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("books", "shelf_position")
