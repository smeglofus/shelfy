"""add onboarding tracking fields to users

Revision ID: 20260403_000011
Revises: 20260402_000010
Create Date: 2026-04-03 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260403_000011"
down_revision: str | None = "20260402_000010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("onboarding_completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("onboarding_skipped_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "onboarding_skipped_at")
    op.drop_column("users", "onboarding_completed_at")
