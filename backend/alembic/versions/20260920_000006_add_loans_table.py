"""add loans table and decouple lending from reading status

Revision ID: 20260920_000006
Revises: 20260916_000005
Create Date: 2026-09-20 00:00:06
"""

from collections.abc import Sequence
from datetime import date, datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import Connection
from sqlalchemy.sql import table, column
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260920_000006"
down_revision: str | None = "20260916_000005"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

old_reading_status_enum = postgresql.ENUM(
    "unread",
    "reading",
    "read",
    "lent",
    name="reading_status",
    create_type=False,
)

new_reading_status_enum = postgresql.ENUM(
    "unread",
    "reading",
    "read",
    name="reading_status_new",
    create_type=False,
)


BOOKS_TABLE = table(
    "books",
    column("id", sa.Uuid(as_uuid=True)),
    column("lent_to", sa.String()),
)

LOANS_TABLE = table(
    "loans",
    column("id", sa.Uuid(as_uuid=True)),
    column("book_id", sa.Uuid(as_uuid=True)),
    column("borrower_name", sa.String()),
    column("borrower_contact", sa.String()),
    column("lent_date", sa.Date()),
    column("due_date", sa.Date()),
    column("returned_date", sa.Date()),
    column("return_condition", sa.String()),
    column("notes", sa.Text()),
    column("created_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    op.create_table(
        "loans",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("book_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("borrower_name", sa.String(length=255), nullable=False),
        sa.Column("borrower_contact", sa.String(length=255), nullable=True),
        sa.Column("lent_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("returned_date", sa.Date(), nullable=True),
        sa.Column("return_condition", sa.String(length=50), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_loans_book_id", "loans", ["book_id"], unique=False)

    _migrate_lent_to_data(bind)

    op.execute(sa.text("UPDATE books SET reading_status = 'unread' WHERE reading_status = 'lent'"))

    if is_postgresql:
        _migrate_postgres_reading_status_enum(bind)

    with op.batch_alter_table("books") as batch_op:
        batch_op.drop_column("lent_to")


def downgrade() -> None:
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    if is_postgresql:
        old_reading_status_enum.create(bind, checkfirst=True)
        op.execute(
            sa.text(
                "ALTER TABLE books ALTER COLUMN reading_status TYPE reading_status "
                "USING reading_status::text::reading_status"
            )
        )
    with op.batch_alter_table("books") as batch_op:
        batch_op.add_column(sa.Column("lent_to", sa.String(length=300), nullable=True))

    _restore_lent_to_data(bind)

    op.drop_index("ix_loans_book_id", table_name="loans")
    op.drop_table("loans")

    if is_postgresql:
        op.execute(sa.text("DROP TYPE IF EXISTS reading_status_new"))


def _migrate_lent_to_data(bind: Connection) -> None:
    rows = bind.execute(
        sa.select(BOOKS_TABLE.c.id, BOOKS_TABLE.c.lent_to).where(BOOKS_TABLE.c.lent_to.is_not(None))
    ).all()
    today = date.today()
    now = datetime.now(timezone.utc)

    records: list[dict[str, object]] = []
    for book_id, lent_to in rows:
        borrower_name = str(lent_to).strip() if lent_to is not None else ""
        if not borrower_name:
            continue
        records.append(
            {
                "id": uuid.uuid4(),
                "book_id": book_id,
                "borrower_name": borrower_name,
                "borrower_contact": None,
                "lent_date": today,
                "due_date": None,
                "returned_date": None,
                "return_condition": None,
                "notes": None,
                "created_at": now,
            }
        )

    if records:
        bind.execute(sa.insert(LOANS_TABLE), records)


def _migrate_postgres_reading_status_enum(bind: Connection) -> None:
    new_reading_status_enum.create(bind, checkfirst=True)

    op.execute(
        sa.text(
            "ALTER TABLE books ALTER COLUMN reading_status TYPE reading_status_new "
            "USING reading_status::text::reading_status_new"
        )
    )
    old_reading_status_enum.drop(bind, checkfirst=True)
    op.execute(sa.text("ALTER TYPE reading_status_new RENAME TO reading_status"))


def _restore_lent_to_data(bind: Connection) -> None:
    loan_rows = bind.execute(
        sa.select(LOANS_TABLE.c.book_id, LOANS_TABLE.c.borrower_name)
        .where(LOANS_TABLE.c.returned_date.is_(None))
        .order_by(LOANS_TABLE.c.lent_date.desc(), LOANS_TABLE.c.created_at.desc())
    ).all()

    seen: set[uuid.UUID] = set()
    for book_id, borrower_name in loan_rows:
        if book_id in seen:
            continue
        seen.add(book_id)
        bind.execute(
            sa.text("UPDATE books SET lent_to = :borrower_name, reading_status = 'lent' WHERE id = :book_id"),
            {"borrower_name": borrower_name, "book_id": book_id},
        )
