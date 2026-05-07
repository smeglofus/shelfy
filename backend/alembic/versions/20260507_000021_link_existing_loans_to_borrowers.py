"""link existing loans to borrower records per library

Revision ID: 20260507_000021
Revises: 20260507_000020
Create Date: 2026-05-07
"""
from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import Connection
from sqlalchemy.sql import column, table

revision: str = "20260507_000021"
down_revision: str | None = "20260507_000020"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


BORROWERS_TABLE = table(
    "borrowers",
    column("id", sa.Uuid(as_uuid=True)),
    column("library_id", sa.Uuid(as_uuid=True)),
    column("name", sa.String()),
    column("contact", sa.String()),
    column("notes", sa.Text()),
    column("anonymized_at", sa.DateTime(timezone=True)),
    column("created_at", sa.DateTime(timezone=True)),
    column("updated_at", sa.DateTime(timezone=True)),
)

LOANS_TABLE = table(
    "loans",
    column("id", sa.Uuid(as_uuid=True)),
    column("library_id", sa.Uuid(as_uuid=True)),
    column("borrower_id", sa.Uuid(as_uuid=True)),
    column("borrower_name", sa.String()),
    column("borrower_contact", sa.String()),
)


def _normalize_name(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(value.split())


def _normalize_contact(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = " ".join(value.split())
    return collapsed or None


def upgrade() -> None:
    bind = op.get_bind()
    _backfill(bind)


def downgrade() -> None:
    # Reverting only clears the borrower_id link. Borrower rows themselves are
    # owned by the prior migration and will be removed when that one is rolled
    # back. Manual creations made through the API would be lost there too,
    # which is the same trade-off as any forward data migration.
    op.execute(sa.text("UPDATE loans SET borrower_id = NULL"))


def _backfill(bind: Connection) -> None:
    library_ids = [
        row[0]
        for row in bind.execute(
            sa.select(LOANS_TABLE.c.library_id)
            .where(LOANS_TABLE.c.borrower_id.is_(None))
            .distinct()
        ).all()
    ]
    if not library_ids:
        return

    now = datetime.now(timezone.utc)
    for library_id in library_ids:
        _backfill_library(bind, library_id, now)


def _backfill_library(bind: Connection, library_id: uuid.UUID, now: datetime) -> None:
    existing = bind.execute(
        sa.select(
            BORROWERS_TABLE.c.id,
            BORROWERS_TABLE.c.name,
            BORROWERS_TABLE.c.contact,
        ).where(BORROWERS_TABLE.c.library_id == library_id)
    ).all()
    bucket: dict[tuple[str, str | None], uuid.UUID] = {
        (_normalize_name(name), _normalize_contact(contact)): borrower_id
        for borrower_id, name, contact in existing
    }

    loans = bind.execute(
        sa.select(
            LOANS_TABLE.c.id,
            LOANS_TABLE.c.borrower_name,
            LOANS_TABLE.c.borrower_contact,
        ).where(
            LOANS_TABLE.c.library_id == library_id,
            LOANS_TABLE.c.borrower_id.is_(None),
        )
    ).all()

    new_borrowers: list[dict[str, object]] = []
    loan_updates: list[dict[str, object]] = []

    for loan_id, borrower_name, borrower_contact in loans:
        normalized_name = _normalize_name(borrower_name)
        if not normalized_name:
            continue
        normalized_contact = _normalize_contact(borrower_contact)
        key = (normalized_name, normalized_contact)

        borrower_id = bucket.get(key)
        if borrower_id is None:
            borrower_id = uuid.uuid4()
            bucket[key] = borrower_id
            new_borrowers.append(
                {
                    "id": borrower_id,
                    "library_id": library_id,
                    "name": normalized_name,
                    "contact": normalized_contact,
                    "notes": None,
                    "anonymized_at": None,
                    "created_at": now,
                    "updated_at": now,
                }
            )

        loan_updates.append({"loan_id": loan_id, "borrower_id": borrower_id})

    if new_borrowers:
        bind.execute(sa.insert(BORROWERS_TABLE), new_borrowers)

    update_stmt = sa.text("UPDATE loans SET borrower_id = :borrower_id WHERE id = :loan_id")
    for params in loan_updates:
        bind.execute(update_stmt, params)
