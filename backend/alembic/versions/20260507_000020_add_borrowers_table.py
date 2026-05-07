"""add borrowers table and loan.borrower_id

Revision ID: 20260507_000020
Revises: 20260506_000019
Create Date: 2026-05-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260507_000020"
down_revision = "20260506_000019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "borrowers",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("library_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("contact", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("anonymized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["library_id"], ["libraries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_borrowers_library_id", "borrowers", ["library_id"], unique=False)

    op.add_column("loans", sa.Column("borrower_id", sa.Uuid(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_loans_borrower_id",
        "loans",
        "borrowers",
        ["borrower_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_loans_borrower_id", "loans", ["borrower_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_loans_borrower_id", table_name="loans")
    op.drop_constraint("fk_loans_borrower_id", "loans", type_="foreignkey")
    op.drop_column("loans", "borrower_id")

    op.drop_index("ix_borrowers_library_id", table_name="borrowers")
    op.drop_table("borrowers")
