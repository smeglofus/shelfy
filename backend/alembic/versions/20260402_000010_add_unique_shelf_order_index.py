"""add partial unique index for shelf ordering consistency

Revision ID: 20260402_000010
Revises: 20260401_000009
Create Date: 2026-04-02 11:40:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260402_000010"
down_revision: str | None = "20260401_000009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_books_location_shelf_position
        ON books (location_id, shelf_position)
        WHERE location_id IS NOT NULL AND shelf_position IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_books_location_shelf_position;")
