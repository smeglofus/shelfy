"""add display_order to locations

Revision ID: 20260929_000008
Revises: 20260928_000007
Create Date: 2026-09-29 00:00:08
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260929_000008"
down_revision: str | None = "20260928_000007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("locations", sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("locations", "display_order")
