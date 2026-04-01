"""enable pg_trgm for fuzzy book search

Revision ID: 20260401_000009
Revises: 20260929_000008
Create Date: 2026-04-01 00:00:09
"""

from collections.abc import Sequence

from alembic import op


revision: str = "20260401_000009"
down_revision: str | None = "20260929_000008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        # Enable trigram extension (idempotent)
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        # GIN trigram index on title for fast similarity() queries
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_books_title_trgm "
            "ON books USING gin (title gin_trgm_ops)"
        )
        # GIN trigram index on author (partial — skip NULLs)
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_books_author_trgm "
            "ON books USING gin (author gin_trgm_ops) WHERE author IS NOT NULL"
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_books_title_trgm")
        op.execute("DROP INDEX IF EXISTS ix_books_author_trgm")
        # Note: we intentionally do NOT drop the pg_trgm extension on downgrade
        # as other parts of the DB may rely on it.
