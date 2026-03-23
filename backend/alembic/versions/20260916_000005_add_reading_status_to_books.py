"""add reading_status and lent_to to books

Revision ID: 20260916_000005
Revises: 20260912_000004
Create Date: 2026-09-16 00:00:05
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260916_000005"
down_revision: str | None = "20260912_000004"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


reading_status_enum = postgresql.ENUM(
    "unread",
    "reading",
    "read",
    "lent",
    name="reading_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    if is_postgresql:
        reading_status_enum.create(bind, checkfirst=True)

    op.add_column(
        "books",
        sa.Column(
            "reading_status",
            reading_status_enum if is_postgresql else sa.String(length=20),
            nullable=True,
            server_default="unread",
        ),
    )
    op.add_column("books", sa.Column("lent_to", sa.String(length=300), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    op.drop_column("books", "lent_to")
    op.drop_column("books", "reading_status")

    if is_postgresql:
        reading_status_enum.drop(bind, checkfirst=True)
