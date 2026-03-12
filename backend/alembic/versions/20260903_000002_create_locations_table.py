"""create locations table

Revision ID: 20260903_000002
Revises: 20260901_000001
Create Date: 2026-09-03 00:00:02
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260903_000002"
down_revision: str | None = "20260901_000001"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "locations",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("room", sa.String(length=100), nullable=False),
        sa.Column("furniture", sa.String(length=100), nullable=False),
        sa.Column("shelf", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("locations")
