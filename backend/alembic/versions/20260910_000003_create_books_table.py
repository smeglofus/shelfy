"""create books table

Revision ID: 20260910_000003
Revises: 20260903_000002
Create Date: 2026-09-10 00:00:03
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260910_000003"
down_revision: str | None = "20260903_000002"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


book_processing_status = postgresql.ENUM(
    "manual",
    "pending",
    "done",
    "failed",
    "partial",
    name="book_processing_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    if is_postgresql:
        book_processing_status.create(bind, checkfirst=True)

    op.create_table(
        "books",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("author", sa.String(length=500), nullable=True),
        sa.Column("isbn", sa.String(length=20), nullable=True),
        sa.Column("publisher", sa.String(length=300), nullable=True),
        sa.Column("language", sa.String(length=10), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("publication_year", sa.Integer(), nullable=True),
        sa.Column("cover_image_url", sa.String(length=500), nullable=True),
        sa.Column("location_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "processing_status",
            book_processing_status if is_postgresql else sa.String(length=20),
            nullable=False,
            server_default="manual",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_books_isbn", "books", ["isbn"], unique=True)
    op.create_index("ix_books_location_id", "books", ["location_id"], unique=False)

    if is_postgresql:
        op.create_index(
            "ix_books_search_vector",
            "books",
            [sa.text("to_tsvector('simple'::regconfig, (coalesce(title, '') || ' ' || coalesce(author, ''))::text)")],
            postgresql_using="gin",
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    if is_postgresql:
        op.drop_index("ix_books_search_vector", table_name="books")

    op.drop_index("ix_books_location_id", table_name="books")
    op.drop_index("ix_books_isbn", table_name="books")
    op.drop_table("books")

    if is_postgresql:
        book_processing_status.drop(bind, checkfirst=True)
